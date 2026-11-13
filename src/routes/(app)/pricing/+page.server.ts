import { fail } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import {
	getPricingSettings,
	marginFor,
	profitPerUnit,
	setPricingSettings,
	suggestedPrice,
	WINDOW_DAYS
} from '#lib/server/pricing.js';
import type { Actions, PageServerLoad } from './$types';

const VIEWS = ['losing', 'below', 'nocost', 'best', 'all'] as const;
type View = (typeof VIEWS)[number];
const v = schema.variants;

export const load: PageServerLoad = async ({ url }) => {
	const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as View)
		: 'below';
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

	const settings = await getPricingSettings();
	/** Markup and the margin it gives (used for colours and "Below target"). */
	const e = { multiplier: settings.multiplier, target: marginFor(settings.multiplier) };
	const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

	const variants = await db
		.select({
			id: v.id,
			productId: v.productId,
			productTitle: v.productTitle,
			isBundle: v.isBundle,
			/** Bundles: how many different items are inside. */
			bundleItems: sql<number>`(select count(*) from bundle_components bc where bc.bundle_id = ${v.id})`,
			imageUrl: v.imageUrl,
			variantTitle: v.variantTitle,
			sku: v.sku,
			price: v.price,
			cost: v.avgCost,
			costSource: v.costSource,
			onHand: v.shopifyOnHand
		})
		.from(v)
		.where(eq(v.status, 'ACTIVE'))
		.orderBy(asc(v.productTitle), asc(v.variantTitle));

	// Units delivered / returned per variant in the window.
	const sales = (await db.all(sql`
		with d as (
			select order_id, min(final_at) as at from shipments
			where status = 'delivered' and order_id is not null and match_status != 'excluded'
			group by order_id
		),
		r as (
			select distinct order_id from shipments
			where status = 'returned' and order_id is not null and final_at >= ${since}
				and order_id not in (select order_id from d)
		)
		select l.variant_id as id,
			sum(case when l.order_id in (select order_id from d where at >= ${since}) then l.qty else 0 end) as sold,
			sum(case when l.order_id in (select order_id from r) then l.qty else 0 end) as returned
		from order_lines l
		where l.variant_id is not null and l.qty > 0
		group by l.variant_id`)) as { id: string; sold: number; returned: number }[];
	const salesBy = new Map(sales.map((s) => [s.id, s]));

	const rows = variants.map((x) => {
		const s = salesBy.get(x.id);
		const profit = x.cost > 0 ? profitPerUnit(x.price, x.cost) : null;
		return {
			...x,
			sold: s?.sold ?? 0,
			returned: s?.returned ?? 0,
			profit,
			margin: profit !== null && x.price > 0 ? profit / x.price : null,
			suggested: suggestedPrice(x.cost, e.multiplier)
		};
	});

	const match = (r: (typeof rows)[number]) =>
		!q ||
		r.productTitle.toLowerCase().includes(q) ||
		(r.variantTitle ?? '').toLowerCase().includes(q) ||
		(r.sku ?? '').toLowerCase().includes(q);
	const inView: Record<View, (r: (typeof rows)[number]) => boolean> = {
		losing: (r) => r.profit !== null && r.profit < 0,
		below: (r) => r.margin !== null && r.margin < e.target,
		nocost: (r) => r.cost <= 0,
		best: (r) => r.sold > 0,
		all: () => true
	};
	const counts = Object.fromEntries(VIEWS.map((k) => [k, rows.filter(inView[k]).length])) as Record<
		View,
		number
	>;
	let list = rows.filter((r) => inView[view](r) && match(r));
	if (view === 'best') list = list.sort((a, b) => b.sold - a.sold);
	else if (view === 'losing' || view === 'below') {
		// Products with the biggest monthly money at stake first, variants kept together.
		const weight = new Map<string, number>();
		for (const r of list)
			weight.set(
				r.productId,
				(weight.get(r.productId) ?? 0) + r.sold * Math.abs(r.profit ?? 0) + 1
			);
		list = list.sort(
			(a, b) =>
				(weight.get(b.productId) ?? 0) - (weight.get(a.productId) ?? 0) ||
				a.productId.localeCompare(b.productId) ||
				(a.variantTitle ?? '').localeCompare(b.variantTitle ?? '')
		);
	}

	// Sales-weighted margin across everything sold in the window.
	const soldRows = rows.filter((r) => r.sold > 0 && r.profit !== null);
	const revenue = soldRows.reduce((t, r) => t + r.sold * r.price, 0);
	const profit = soldRows.reduce((t, r) => t + r.sold * r.profit!, 0);

	return {
		view,
		q,
		totalRows: list.length,
		counts,
		e,
		windowDays: WINDOW_DAYS,
		summary: {
			weightedMargin: revenue ? profit / revenue : null,
			monthlyProfit: Math.round((profit * 30) / WINDOW_DAYS)
		},
		rows: list // all at once (no pages)
	};
};

export const actions: Actions = {
	/** Markup on cost (e.g. 2.5): suggested price = cost × markup ÷ 0.96, ending in 99. */
	settings: async ({ request }) => {
		const mult = Number(
			String((await request.formData()).get('multiplier') ?? '').replace(/[x×,\s]/gi, '')
		);
		if (!(mult > 1 && mult <= 20)) return fail(400, { error: 'Markup must be above 1, e.g. 2.5.' });
		await setPricingSettings({ multiplier: mult });
		return { saved: `Markup set to ${mult}×.` };
	}
};

/** Vercel: pushing many prices can take a while. */
export const config = { maxDuration: 300 };
