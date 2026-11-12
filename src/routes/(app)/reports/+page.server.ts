import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { incomeStatement } from '#lib/server/pnl.js';
import { isMonth } from '#lib/month.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { month } = await parent();
	return { pnl: await incomeStatement(month) };
};

export const actions: Actions = {
	lock: async ({ request }) => {
		const month = String((await request.formData()).get('month'));
		if (!isMonth(month)) return { saved: null };
		await db.insert(schema.monthLocks).values({ month }).onConflictDoNothing();
		return { saved: `Locked. Expenses for this month can no longer be changed.` };
	},
	unlock: async ({ request }) => {
		const month = String((await request.formData()).get('month'));
		await db.delete(schema.monthLocks).where(eq(schema.monthLocks.month, month));
		return { saved: 'Unlocked.' };
	}
};
