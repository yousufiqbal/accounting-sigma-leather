import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Order lines not linked to a Shopify product (custom items typed into an order, or products
 * deleted since) can't take a product's cost — it's set here, per line, and kept through syncs.
 * Only orders that count (delivered) or still might (open).
 */
export const load: PageServerLoad = async ({ url }) => {
	const all = url.searchParams.get('view') === 'all';
	const lines = (await db.all(sql`
		select l.id, l.title, l.sku, l.qty, l.unit_price_paisa as price, l.line_discount_paisa as discount,
			l.cost_snapshot_paisa as cost, o.name as orderName, o.created_at as createdAt,
			exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered') as delivered
		from order_lines l join orders o on o.id = l.order_id
		where l.variant_id is null and l.qty > 0 and o.test = 0
			and (o.cancelled_at is null
				or exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered'))
			and not exists (select 1 from shipments s where s.order_id = o.id and s.status = 'returned'
				and not exists (select 1 from shipments d where d.order_id = o.id and d.status = 'delivered'))
			${all ? sql`` : sql`and coalesce(l.cost_snapshot_paisa, 0) = 0`}
		order by o.created_at desc`)) as {
		id: string;
		title: string;
		sku: string | null;
		qty: number;
		price: number;
		discount: number;
		cost: number | null;
		orderName: string;
		createdAt: string;
		delivered: number;
	}[];

	// Group by item name (+ SKU): usually the same item sold several times.
	const groups = new Map<
		string,
		{
			key: string;
			title: string;
			sku: string | null;
			lines: typeof lines;
			units: number;
			sales: number;
		}
	>();
	for (const l of lines) {
		const key = `${l.title}|${l.sku ?? ''}`;
		let g = groups.get(key);
		if (!g)
			groups.set(key, (g = { key, title: l.title, sku: l.sku, lines: [], units: 0, sales: 0 }));
		g.lines.push(l);
		g.units += l.qty;
		g.sales += l.qty * l.price - l.discount;
	}

	const options = (await db.all(sql`
		select id, product_title as title, variant_title as variant, sku, image_url as image,
			avg_cost_paisa as cost
		from variants where status = 'ACTIVE' and avg_cost_paisa > 0
		order by product_title, variant_title`)) as {
		id: string;
		title: string;
		variant: string | null;
		sku: string | null;
		image: string | null;
		cost: number;
	}[];

	const missing = lines.filter((l) => !l.cost);
	return {
		all,
		groups: [...groups.values()].sort((a, b) => b.sales - a.sales),
		options,
		totals: {
			lines: missing.length,
			units: missing.reduce((s, l) => s + l.qty, 0),
			sales: missing.reduce((s, l) => s + l.qty * l.price - l.discount, 0)
		}
	};
};

export const actions: Actions = {
	/** Set the unit cost (Rs) on one or more custom lines. Blank = clear. */
	setCost: async ({ request }) => {
		const f = await request.formData();
		const ids = String(f.get('lineIds') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (!ids.length) return fail(400, { error: 'Nothing to update.' });
		const raw = String(f.get('cost') ?? '').trim();
		let cost: number | null;
		try {
			cost = raw === '' ? null : toPaisa(raw);
		} catch {
			return fail(400, { error: 'Cost must be a number.' });
		}
		if (cost !== null && cost < 0) return fail(400, { error: 'Cost can’t be negative.' });
		// Only lines without a product: product lines take their cost from Inventory.
		const r = await db.run(sql`
			update order_lines set cost_snapshot_paisa = ${cost}, cost_estimated = 0
			where variant_id is null and id in (select value from json_each(${JSON.stringify(ids)}))`);
		return {
			saved:
				cost === null
					? `Cost cleared on ${r.rowsAffected} line${r.rowsAffected === 1 ? '' : 's'}.`
					: `Cost Rs ${(cost / 100).toLocaleString('en-PK')} set on ${r.rowsAffected} line${r.rowsAffected === 1 ? '' : 's'}.`
		};
	}
};
