/**
 * Pricing: cost-plus.
 *
 *   suggested price = cost × multiplier ÷ (1 − 4% COD tax), rounded up to end in 99
 *   profit / piece  = price × (1 − 4%) − cost
 *
 * ÷ 0.96 so the owner keeps cost × multiplier after PostEx withholds 4% (ITWH 2% + STWH 2%);
 * advance orders get 5% off instead, which the same allowance covers. Courier and packaging are
 * not counted: the store never ships orders under Rs 500, so they are covered.
 * Ads, salaries and rent are left out — the markup covers them.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { getSetting, setSetting } from './settings.js';
import { shopifyGql } from './shopify.js';

/** "Sold in the last N days" column on the Pricing page. */
export const WINDOW_DAYS = 90;
/** Courier tax withheld on COD (ITWH 2% + STWH 2%). Applied to every sale. */
export const COD_TAX = 0.04;
export const DEFAULT_MULTIPLIER = 2.5;

export type PricingSettings = { multiplier: number };

export async function getPricingSettings(): Promise<PricingSettings> {
	const s = await getSetting<Partial<PricingSettings>>('pricing');
	return { multiplier: s?.multiplier ?? DEFAULT_MULTIPLIER };
}
export async function setPricingSettings(p: PricingSettings) {
	await setSetting('pricing', p);
}

/** The margin a markup gives: profit / price = (1 − tax)(M − 1) / M. Used as the "target". */
export const marginFor = (multiplier: number) => ((1 - COD_TAX) * (multiplier - 1)) / multiplier;

/** Round up to a price ending in 99 (rupees): 1,234 → 1,299; 480 → 499. Paisa in/out. */
export function round99(paisa: number) {
	const rs = Math.ceil(paisa / 100);
	return (Math.ceil((rs + 1) / 100) * 100 - 1) * 100;
}

export function profitPerUnit(price: number, cost: number) {
	return Math.round(price * (1 - COD_TAX) - cost);
}

export function suggestedPrice(cost: number, multiplier: number): number | null {
	if (cost <= 0) return null;
	return round99((cost * multiplier) / (1 - COD_TAX));
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
	return { done: done.length, failed: failed.length, doneIds: done, failedIds: failed };
}
