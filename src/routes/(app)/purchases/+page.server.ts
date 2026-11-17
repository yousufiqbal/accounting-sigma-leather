import { fail, redirect } from '@sveltejs/kit';
import { desc, inArray } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { getRates } from '#lib/server/costing.js';
import { loadBatch } from '#lib/server/stock.js';
import { getLead } from '#lib/server/restock.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const list = await db
		.select({ id: schema.importBatches.id })
		.from(schema.importBatches)
		.orderBy(desc(schema.importBatches.createdAt));
	const batches = (await Promise.all(list.map((b) => loadBatch(b.id)))).filter((b) => b !== null);
	// Names and pictures for the item drop-downs.
	const ids = [...new Set(batches.flatMap((b) => b.lines.map((l) => l.variantId)))];
	const v = schema.variants;
	const vars = ids.length
		? await db
				.select({ id: v.id, title: v.productTitle, variant: v.variantTitle, image: v.imageUrl })
				.from(v)
				.where(inArray(v.id, ids))
		: [];
	const byId = new Map(vars.map((x) => [x.id, x]));
	return {
		rates: await getRates(),
		lead: await getLead(),
		batches: batches.map((b) => ({
			...b.batch,
			totals: b.totals,
			items: b.items.length,
			lines: b.lines.map((l) => ({
				id: l.id,
				title: byId.get(l.variantId)?.title ?? '—',
				variant: byId.get(l.variantId)?.variant ?? null,
				image: byId.get(l.variantId)?.image ?? null,
				qty: l.qty,
				price: l.unitPriceForeignMinor,
				landed: l.landed
			})),
			ddpPending: b.shipment.ddpPending
		}))
	};
};

export const actions: Actions = {
	create: async ({ request }) => {
		const f = await request.formData();
		const ref = String(f.get('ref') ?? '').trim();
		if (!ref) return fail(400, { error: 'Give the purchase a name, e.g. "Nov-2026 sea".' });
		const currency = f.get('currency') === 'PKR' ? 'PKR' : 'RMB';
		let fx: number, ddp: number;
		try {
			fx =
				currency === 'PKR'
					? 10_000
					: Math.round(Number(String(f.get('fx')).replace(/,/g, '')) * 10_000);
			ddp = toPaisa(String(f.get('ddp') ?? '0'));
			if (!Number.isFinite(fx) || fx <= 0) throw new Error();
		} catch {
			return fail(400, { error: 'Exchange rate and transport rate must be numbers.' });
		}
		const orderedOn = String(f.get('orderedOn') ?? '');
		const daysRaw = String(f.get('expectedDays') ?? '').trim();
		const expectedDays = daysRaw === '' ? null : Number(daysRaw);
		if (
			expectedDays !== null &&
			!(Number.isInteger(expectedDays) && expectedDays >= 0 && expectedDays <= 365)
		)
			return fail(400, { error: 'Expected arrival must be whole days (0–365).' });
		const [b] = await db
			.insert(schema.importBatches)
			.values({
				paidOn: /^\d{4}-\d{2}-\d{2}$/.test(orderedOn) ? orderedOn : null,
				expectedDays,
				ref,
				supplier: String(f.get('supplier') ?? '').trim() || null,
				currency,
				fxRateX10000: fx,
				ddpRatePerKg: Math.abs(ddp)
			})
			.returning({ id: schema.importBatches.id });
		redirect(303, `/purchases/${b.id}`);
	}
};
