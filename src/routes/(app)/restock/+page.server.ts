import { fail, redirect } from '@sveltejs/kit';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { getLead, setLead, startSession } from '#lib/server/restock.js';
import type { Actions, PageServerLoad } from './$types';

const rs = schema.restockSessions;
const ri = schema.restockItems;

export const load: PageServerLoad = async () => {
	const [sessions, lead] = await Promise.all([
		db.select().from(rs).orderBy(desc(rs.startedAt)).limit(10),
		getLead()
	]);
	// Progress per session: products with any qty entered / total, and where to resume.
	const ids = sessions.map((s) => s.id);
	const rows = ids.length
		? await db
				.select({ sessionId: ri.sessionId, position: ri.position, qty: ri.actualRestock })
				.from(ri)
				.where(inArray(ri.sessionId, ids))
				.orderBy(asc(ri.position))
		: [];
	const by = new Map<string, Map<number, boolean>>();
	for (const r of rows) {
		let m = by.get(r.sessionId);
		if (!m) by.set(r.sessionId, (m = new Map()));
		m.set(r.position, (m.get(r.position) ?? false) || r.qty != null);
	}
	return {
		lead,
		sessions: sessions.map((s) => {
			const m = by.get(s.id) ?? new Map<number, boolean>();
			const positions = [...m.keys()].sort((a, b) => a - b);
			const resume = positions.find((p) => !m.get(p)) ?? 0;
			return {
				...s,
				done: positions.filter((p) => m.get(p)).length,
				total: positions.length,
				resume
			};
		})
	};
};

const days = (v: FormDataEntryValue | null) => {
	const n = Number(v);
	return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
};

export const actions: Actions = {
	/** How long an air / sea shipment takes to arrive — recommendations cover that wait. */
	lead: async ({ request }) => {
		const f = await request.formData();
		const airDays = days(f.get('airDays'));
		const seaDays = days(f.get('seaDays'));
		if (airDays === null || seaDays === null)
			return fail(400, { error: 'Lead times must be whole days between 1 and 365.' });
		await setLead({ airDays, seaDays });
		return { saved: 'Lead times saved.' };
	},

	start: async () => {
		const id = await startSession();
		redirect(303, `/restock/${id}/0`);
	},

	delete: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing session.' });
		await db.delete(ri).where(eq(ri.sessionId, id));
		await db.delete(rs).where(eq(rs.id, id));
		return { saved: 'Restock session deleted.' };
	}
};
