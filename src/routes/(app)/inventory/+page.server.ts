import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gt, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { getRates, stockSummary } from '#lib/server/costing.js';
import {
	classifyStockChanges,
	stockElsewhere,
	VARIANCE_REASONS,
	type VarianceReason
} from '#lib/server/stock.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 100;
const VIEWS = ['needs', 'noweight', 'estimated', 'all'] as const;
type View = (typeof VIEWS)[number];
const v = schema.variants;

const VIEW_WHERE: Record<View, SQL | undefined> = {
	needs: and(gt(v.shopifyOnHand, 0), eq(v.avgCost, 0)),
	noweight: and(eq(v.status, 'ACTIVE'), eq(v.isBundle, false), sql`coalesce(${v.weightG}, 0) = 0`),
	estimated: or(eq(v.costSource, 'estimated'), eq(v.costSource, 'shopify')),
	all: undefined
};

export const load: PageServerLoad = async ({ url }) => {
	const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as View)
		: 'needs';
	const q = url.searchParams.get('q')?.trim() ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const rates = await getRates();
	// Draft/archived products are leftovers (owner): never shown or valued.
	const active = and(eq(v.status, 'ACTIVE'), eq(v.isBundle, false))!; // bundles hold no stock of their own
	const where_ = (k: View) => and(active, VIEW_WHERE[k]);
	const filters = [where_(view)];
	if (q) filters.push(or(like(v.productTitle, `%${q}%`), like(v.sku, `%${q}%`)));
	const where = and(...filters.filter(Boolean));

	const [{ n }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(v)
		.where(where);
	const rows = await db
		.select({
			id: v.id,
			productId: v.productId,
			productTitle: v.productTitle,
			imageUrl: v.imageUrl,
			variantTitle: v.variantTitle,
			sku: v.sku,
			status: v.status,
			weightG: v.weightG,
			price: v.price,
			onHand: v.shopifyOnHand,
			shopifyCost: v.shopifyCost,
			shopifyCostOk: v.shopifyCostOk,
			cnPrice: v.estCnPriceMinor,
			currency: v.estCurrency,
			ddp: v.estDdp,
			estCost: v.estCost,
			avgCost: v.avgCost,
			costSource: v.costSource
		})
		.from(v)
		.where(where)
		// Products with the most stock first; a product's variants stay together.
		.orderBy(
			desc(sql`sum(max(coalesce(${v.shopifyOnHand}, 0), 0)) over (partition by ${v.productId})`),
			asc(v.productTitle),
			asc(v.productId),
			asc(v.variantTitle)
		)
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE);

	const counts = Object.fromEntries(
		await Promise.all(
			VIEWS.map(async (k) => {
				const [{ n }] = await db
					.select({ n: sql<number>`count(*)` })
					.from(v)
					.where(where_(k));
				return [k, n] as const;
			})
		)
	) as Record<View, number>;

	const [{ opening }] = await db
		.select({ opening: sql<number>`count(*)` })
		.from(schema.stockMovements)
		.where(eq(schema.stockMovements.type, 'opening'));

	const sm = schema.stockMovements;
	const changes = await db
		.select({
			id: sm.id,
			at: sm.at,
			qty: sm.qtyDelta,
			unitCost: sm.unitCost,
			productTitle: v.productTitle,
			imageUrl: v.imageUrl,
			variantTitle: v.variantTitle,
			sku: v.sku
		})
		.from(sm)
		.leftJoin(v, eq(v.id, sm.variantId))
		.where(and(eq(sm.type, 'variance'), isNull(sm.reason)))
		.orderBy(desc(sm.at), asc(v.productTitle))
		.limit(300);
	// Decisions from the last 90 days stay changeable (a wrong reason can be fixed).
	const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
	const decided = await db
		.select({
			id: sm.id,
			at: sm.at,
			qty: sm.qtyDelta,
			unitCost: sm.unitCost,
			avgCost: v.avgCost,
			reason: sm.reason,
			productTitle: v.productTitle,
			imageUrl: v.imageUrl,
			variantTitle: v.variantTitle,
			sku: v.sku
		})
		.from(sm)
		.leftJoin(v, eq(v.id, sm.variantId))
		.where(and(eq(sm.type, 'variance'), sql`${sm.reason} is not null`, sql`${sm.at} >= ${since}`))
		.orderBy(desc(sm.at), asc(v.productTitle))
		.limit(200);
	const lastCheck = await db.query.settings.findFirst({
		where: eq(schema.settings.key, 'stock_checked_at')
	});

	return {
		changes,
		decided,
		lastStockCheck: lastCheck ? (JSON.parse(lastCheck.value) as string) : null,
		elsewhere: await stockElsewhere(),
		view,
		q,
		page,
		pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)),
		totalRows: n,
		counts,
		rates,
		summary: await stockSummary(),
		openingRecorded: opening > 0,
		rows
	};
};

export const actions: Actions = {
	/** Give a reason to one or many Shopify stock changes. */
	classify: async ({ request }) => {
		const f = await request.formData();
		const reason = String(f.get('reason')) as VarianceReason;
		if (!VARIANCE_REASONS.includes(reason)) return fail(400, { error: 'Pick a reason.' });
		const ids = f.getAll('id').map(String).filter(Boolean);
		const n = await classifyStockChanges(ids, reason);
		return { saved: `${n} stock change${n === 1 ? '' : 's'} updated.` };
	}
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
