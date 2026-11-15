import { fail } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { getSession, liveStock } from '#lib/server/restock.js';
import type { Actions, PageServerLoad } from './$types';

const ri = schema.restockItems;

export const load: PageServerLoad = async ({ params }) => {
	const { session } = await getSession(params.sessionId);
	const list = await db
		.select({
			id: ri.id,
			variantId: ri.variantId,
			productTitle: ri.productTitle,
			variantTitle: ri.variantTitle,
			sku: ri.sku,
			productImageUrl: ri.productImageUrl,
			variantImageUrl: ri.variantImageUrl,
			actualRestock: ri.actualRestock,
			restockMode: ri.restockMode,
			orderedAt: ri.orderedAt
		})
		.from(ri)
		.where(and(eq(ri.sessionId, params.sessionId), sql`coalesce(${ri.actualRestock}, 0) > 0`))
		.orderBy(asc(ri.position), asc(ri.variantPosition));
	const stock = await liveStock(list.map((i) => i.variantId));
	return { session, list, stock: Object.fromEntries(stock) };
};

export const actions: Actions = {
	toggleOrdered: async ({ request, params }) => {
		await getSession(params.sessionId);
		const id = String((await request.formData()).get('id') ?? '');
		const item = await db.query.restockItems.findFirst({
			where: and(eq(ri.id, id), eq(ri.sessionId, params.sessionId))
		});
		if (!item) return fail(404);
		await db
			.update(ri)
			.set({ orderedAt: item.orderedAt ? null : new Date().toISOString() })
			.where(eq(ri.id, id));
		return { ok: true };
	},

	/** Quantities can still be changed on the final list. */
	updateQty: async ({ request, params }) => {
		await getSession(params.sessionId);
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const qty = Number.parseInt(String(f.get('qty') ?? ''), 10);
		if (!id || !Number.isFinite(qty) || qty < 0) return fail(400);
		await db
			.update(ri)
			.set({ actualRestock: qty })
			.where(and(eq(ri.id, id), eq(ri.sessionId, params.sessionId)));
		return { ok: true };
	}
};
