/**
 * Restock (moved here from the dispatcher panel). Everything comes from this panel's own data —
 * no Shopify calls:
 *   sales     — units on orders placed in the last 30 / 60 / 90 days (not cancelled)
 *   on hand   — Shopify on-hand from the last sync (the panel syncs on open)
 *   committed — units on orders not shipped yet (already promised to customers)
 *   available — on hand − committed
 *   incoming  — units on purchases that haven't arrived yet (drafts included)
 */
import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { getSetting, setSetting } from './settings.js';
import { calcRestock, type LiveStock } from '../restock-calc.js';

export type LeadTimes = { airDays: number; seaDays: number };
const DEFAULT_LEAD: LeadTimes = { airDays: 15, seaDays: 45 };

export async function getLead(): Promise<LeadTimes> {
	return (await getSetting<LeadTimes>('restock_lead')) ?? DEFAULT_LEAD;
}
export async function setLead(l: LeadTimes) {
	await setSetting('restock_lead', l);
}

/** Units sold per variant in the last 30 / 60 / 90 days (by order date). */
export async function variantSales(ids?: string[]) {
	const now = Date.now();
	const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
	const rows = (await db.all(sql`
		select l.variant_id as id,
			sum(case when o.created_at >= ${ago(30)} then l.qty else 0 end) as s30,
			sum(case when o.created_at >= ${ago(60)} then l.qty else 0 end) as s60,
			sum(l.qty) as s90
		from order_lines l join orders o on o.id = l.order_id
		where o.created_at >= ${ago(90)} and o.cancelled_at is null and o.test = 0
			and l.qty > 0 and l.variant_id is not null
			${ids ? sql`and l.variant_id in (select value from json_each(${JSON.stringify(ids)}))` : sql``}
		group by l.variant_id`)) as { id: string; s30: number; s60: number; s90: number }[];
	return new Map(rows.map((r) => [r.id, { s30: r.s30, s60: r.s60, s90: r.s90 }]));
}

/** Current stock position per variant (see file comment). */
export async function liveStock(ids: string[]): Promise<Map<string, LiveStock>> {
	if (!ids.length) return new Map();
	const list = JSON.stringify(ids);
	const rows = (await db.all(sql`
		select v.id,
			max(coalesce(v.shopify_on_hand, 0), 0) as onHand,
			coalesce((select sum(l.qty) from order_lines l join orders o on o.id = l.order_id
				where l.variant_id = v.id and l.qty > 0 and o.cancelled_at is null and o.test = 0
					and coalesce(o.fulfillment_status, 'UNFULFILLED') in ('UNFULFILLED', 'ON_HOLD', 'SCHEDULED')), 0) as committed,
			coalesce((select sum(bi.qty) from batch_items bi join import_batches b on b.id = bi.batch_id
				where bi.variant_id = v.id and b.status != 'landed'), 0) as incoming
		from variants v
		where v.id in (select value from json_each(${list}))`)) as {
		id: string;
		onHand: number;
		committed: number;
		incoming: number;
	}[];
	return new Map(
		rows.map((r) => [
			r.id,
			{
				onHand: r.onHand,
				committed: r.committed,
				available: r.onHand - r.committed,
				incoming: r.incoming
			}
		])
	);
}

/** Session must exist; returns it with the lead times. */
export async function getSession(id: string) {
	const [session, lead] = await Promise.all([
		db.query.restockSessions.findFirst({ where: eq(schema.restockSessions.id, id) }),
		getLead()
	]);
	if (!session) error(404, 'Restock session not found');
	return { session, lead };
}

/**
 * New session over every active product (bundles excluded — they hold no stock of their own),
 * most urgent product first; products that aren't selling keep catalogue order at the end.
 */
export async function startSession() {
	const v = schema.variants;
	const variants = await db
		.select({
			id: v.id,
			productId: v.productId,
			productTitle: v.productTitle,
			variantTitle: v.variantTitle,
			sku: v.sku,
			imageUrl: v.imageUrl
		})
		.from(v)
		.where(and(eq(v.status, 'ACTIVE'), eq(v.isBundle, false)))
		.orderBy(asc(v.productTitle), asc(v.variantTitle));
	const ids = variants.map((x) => x.id);
	const [sales, stock, lead] = await Promise.all([variantSales(), liveStock(ids), getLead()]);
	const noStock: LiveStock = { onHand: 0, available: 0, committed: 0, incoming: 0 };

	const byProduct = new Map<string, typeof variants>();
	for (const x of variants) {
		const list = byProduct.get(x.productId);
		if (list) list.push(x);
		else byProduct.set(x.productId, [x]);
	}
	const ranked = [...byProduct.values()]
		.map((list, catalogIndex) => {
			const rows = list.map((x) => {
				const s = sales.get(x.id) ?? { s30: 0, s60: 0, s90: 0 };
				const st = stock.get(x.id) ?? noStock;
				return { x, s, st, calc: calcRestock(s, st, lead) };
			});
			const cover = Math.min(...rows.map((r) => r.calc.coverDays ?? Infinity));
			return { rows, cover, catalogIndex };
		})
		.sort((a, b) => a.cover - b.cover || a.catalogIndex - b.catalogIndex);

	const [session] = await db
		.insert(schema.restockSessions)
		.values({ totalProducts: ranked.length })
		.returning({ id: schema.restockSessions.id });

	const items: (typeof schema.restockItems.$inferInsert)[] = [];
	let variantPosition = 0;
	ranked.forEach(({ rows }, position) => {
		const productImage = rows.find((r) => r.x.imageUrl)?.x.imageUrl ?? null;
		for (const { x, s, st, calc } of rows)
			items.push({
				sessionId: session.id,
				productId: x.productId,
				variantId: x.id,
				productTitle: x.productTitle,
				variantTitle: rows.length > 1 ? (x.variantTitle ?? 'Default') : null,
				sku: x.sku,
				productImageUrl: productImage,
				variantImageUrl: x.imageUrl,
				sales30: s.s30,
				sales60: s.s60,
				sales90: s.s90,
				currentStock: st.available,
				recAir: calc.recAir,
				recSea: calc.recSea,
				position,
				variantPosition: variantPosition++
			});
	});
	for (let i = 0; i < items.length; i += 100)
		await db.insert(schema.restockItems).values(items.slice(i, i + 100));
	return session.id;
}
