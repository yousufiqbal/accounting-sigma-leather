import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { landBatch, loadBatch } from '#lib/server/stock.js';
import type { Actions, PageServerLoad } from './$types';

const v = schema.variants;
const bi = schema.batchItems;

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
					imageUrl: v.imageUrl
				})
				.from(v)
				.where(inArray(v.id, b.lines.map((l) => l.variantId)))
		: [];
	const byId = new Map(vars.map((x) => [x.id, x]));
	const options = await db
		.select({ id: v.id, productTitle: v.productTitle, variantTitle: v.variantTitle, sku: v.sku, imageUrl: v.imageUrl, status: v.status })
		.from(v)
		.orderBy(asc(v.productTitle), asc(v.variantTitle));
	return {
		batch: b.batch,
		costs: b.costs,
		totals: b.totals,
		shipment: b.shipment,
		lines: b.lines
			.map((l) => ({ ...l, variant: byId.get(l.variantId) ?? null }))
			.sort((a, c) =>
				`${a.variant?.productTitle}${a.variant?.variantTitle}`.localeCompare(
					`${c.variant?.productTitle}${c.variant?.variantTitle}`
				)
			),
		// Draft/archived products are leftovers — not offered.
		options: options
			.filter((o) => o.status === 'ACTIVE')
			.map((o) => ({ id: o.id, title: o.productTitle, variant: o.variantTitle, sku: o.sku, image: o.imageUrl }))
	};
};

async function editable(id: string) {
	const batch = await db.query.importBatches.findFirst({ where: eq(schema.importBatches.id, id) });
	if (!batch) error(404, 'Purchase not found');
	if (batch.status === 'landed' || batch.status === 'landing') return null;
	return batch;
}
const LANDED = { error: 'This purchase has arrived (or is being added to stock) and can no longer be changed.' };
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
			.set({ qty: existing.qty + qty, unitPriceForeignMinor: priceMinor || existing.unitPriceForeignMinor })
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
		await db
			.update(schema.importBatches)
			.set({
				ref,
				supplier: String(f.get('supplier') ?? '').trim() || null,
				notes: String(f.get('notes') ?? '').trim() || null,
				fxRateX10000: fx
			})
			.where(eq(schema.importBatches.id, params.id));
		return { saved: 'Saved.' };
	},

	/** Shipment DDP: billed box weight (kg) × rate, or the invoice total. */
	shipment: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const f = await request.formData();
		const num = (k: string) => {
			const s = String(f.get(k) ?? '').trim().replace(/,/g, '');
			if (s === '') return null;
			const n = Number(s);
			if (!Number.isFinite(n) || n < 0) throw new Error(k);
			return n;
		};
		let kg: number | null, rate: number | null, total: number | null;
		try {
			kg = num('billedKg');
			rate = num('ddp');
			total = num('ddpTotal');
		} catch {
			return fail(400, { error: 'Weight, rate and total must be numbers.' });
		}
		await db
			.update(schema.importBatches)
			.set({
				billedWeightG: kg === null ? null : Math.round(kg * 1000),
				ddpRatePerKg: Math.round((rate ?? 0) * 100),
				ddpTotal: total === null ? null : Math.round(total * 100)
			})
			.where(eq(schema.importBatches.id, params.id));
		return { saved: kg === null && total === null ? 'Saved — DDP still pending.' : 'Shipment DDP saved and split across items.' };
	},

	add: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const f = await request.formData();
		const id = String(f.get('variantId') ?? '').trim() || undefined;
		const qty = Math.trunc(Number(f.get('qty')));
		if (!id) return fail(400, { error: 'Pick a product from the list.' });
		if (!(qty > 0)) return fail(400, { error: 'Quantity must be more than 0.' });
		let price: number;
		try {
			price = Math.abs(toPaisa(String(f.get('price') ?? '')));
		} catch {
			return fail(400, { error: 'Price must be a number.' });
		}
		if (!(await addItem(params.id, id, qty, price))) return fail(400, { error: 'Product not found.' });
		return { added: true }; // quiet: the new line appearing is feedback enough
	},

	/** Paste lines: "SKU or variant id, qty, price" (comma or tab). */
	paste: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const text = String((await request.formData()).get('lines') ?? '');
		const all = await db.select({ id: v.id, sku: v.sku }).from(v);
		const bySku = new Map(all.filter((x) => x.sku).map((x) => [x.sku!.trim().toLowerCase(), x.id]));
		const ids = new Set(all.map((x) => x.id));
		const bad: string[] = [];
		let added = 0;
		for (const [n, raw] of text.split(/\r?\n/).entries()) {
			const line = raw.trim();
			if (!line) continue;
			const parts = line.split(/\t|,/).map((p) => p.trim());
			const key = parts[0] ?? '';
			const id = ids.has(key) ? key : bySku.get(key.toLowerCase());
			const qty = Math.trunc(Number(parts[1]));
			let price = 0;
			try {
				price = Math.abs(toPaisa(parts[2] ?? ''));
			} catch {
				price = -1;
			}
			if (!id || !(qty > 0) || price < 0) {
				bad.push(`line ${n + 1}`);
				continue;
			}
			await addItem(params.id, id, qty, price);
			added++;
		}
		return bad.length
			? fail(400, { error: `Added ${added}. Could not read: ${bad.join(', ')} (SKU not found, or qty/price not a number).` })
			: { saved: `Added ${added} lines.` };
	},

	items: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const raw = String((await request.formData()).get('rows') ?? '[]');
		let rows: { id: string; qty: number; price: number; weight: number }[];
		try {
			rows = (JSON.parse(raw) as { id: string; qty: string; price: string; weight: string }[]).map((r) => {
				const qty = Math.trunc(Number(r.qty));
				const weight = Math.trunc(Number(r.weight));
				if (!(qty > 0) || !(weight >= 0)) throw new Error();
				return { id: r.id, qty, price: Math.abs(toPaisa(r.price)), weight };
			});
		} catch {
			return fail(400, { error: 'Quantity, price and weight must be numbers (qty above 0).' });
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
		if (!(await editable(params.id))) return fail(400, LANDED);
		const id = String((await request.formData()).get('itemId'));
		await db.delete(bi).where(and(eq(bi.id, id), eq(bi.batchId, params.id)));
		return { saved: 'Item removed.' };
	},

	addCost: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const f = await request.formData();
		let amount: number;
		try {
			amount = Math.abs(toPaisa(String(f.get('amount') ?? '')));
		} catch {
			return fail(400, { error: 'Amount must be a number.' });
		}
		if (!amount) return fail(400, { error: 'Enter an amount.' });
		await db.insert(schema.batchCosts).values({
			batchId: params.id,
			type: f.get('type') === 'local_cartage' ? 'local_cartage' : 'other',
			amount,
			alloc: 'value',
			note: String(f.get('note') ?? '').trim() || null
		});
		return { saved: 'Cost added.' };
	},

	removeCost: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const id = String((await request.formData()).get('costId'));
		await db
			.delete(schema.batchCosts)
			.where(and(eq(schema.batchCosts.id, id), eq(schema.batchCosts.batchId, params.id)));
		return { saved: 'Cost removed.' };
	},

	paid: async ({ params, request }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		const date = String((await request.formData()).get('date') ?? '');
		if (!isDate(date)) return fail(400, { error: 'Pick a date.' });
		await db
			.update(schema.importBatches)
			.set({ status: 'paid', paidOn: date })
			.where(eq(schema.importBatches.id, params.id));
		return { saved: 'Marked paid — counted as stock on the way.' };
	},

	land: async ({ params, request }) => {
		const date = String((await request.formData()).get('date') ?? '');
		if (!isDate(date)) return fail(400, { error: 'Pick the date the goods arrived.' });
		try {
			const r = await landBatch(params.id, date);
			return {
				saved:
					`Landed: ${r.units} units across ${r.items} products added in Shopify, costs updated.` +
					(r.costFailed ? ` ${r.costFailed} cost updates failed in Shopify — retry from Inventory.` : '')
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : String(e) });
		}
	},

	delete: async ({ params }) => {
		if (!(await editable(params.id))) return fail(400, LANDED);
		await db.batch([
			db.delete(bi).where(eq(bi.batchId, params.id)),
			db.delete(schema.batchCosts).where(eq(schema.batchCosts.batchId, params.id)),
			db.delete(schema.importBatches).where(eq(schema.importBatches.id, params.id))
		]);
		redirect(303, '/purchases');
	}
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
