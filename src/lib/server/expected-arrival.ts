/**
 * "Expected back" date per variant, for the shop's out-of-stock message.
 *
 * A purchase that is marked purchased (not yet arrived) and has "expected arrival (days)" gives
 * each of its variants an expected date = ordered on + days. A variant on several open purchases
 * gets the EARLIEST date. When that purchase arrives the next open one takes over; with none
 * left the date is cleared. The date is kept whether or not the variant is in stock right now —
 * the theme decides when to show it (out of stock only).
 *
 * Shopify: variant metafield custom.expected_arrival (type date). Pushed only when it changes;
 * the last pushed value is kept in variants.expected_arrival.
 */
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { shopifyGql } from './shopify.js';

const NS = 'custom';
const KEY = 'expected_arrival';

/** Earliest expected date (YYYY-MM-DD) per variant among open purchases. */
async function earliestDates(variantIds: string[]) {
	if (!variantIds.length) return new Map<string, string>();
	const rows = (await db.all(sql`
		select bi.variant_id as id,
			min(date(b.paid_on, '+' || b.expected_days || ' days')) as d
		from batch_items bi join import_batches b on b.id = bi.batch_id
		where b.status in ('paid', 'landing') and b.paid_on is not null and b.expected_days is not null
			and bi.variant_id in (select value from json_each(${JSON.stringify(variantIds)}))
		group by bi.variant_id`)) as { id: string; d: string | null }[];
	return new Map(rows.filter((r) => r.d).map((r) => [r.id, r.d!]));
}

let definitionChecked = false;
/** Make sure the metafield is defined in Shopify (shows in admin; readable by the theme). */
async function ensureDefinition() {
	if (definitionChecked) return;
	await shopifyGql(
		`mutation {
			metafieldDefinitionCreate(definition: {
				name: "Expected arrival", namespace: "${NS}", key: "${KEY}", type: "date",
				ownerType: PRODUCTVARIANT,
				description: "When this variant is expected back in stock (set by the accounts panel).",
				access: { storefront: PUBLIC_READ }
			}) { userErrors { code message } }
		}`
	).catch(() => null); // already exists / no permission: the metafield still works without it
	definitionChecked = true;
}

/**
 * Recompute and push the expected date for these variants. Never throws: a Shopify hiccup must
 * not break saving a purchase. Returns how many changed / failed.
 */
export async function syncExpectedArrival(variantIds: string[]) {
	const ids = [...new Set(variantIds)];
	if (!ids.length) return { changed: 0, failed: 0 };
	try {
		const want = await earliestDates(ids);
		const current = await db
			.select({ id: schema.variants.id, at: schema.variants.expectedArrival })
			.from(schema.variants)
			.where(inArray(schema.variants.id, ids));
		const changes = current
			.map((c) => ({ id: c.id, from: c.at, to: want.get(c.id) ?? null }))
			.filter((c) => c.from !== c.to);
		if (!changes.length) return { changed: 0, failed: 0 };

		await ensureDefinition();
		const ok: typeof changes = [];
		let failed = 0;
		const sets = changes.filter((c) => c.to);
		const clears = changes.filter((c) => !c.to);
		for (let i = 0; i < sets.length; i += 25) {
			const chunk = sets.slice(i, i + 25);
			const d = await shopifyGql<{ metafieldsSet: { userErrors: { message: string }[] } }>(
				`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`,
				{
					m: chunk.map((c) => ({
						ownerId: `gid://shopify/ProductVariant/${c.id}`,
						namespace: NS,
						key: KEY,
						type: 'date',
						value: c.to
					}))
				}
			).catch(() => null);
			if (d && !d.metafieldsSet.userErrors.length) ok.push(...chunk);
			else failed += chunk.length;
		}
		for (let i = 0; i < clears.length; i += 25) {
			const chunk = clears.slice(i, i + 25);
			const d = await shopifyGql<{ metafieldsDelete: { userErrors: { message: string }[] } }>(
				`mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { message } } }`,
				{
					m: chunk.map((c) => ({
						ownerId: `gid://shopify/ProductVariant/${c.id}`,
						namespace: NS,
						key: KEY
					}))
				}
			).catch(() => null);
			if (d && !d.metafieldsDelete.userErrors.length) ok.push(...chunk);
			else failed += chunk.length;
		}
		for (let i = 0; i < ok.length; i += 100) {
			const stmts = ok.slice(i, i + 100).map((c) =>
				db
					.update(schema.variants)
					.set({ expectedArrival: c.to })
					.where(sql`${schema.variants.id} = ${c.id}`)
			);
			await db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
		}
		return { changed: ok.length, failed };
	} catch {
		return { changed: 0, failed: ids.length };
	}
}

/** Variant ids on a purchase. */
export async function purchaseVariantIds(batchId: string) {
	return (
		await db
			.select({ id: schema.batchItems.variantId })
			.from(schema.batchItems)
			.where(sql`${schema.batchItems.batchId} = ${batchId}`)
	).map((r) => r.id);
}
