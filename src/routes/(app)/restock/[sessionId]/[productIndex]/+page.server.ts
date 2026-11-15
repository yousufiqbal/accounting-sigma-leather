import { redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { getSession, liveStock } from '#lib/server/restock.js';
import { calcRestock } from '#lib/restock-calc.js';
import type { Actions, PageServerLoad } from './$types';

const ri = schema.restockItems;

export const load: PageServerLoad = async ({ params }) => {
	const index = Number.parseInt(params.productIndex, 10);
	if (Number.isNaN(index) || index < 0) redirect(303, `/restock/${params.sessionId}/0`);

	// position == product index: read only this product's variants.
	const [{ session, lead }, variants] = await Promise.all([
		getSession(params.sessionId),
		db
			.select()
			.from(ri)
			.where(and(eq(ri.sessionId, params.sessionId), eq(ri.position, index)))
			.orderBy(asc(ri.variantPosition))
	]);
	if (index >= session.totalProducts || !variants.length)
		redirect(303, `/restock/${params.sessionId}/complete`);

	// Stock is re-read on every visit — sessions are often worked days after they start.
	const stock = await liveStock(variants.map((v) => v.variantId));
	return {
		session,
		lead,
		variants: variants.map((v) => {
			const s = stock.get(v.variantId) ?? null;
			return {
				...v,
				stock: s,
				calc: s ? calcRestock({ s30: v.sales30, s60: v.sales60, s90: v.sales90 }, s, lead) : null
			};
		}),
		productTitle: variants[0].productTitle,
		productImageUrl: variants[0].productImageUrl,
		index,
		totalProducts: session.totalProducts,
		prevIndex: index > 0 ? index - 1 : null,
		nextIndex: index < session.totalProducts - 1 ? index + 1 : null
	};
};

const mode = (v: FormDataEntryValue | null) => (v === 'air' || v === 'sea' ? v : null);

export const actions: Actions = {
	save: async ({ request, params }) => {
		await getSession(params.sessionId);
		const f = await request.formData();
		const updates = [];
		for (const [key, value] of f.entries()) {
			if (!key.startsWith('qty_')) continue;
			const id = key.slice(4);
			const n = Number.parseInt(String(value), 10);
			const qty = value === '' || !Number.isFinite(n) ? null : Math.max(0, n);
			updates.push(
				db
					.update(ri)
					.set({ actualRestock: qty, restockMode: qty ? mode(f.get(`mode_${id}`)) : null })
					.where(and(eq(ri.id, id), eq(ri.sessionId, params.sessionId)))
			);
		}
		await Promise.all(updates);
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
