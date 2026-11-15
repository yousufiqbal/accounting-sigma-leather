import { fail, redirect } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { getRates } from '#lib/server/costing.js';
import { loadBatch } from '#lib/server/stock.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const list = await db
		.select({ id: schema.importBatches.id })
		.from(schema.importBatches)
		.orderBy(desc(schema.importBatches.createdAt));
	const batches = (await Promise.all(list.map((b) => loadBatch(b.id)))).filter((b) => b !== null);
	return {
		rates: await getRates(),
		batches: batches.map((b) => ({
			...b.batch,
			totals: b.totals,
			items: b.items.length,
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
		const [b] = await db
			.insert(schema.importBatches)
			.values({
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
