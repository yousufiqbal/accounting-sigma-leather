import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { getSession, liveStock } from '#lib/server/restock.js';
import type { Actions, PageServerLoad } from './$types';

const ri = schema.restockItems;

export const load: PageServerLoad = async ({ params }) => {
	const { session, lead } = await getSession(params.sessionId);
	const items = await db
		.select({
			id: ri.id,
			position: ri.position,
			variantId: ri.variantId,
			productTitle: ri.productTitle,
			variantTitle: ri.variantTitle,
			sku: ri.sku,
			productImageUrl: ri.productImageUrl,
			variantImageUrl: ri.variantImageUrl,
			sales30: ri.sales30,
			sales60: ri.sales60,
			sales90: ri.sales90,
			actualRestock: ri.actualRestock,
			restockMode: ri.restockMode
		})
		.from(ri)
		.where(eq(ri.sessionId, params.sessionId))
		.orderBy(asc(ri.position), asc(ri.variantPosition));
	const stock = await liveStock(items.map((i) => i.variantId));
	return { session, lead, items, stock: Object.fromEntries(stock) };
};

export const actions: Actions = {
	saveRow: async ({ request, params }) => {
		await getSession(params.sessionId);
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const raw = String(f.get('qty') ?? '');
		const n = Number.parseInt(raw, 10);
		if (!id || (raw !== '' && (!Number.isFinite(n) || n < 0))) return fail(400);
		const qty = raw === '' ? null : n;
		const mode = f.get('mode');
		const updated = await db
			.update(ri)
			.set({
				actualRestock: qty,
				restockMode: qty && (mode === 'air' || mode === 'sea') ? mode : null
			})
			.where(and(eq(ri.id, id), eq(ri.sessionId, params.sessionId)))
			.returning({ id: ri.id });
		if (!updated.length) return fail(404);
		return { ok: true };
	},

	complete: async ({ params }) => {
		await getSession(params.sessionId);
		await db
			.update(schema.restockSessions)
			.set({ completedAt: new Date().toISOString() })
			.where(eq(schema.restockSessions.id, params.sessionId));
		redirect(303, `/restock/${params.sessionId}/complete`);
	}
};
