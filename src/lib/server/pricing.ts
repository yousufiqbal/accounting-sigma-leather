/**
 * Pricing: true profit per unit and suggested prices.
 *
 * Selling costs come from the last WINDOW_DAYS of delivered orders (by delivery date):
 *   % of price  — courier withholding (ITWH+STWH), 5% advance discount, other discounts
 *   Rs per order — courier delivery + return fees, packaging, minus shipping charged
 * Ads and fixed costs (salaries, rent…) are deliberately left out (owner's choice).
 *
 * profit/unit = price × (1 − pct) − cost − perOrder / unitsPerOrder
 * suggested   = round99((cost + perOrder / unitsPerOrder) / (1 − pct − target))
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { getSetting, setSetting } from './settings.js';
import { shopifyGql } from './shopify.js';

export const WINDOW_DAYS = 90;

export type SellingCosts = {
	orders: number;
	unitsPerOrder: number;
	withholdingPct: number; // fraction of net sales
	advancePct: number; // fraction of gross item sales
	otherDiscountPct: number;
	courierPerOrder: number; // paisa, delivery + returns (incl. tax)
	packagingPerOrder: number; // paisa
	shippingPerOrder: number; // paisa charged to customers (offsets courier)
};

export type CostInputs = Omit<SellingCosts, 'orders'>;

export type PricingSettings = {
	targetMargin: number; // fraction, e.g. 0.3
	/**
	 * adjusting — selling costs follow the last WINDOW_DAYS (plus any overrides below).
	 * fixed     — the owner's own numbers (`fixed`), unchanged until edited.
	 * Either way each product's pieces-per-order share is measured (it's how the product sells).
	 */
	mode?: 'adjusting' | 'fixed';
	/** Adjusting mode: owner overrides of single measured values. */
	overrides: Partial<CostInputs>;
	/** Unused since fixed mode became cost-plus (kept so old saved settings still parse). */
	fixed?: CostInputs;
	/** Fixed mode: price = cost × multiplier ÷ (1 − COD tax). E.g. 2.5. */
	multiplier?: number;
};

/** Courier tax withheld on COD (ITWH 2% + STWH 2%). Fixed mode applies it to every sale. */
export const COD_TAX = 0.04;
export const DEFAULT_MULTIPLIER = 2.5;

const COST_KEYS = [
	'unitsPerOrder',
	'withholdingPct',
	'advancePct',
	'otherDiscountPct',
	'courierPerOrder',
	'packagingPerOrder',
	'shippingPerOrder'
] as const;

/** The selling-cost numbers currently in use, as a plain set (for freezing into fixed mode). */
export function currentInputs(m: SellingCosts, s: PricingSettings): CostInputs {
	const e = effective(m, { ...s, mode: 'adjusting' });
	return Object.fromEntries(COST_KEYS.map((k) => [k, e[k]])) as CostInputs;
}

export async function getPricingSettings(): Promise<PricingSettings> {
	return (await getSetting<PricingSettings>('pricing')) ?? { targetMargin: 0.3, overrides: {} };
}
export async function setPricingSettings(p: PricingSettings) {
	await setSetting('pricing', p);
}

export async function measuredCosts(): Promise<SellingCosts> {
	const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
	const sinceDate = since.slice(0, 10);
	const [o] = (await db.all(sql`
		with d as (
			select order_id, min(final_at) as at from shipments
			where status = 'delivered' and order_id is not null and match_status != 'excluded'
			group by order_id
		)
		select count(*) as orders,
			coalesce(sum(o.gross_sales_paisa), 0) as gross,
			coalesce(sum(o.prepaid_discount_paisa), 0) as advance,
			coalesce(sum(o.total_discounts_paisa - o.prepaid_discount_paisa), 0) as other,
			coalesce(sum(o.shipping_charged_paisa), 0) as shipping,
			coalesce(sum(o.total_paisa), 0) as net
		from d join orders o on o.id = d.order_id
		where d.at >= ${since} and o.cancelled_at is null and o.total_paisa > 0`)) as {
		orders: number;
		gross: number;
		advance: number;
		other: number;
		shipping: number;
		net: number;
	}[];
	const [c] = (await db.all(sql`
		select
			coalesce(sum(case when status = 'delivered' then fee_paisa + fee_tax_paisa + other_fees_paisa else 0 end), 0) as delivery,
			coalesce(sum(case when status = 'returned' then fee_paisa + fee_tax_paisa + return_fee_paisa + return_fee_tax_paisa + other_fees_paisa else 0 end), 0) as returns,
			coalesce(sum(case when status = 'delivered' then itwh_paisa + stwh_paisa else 0 end), 0) as withholding
		from shipments
		where final_at >= ${since} and status in ('delivered', 'returned') and match_status != 'excluded'`)) as {
		delivery: number;
		returns: number;
		withholding: number;
	}[];
	const [p] = (await db.all(sql`
		select coalesce(sum(e.amount_paisa), 0) as packaging
		from expenses e join expense_categories c on c.id = e.category_id
		where c.name = 'Packaging' and e.date >= ${sinceDate}`)) as { packaging: number }[];
	// Median pieces per order: bulk orders (20 thread spools) would skew the mean upwards.
	const per = (
		(await db.all(sql`
		with d as (
			select order_id, min(final_at) as at from shipments
			where status = 'delivered' and order_id is not null and match_status != 'excluded'
			group by order_id
		)
		select (select sum(qty) from order_lines l where l.order_id = o.id and l.qty > 0) as units
		from d join orders o on o.id = d.order_id
		where d.at >= ${since} and o.cancelled_at is null and o.total_paisa > 0`)) as {
			units: number | null;
		}[]
	)
		.map((r) => Number(r.units ?? 0))
		.filter((u) => u > 0)
		.sort((a, b) => a - b);
	const medianUnits = per.length ? per[Math.floor(per.length / 2)] : 1;
	const n = Math.max(1, o.orders);
	return {
		orders: o.orders,
		unitsPerOrder: medianUnits,
		withholdingPct: o.net ? c.withholding / o.net : 0.04,
		advancePct: o.gross ? o.advance / o.gross : 0,
		otherDiscountPct: o.gross ? o.other / o.gross : 0,
		courierPerOrder: Math.round((c.delivery + c.returns) / n),
		packagingPerOrder: Math.round(p.packaging / n),
		shippingPerOrder: Math.round(o.shipping / n)
	};
}

/** Measured costs with owner overrides applied, plus the two numbers the formula needs. */
export function effective(m: SellingCosts, s: PricingSettings) {
	const c = { ...m, ...s.overrides };
	const pct = c.withholdingPct + c.advancePct + c.otherDiscountPct;
	const perOrder = c.courierPerOrder + c.packagingPerOrder - c.shippingPerOrder;
	const perUnit = Math.round(perOrder / Math.max(1, c.unitsPerOrder));
	const mode = s.mode ?? 'adjusting';
	const multiplier = s.multiplier ?? DEFAULT_MULTIPLIER;
	// Fixed mode's "target" = the margin its multiplier gives: profit / price = (1 − tax)(M − 1) / M.
	const target =
		mode === 'fixed' ? ((1 - COD_TAX) * (multiplier - 1)) / multiplier : s.targetMargin;
	return { ...c, pct, perOrder, perUnit, target, mode, multiplier };
}
export type Effective = ReturnType<typeof effective>;

/** Round up to a price ending in 99 (rupees): 1,234 → 1,299; 480 → 499. Paisa in/out. */
export function round99(paisa: number) {
	const rs = Math.ceil(paisa / 100);
	return (Math.ceil((rs + 1) / 100) * 100 - 1) * 100;
}

/**
 * Profit per piece.
 *   adjusting: price × (1 − pct) − cost − perUnit  (perUnit = product's share of the per-order cost)
 *   fixed:     price × (1 − 4%) − cost              (cost-plus; the Rs 500 minimum order covers courier)
 */
export function profitPerUnit(price: number, cost: number, e: Effective, perUnit = e.perUnit) {
	if (e.mode === 'fixed') return Math.round(price * (1 - COD_TAX) - cost);
	return Math.round(price * (1 - e.pct) - cost - perUnit);
}

/** adjusting: hits the target margin; fixed: cost × multiplier ÷ (1 − 4%). Both end in 99. */
export function suggestedPrice(cost: number, e: Effective, perUnit = e.perUnit): number | null {
	if (cost <= 0) return null;
	if (e.mode === 'fixed') return round99((cost * e.multiplier) / (1 - COD_TAX));
	const denom = 1 - e.pct - e.target;
	if (denom <= 0.05) return null;
	return round99((cost + perUnit) / denom);
}

/** Orders needed before a product's own pieces-per-order is trusted over the store-wide one. */
export const MIN_PRODUCT_ORDERS = 3;
/** Buying pattern changes slowly — look back a year. */
const PATTERN_DAYS = 365;

/**
 * Pieces per order FOR EACH PRODUCT: median total pieces in delivered orders containing it.
 * Bulk items (sold 10–50 at a time) share one order's courier cost over many pieces; items
 * usually bought alone carry most of it. Products with too few orders are left out (→ store-wide).
 */
export async function productUnitsPerOrder(): Promise<
	Map<string, { units: number; orders: number }>
> {
	const since = new Date(Date.now() - PATTERN_DAYS * 86_400_000).toISOString();
	const rows = (await db.all(sql`
		with d as (
			select order_id from shipments
			where status = 'delivered' and order_id is not null and match_status != 'excluded'
			group by order_id having min(final_at) >= ${since}
		),
		ou as (
			select l.order_id, sum(l.qty) as units from order_lines l
			where l.qty > 0 and l.order_id in (select order_id from d)
			group by l.order_id
		)
		select distinct v.product_id as productId, ou.order_id as orderId, ou.units
		from order_lines l
		join variants v on v.id = l.variant_id
		join ou on ou.order_id = l.order_id
		where l.qty > 0`)) as { productId: string; orderId: string; units: number }[];
	const by = new Map<string, number[]>();
	for (const r of rows) {
		const list = by.get(r.productId);
		if (list) list.push(r.units);
		else by.set(r.productId, [r.units]);
	}
	const out = new Map<string, { units: number; orders: number }>();
	for (const [id, list] of by) {
		if (list.length < MIN_PRODUCT_ORDERS) continue;
		list.sort((a, b) => a - b);
		out.set(id, { units: list[Math.floor(list.length / 2)], orders: list.length });
	}
	return out;
}

/** This product's share of the per-order selling cost, per piece. */
export function productPerUnit(e: Effective, pattern: { units: number } | undefined): number {
	if (!pattern) return e.perUnit;
	return Math.round(e.perOrder / Math.max(1, pattern.units));
}

// ─── Push to Shopify ───────────────────────────────────────────────────────────

/** Set new prices in Shopify (grouped per product), then locally + price history. */
export async function pushPrices(changes: { id: string; price: number }[]) {
	const vars = await db
		.select({
			id: schema.variants.id,
			productId: schema.variants.productId,
			price: schema.variants.price,
			cost: schema.variants.avgCost
		})
		.from(schema.variants)
		.where(
			inArray(
				schema.variants.id,
				changes.map((c) => c.id)
			)
		);
	const byId = new Map(vars.map((v) => [v.id, v]));
	const byProduct = new Map<string, { id: string; price: number }[]>();
	for (const c of changes) {
		const v = byId.get(c.id);
		if (!v || c.price <= 0 || c.price === v.price) continue;
		byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), c]);
	}
	const done: string[] = [];
	const failed: string[] = [];
	const at = new Date().toISOString();
	for (const [productId, list] of byProduct) {
		const d = await shopifyGql<{
			productVariantsBulkUpdate: { userErrors: { message: string }[] };
		}>(
			`mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) {
				productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } }
			}`,
			{
				p: `gid://shopify/Product/${productId}`,
				v: list.map((c) => ({
					id: `gid://shopify/ProductVariant/${c.id}`,
					price: (c.price / 100).toFixed(2)
				}))
			}
		).catch((e) => ({ productVariantsBulkUpdate: { userErrors: [{ message: String(e) }] } }));
		if (d.productVariantsBulkUpdate.userErrors.length) {
			failed.push(...list.map((c) => c.id));
			continue;
		}
		await db.batch(
			list.flatMap((c) => [
				db
					.update(schema.variants)
					.set({ price: c.price, updatedAt: at })
					.where(eq(schema.variants.id, c.id)),
				db.insert(schema.priceChanges).values({
					variantId: c.id,
					at,
					oldPrice: byId.get(c.id)!.price,
					newPrice: c.price,
					costAtChange: byId.get(c.id)!.cost
				})
			]) as [never, ...never[]]
		);
		done.push(...list.map((c) => c.id));
	}
	return { done: done.length, failed: failed.length };
}
