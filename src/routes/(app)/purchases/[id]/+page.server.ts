import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { landBatch, loadBatch } from '#lib/server/stock.js';
import { purchaseVariantIds, syncExpectedArrival } from '#lib/server/expected-arrival.js';
import { getLead } from '#lib/server/restock.js';
import type { Actions, PageServerLoad } from './$types';

const v = schema.variants;
const bi = schema.batchItems;

/**
 * Items as listed on the purchase: the product added most recently first; a product's variants
 * stay together in Shopify order. `lines` arrive in the order they were added.
 */
function newestFirst<
	L extends {
		variantId: string;
		variant: { productId: string; position: number | null; variantTitle: string | null } | null;
	}
>(lines: L[]): L[] {
	const pid = (l: L) => l.variant?.productId ?? l.variantId;
	const lastAdded = new Map<string, number>();
	lines.forEach((l, i) => lastAdded.set(pid(l), i));
	return [...lines].sort(
		(a, c) =>
			lastAdded.get(pid(c))! - lastAdded.get(pid(a))! ||
			(a.variant?.position ?? 999999) - (c.variant?.position ?? 999999) ||
			(a.variant?.variantTitle ?? '').localeCompare(c.variant?.variantTitle ?? '')
	);
}

export const load: PageServerLoad = async ({ params }) => {
	const b = await loadBatch(params.id);
	if (!b) error(404, 'Purchase not found');
	const vars = b.lines.length
		? await db
				.select({
					id: v.id,
					productTitle: v.productTitle,
					variantTitle: v.variantTitle,
					sku: v.sku,
					onHand: v.shopifyOnHand,
					avgCost: v.avgCost,
					costSource: v.costSource,
					productId: v.productId,
					position: v.position,
					imageUrl: v.imageUrl,
					weightG: v.weightG
				})
				.from(v)
				.where(
					inArray(
						v.id,
						b.lines.map((l) => l.variantId)
					)
				)
		: [];
	const byId = new Map(vars.map((x) => [x.id, x]));
	const options = await db
		.select({
			id: v.id,
			productId: v.productId,
			productTitle: v.productTitle,
			variantTitle: v.variantTitle,
			sku: v.sku,
			imageUrl: v.imageUrl,
			status: v.status,
			isBundle: v.isBundle
		})
		.from(v)
		.orderBy(
			asc(v.productTitle),
			asc(v.productId),
			asc(sql`coalesce(${v.position}, 999999)`),
			asc(v.variantTitle)
		);
	return {
		lead: await getLead(),
		batch: b.batch,
		costs: b.costs,
		totals: b.totals,
		shipment: b.shipment,
		lines: newestFirst(b.lines.map((l) => ({ ...l, variant: byId.get(l.variantId) ?? null }))),
		// Draft/archived products are leftovers, and bundles are bought as their components.
		options: options
			.filter((o) => o.status === 'ACTIVE' && !o.isBundle)
			.map((o) => ({
				id: o.id,
				productId: o.productId,
				title: o.productTitle,
				variant: o.variantTitle,
				sku: o.sku,
				image: o.imageUrl
			}))
	};
};

async function editable(id: string) {
	const batch = await db.query.importBatches.findFirst({ where: eq(schema.importBatches.id, id) });
	if (!batch) error(404, 'Purchase not found');
	if (batch.status === 'landed' || batch.status === 'landing') return null;
	return batch;
}
const LANDED = {
	error: 'This purchase has arrived (or is being added to stock) and can no longer be changed.'
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Add qty to an existing line for the variant, or create one (weight from Shopify). */
async function addItem(batchId: string, variantId: string, qty: number, priceMinor: number) {
	const variant = await db.query.variants.findFirst({ where: eq(v.id, variantId) });
	if (!variant) return false;
	const existing = await db.query.batchItems.findFirst({
		where: and(eq(bi.batchId, batchId), eq(bi.variantId, variantId))
	});
	if (existing)
		await db
			.update(bi)
			.set({
				qty: existing.qty + qty,
				unitPriceForeignMinor: priceMinor || existing.unitPriceForeignMinor
			})
			.where(eq(bi.id, existing.id));
	else
		await db.insert(bi).values({
			batchId,
			variantId,
			qty,
			unitPriceForeignMinor: priceMinor,
			unitWeightG: variant.weightG ?? 0
		});
	return true;
}

export const actions: Actions = {
	header: async ({ params, request }) => {
		const batch = await editable(params.id);
		if (!batch) return fail(400, LANDED);
		const f = await request.formData();
		const ref = String(f.get('ref') ?? '').trim();
		if (!ref) return fail(400, { error: 'Name is required.' });
		let fx = batch.fxRateX10000;
		try {
			if (batch.currency !== 'PKR') {
				fx = Math.round(Number(String(f.get('fx')).replace(/,/g, '')) * 10_000);
				if (!Number.isFinite(fx) || fx <= 0) throw new Error();
			}
		} catch {
			return fail(400, { error: 'Rates must be numbers.' });
		}
		const daysRaw = String(f.get('expectedDays') ?? '').trim();
		const expectedDays = daysRaw === '' ? null : Number(daysRaw);
		if (
			expectedDays !== null &&
			!(Number.isInteger(expectedDays) && expectedDays >= 0 && expectedDays <= 365)
		)
			return fail(400, { error: 'Expected arrival must be whole days (0–365).' });
		const orderedOn = String(f.get('orderedOn') ?? '');
		await db
			.update(schema.importBatches)
			.set({
				ref,
				supplier: String(f.get('supplier') ?? '').trim() || null,
				notes: String(f.get('notes') ?? '').trim() || null,
				fxRateX10000: fx,
				expectedDays,
				...(batch.status === 'paid' && isDate(orderedOn) ? { paidOn: orderedOn } : {})
			})
			.where(eq(schema.importBatches.id, params.id));
		if (batch.status === 'paid') await syncExpectedArrival(await purchaseVariantIds(params.id));
		return { saved: 'Saved.' };
	},

	/** Shipment transport: billed box weight (kg) × rate, or one fixed bill. */
	shipment: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const f = await request.formData();
		const num = (k: string) => {
			const s = String(f.get(k) ?? '')
				.trim()
				.replace(/,/g, '');
			if (s === '') return null;
			const n = Number(s);
			if (!Number.isFinite(n) || n < 0) throw new Error(k);
			return n;
		};
		let china: number | null;
		try {
			china = num('china');
		} catch {
			return fail(400, { error: 'China shipping must be a number.' });
		}
		const chinaShipMinor = china ? Math.round(china * 100) : null;
		if (f.get('mode') === 'fixed') {
			let bill: number | null;
			try {
				bill = num('bill');
			} catch {
				return fail(400, { error: 'The bill must be a number.' });
			}
			if (bill === null) return fail(400, { error: 'Enter the transport bill.' });
			await db
				.update(schema.importBatches)
				.set({
					ddpTotal: Math.round(bill * 100),
					transportSplit: f.get('split') === 'value' ? 'value' : 'weight',
					chinaShipMinor
				})
				.where(eq(schema.importBatches.id, params.id));
			return { saved: 'Transport bill saved and split across items.' };
		}
		let kg: number | null, rate: number | null;
		try {
			kg = num('billedKg');
			rate = num('ddp');
		} catch {
			return fail(400, { error: 'Weight and rate must be numbers.' });
		}
		await db
			.update(schema.importBatches)
			.set({
				billedWeightG: kg === null ? null : Math.round(kg * 1000),
				ddpRatePerKg: Math.round((rate ?? 0) * 100),
				ddpTotal: null,
				chinaShipMinor
			})
			.where(eq(schema.importBatches.id, params.id));
		return {
			saved:
				kg === null
					? 'Saved — transport still pending.'
					: 'Shipment transport saved and split across items.'
		};
	},

	/**
	 * Add many variants at once (from the product picker). Quantity starts at 0 — entered in the
	 * table. Price starts at the last purchase price in this currency, else the opening estimate.
	 */
	addMany: async ({ params, request }) => {
		const batch = await editable(params.id);
		if (!batch) return fail(400, LANDED);
		let ids: string[];
		try {
			ids = JSON.parse(String((await request.formData()).get('ids') ?? '[]'));
			if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error();
		} catch {
			return fail(400, { error: 'Nothing to add.' });
		}
		const have = new Set(
			(await db.select({ id: bi.variantId }).from(bi).where(eq(bi.batchId, params.id))).map(
				(r) => r.id
			)
		);
		const fresh = [...new Set(ids)].filter((id) => !have.has(id));
		if (!fresh.length) return { saved: 'Already on this purchase.' };
		const list = JSON.stringify(fresh);
		const rows = (await db.all(sql`
			select v.id, coalesce(v.weight_g, 0) as weightG,
				(select i.unit_price_foreign_minor from batch_items i
					join import_batches b on b.id = i.batch_id
					where i.variant_id = v.id and b.currency = ${batch.currency}
						and i.unit_price_foreign_minor > 0 and b.id != ${params.id}
					order by coalesce(b.paid_on, b.created_at) desc limit 1) as lastPrice,
				case when coalesce(v.est_currency, 'RMB') = ${batch.currency} then v.est_cn_price_minor end as estPrice
			from variants v
			where v.id in (select value from json_each(${list}))`)) as {
			id: string;
			weightG: number;
			lastPrice: number | null;
			estPrice: number | null;
		}[];
		if (!rows.length) return fail(400, { error: 'Products not found.' });
		await db.insert(bi).values(
			rows.map((r) => ({
				batchId: params.id,
				variantId: r.id,
				qty: 0,
				unitPriceForeignMinor: r.lastPrice ?? r.estPrice ?? 0,
				unitWeightG: r.weightG
			}))
		);
		if (batch.status === 'paid') await syncExpectedArrival(rows.map((r) => r.id));
		return {
			saved: `Added ${rows.length} ${rows.length === 1 ? 'item' : 'items'} — enter the quantities.`
		};
	},

	items: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const raw = String((await request.formData()).get('rows') ?? '[]');
		let rows: { id: string; qty: number; price: number; weight: number }[];
		try {
			rows = (JSON.parse(raw) as { id: string; qty: string; price: string; weight: string }[]).map(
				(r) => {
					// Whole pieces only (0 allowed while filling in; arrival needs every qty above 0).
					const qty = Number(r.qty);
					// Grams may have decimals (e.g. 2.5 g), kept to 2 places.
					const weight = Math.round(Number(r.weight) * 100) / 100;
					if (!Number.isInteger(qty) || qty < 0 || !(weight >= 0)) throw new Error();
					return { id: r.id, qty, price: Math.abs(toPaisa(r.price)), weight };
				}
			);
		} catch {
			return fail(400, {
				error: 'Quantity must be a whole number; price and weight must be numbers.'
			});
		}
		if (!rows.length) return { saved: 'Nothing changed.' };
		const stmts = rows.map((r) =>
			db
				.update(bi)
				.set({ qty: r.qty, unitPriceForeignMinor: r.price, unitWeightG: r.weight })
				.where(and(eq(bi.id, r.id), eq(bi.batchId, params.id)))
		);
		await db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
		return { saved: `Saved ${rows.length} lines.` };
	},

	remove: async ({ params, request }) => {
		const batch = await editable(params.id);
		if (!batch) return fail(400, LANDED);
		const id = String((await request.formData()).get('itemId'));
		const line = await db.query.batchItems.findFirst({
			where: and(eq(bi.id, id), eq(bi.batchId, params.id))
		});
		await db.delete(bi).where(and(eq(bi.id, id), eq(bi.batchId, params.id)));
		if (line && batch.status === 'paid') await syncExpectedArrival([line.variantId]);
		return { saved: 'Item removed.' };
	},

	paid: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const f = await request.formData();
		const date = String(f.get('date') ?? '');
		if (!isDate(date)) return fail(400, { error: 'Pick the date you ordered.' });
		const daysRaw = String(f.get('expectedDays') ?? '').trim();
		const expectedDays = daysRaw === '' ? null : Number(daysRaw);
		if (
			expectedDays !== null &&
			!(Number.isInteger(expectedDays) && expectedDays >= 0 && expectedDays <= 365)
		)
			return fail(400, { error: 'Expected arrival must be whole days (0–365).' });
		await db
			.update(schema.importBatches)
			.set({ status: 'paid', paidOn: date, expectedDays })
			.where(eq(schema.importBatches.id, params.id));
		const sync = await syncExpectedArrival(await purchaseVariantIds(params.id));
		return {
			saved:
				'Marked purchased — counted as incoming stock.' +
				(sync.failed ? ` ${sync.failed} expected dates could not be sent to Shopify.` : '')
		};
	},

	/** Purchased by mistake: back to draft (no stock effect). */
	draft: async ({ params }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		await db
			.update(schema.importBatches)
			.set({ status: 'draft', paidOn: null })
			.where(eq(schema.importBatches.id, params.id));
		await syncExpectedArrival(await purchaseVariantIds(params.id));
		return { saved: 'Back to draft — no longer counted as incoming.' };
	},

	land: async ({ params, request }) => {
		const date = String((await request.formData()).get('date') ?? '');
		if (!isDate(date)) return fail(400, { error: 'Pick the date the goods arrived.' });
		const cur = await db.query.importBatches.findFirst({
			where: eq(schema.importBatches.id, params.id),
			columns: { status: true }
		});
		if (cur?.status === 'draft') return fail(400, { error: 'Mark it purchased first.' });
		try {
			const r = await landBatch(params.id, date);
			await syncExpectedArrival(await purchaseVariantIds(params.id));
			return {
				saved:
					`Landed: ${r.units} units across ${r.items} products added in Shopify, costs updated.` +
					(r.costFailed
						? ` ${r.costFailed} cost updates failed in Shopify — retry from Inventory.`
						: '') +
					(r.weightsDone ? ` ${r.weightsDone} product weights updated in Shopify.` : '') +
					(r.weightsFailed
						? ` ${r.weightsFailed} weight updates failed — set them on Opening costs.`
						: '')
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : String(e) });
		}
	},

	delete: async ({ params }) => {
		const gone = await editable(params.id);
		if (!gone) return fail(400, LANDED);
		const ids = await purchaseVariantIds(params.id);
		await db.batch([
			db.delete(bi).where(eq(bi.batchId, params.id)),
			db.delete(schema.batchCosts).where(eq(schema.batchCosts.batchId, params.id)),
			db.delete(schema.importBatches).where(eq(schema.importBatches.id, params.id))
		]);
		if (gone.status === 'paid') await syncExpectedArrival(ids);
		redirect(303, '/purchases');
	}
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
