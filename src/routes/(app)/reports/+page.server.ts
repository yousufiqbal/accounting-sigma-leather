import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { incomeStatement, periodStatement } from '#lib/server/pnl.js';
import {
	currentMonth,
	fyStart,
	isMonth,
	monthEnd,
	monthFromUrl,
	monthLabel,
	monthsBetween,
	shiftMonth
} from '#lib/month.js';
import type { Actions, PageServerLoad } from './$types';

const isDate = (s: string | null): s is string =>
	!!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Quick picks, relative to today (Karachi). FY = Pakistan July–June. */
function presets() {
	const now = currentMonth();
	const [y, m] = now.split('-').map(Number);
	const q = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}`;
	const fy = fyStart(now);
	const fyY = Number(fy.slice(0, 4));
	const range = (id: string, label: string, a: string, b: string) => ({
		id,
		label,
		from: `${a}-01`,
		to: monthEnd(b)
	});
	return [
		range('quarter', 'This quarter', q, shiftMonth(q, 2)),
		range('3m', 'Last 3 months', shiftMonth(now, -2), now),
		range('6m', 'Last 6 months', shiftMonth(now, -5), now),
		range('12m', 'Last 12 months', shiftMonth(now, -11), now),
		range('fytd', `FY ${fyY}-${String(fyY + 1).slice(2)} to date`, fy, now),
		range(
			'lastfy',
			`FY ${fyY - 1}-${String(fyY).slice(2)}`,
			shiftMonth(fy, -12),
			shiftMonth(fy, -1)
		)
	];
}

export const load: PageServerLoad = async ({ url }) => {
	const month = monthFromUrl(url); // not via parent(): saves a round trip
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');

	if (!isDate(from) || !isDate(to) || from > to) {
		return { period: null, presets: presets(), pnl: await incomeStatement(month), byMonth: null };
	}

	const wholeMonths = from.endsWith('-01') && to === monthEnd(to.slice(0, 7));
	const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
	const [pnl, byMonth] = await Promise.all([
		periodStatement(from, to),
		wholeMonths && months.length > 1 && months.length <= 24
			? Promise.all(months.map((m) => incomeStatement(m)))
			: null
	]);
	const label = wholeMonths
		? months.length === 1
			? monthLabel(months[0])
			: `${monthLabel(months[0])} – ${monthLabel(months.at(-1)!)}`
		: null;
	return { period: { from, to, wholeMonths, label }, presets: presets(), pnl, byMonth };
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
