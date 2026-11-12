import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import type { Actions, PageServerLoad } from './$types';

const cat = schema.expenseCategories;
const exp = schema.expenses;

const DEFAULT_CATEGORIES: { name: string; group: 'marketing' | 'operating' | 'other' }[] = [
	{ name: 'Ads', group: 'marketing' },
	{ name: 'Salaries', group: 'operating' },
	{ name: 'Rent', group: 'operating' },
	{ name: 'Packaging', group: 'operating' },
	{ name: 'Shopify & apps', group: 'operating' },
	{ name: 'Electricity', group: 'operating' },
	{ name: 'Internet', group: 'operating' },
	{ name: 'Transport', group: 'operating' },
	{ name: 'Water', group: 'operating' },
	{ name: 'Other', group: 'other' }
];

async function categories() {
	let rows = await db.select().from(cat).orderBy(asc(cat.name));
	if (!rows.length) {
		await db.insert(cat).values(DEFAULT_CATEGORIES).onConflictDoNothing();
		rows = await db.select().from(cat).orderBy(asc(cat.name));
	}
	const order = DEFAULT_CATEGORIES.map((c) => c.name);
	return rows.sort((a, b) => {
		const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
	});
}

const inMonth = (month: string) => and(gte(exp.date, `${month}-01`), lt(exp.date, `${month}-32`));

async function isLocked(date: string) {
	return !!(await db.query.monthLocks.findFirst({ where: eq(schema.monthLocks.month, date.slice(0, 7)) }));
}

export const load: PageServerLoad = async ({ parent }) => {
	const { month } = await parent();
	const cats = await categories();
	const rows = await db
		.select()
		.from(exp)
		.where(inMonth(month))
		.orderBy(desc(exp.date), desc(exp.createdAt));
	const byCat = await db
		.select({ categoryId: exp.categoryId, total: sql<number>`sum(${exp.amount})`, n: sql<number>`count(*)` })
		.from(exp)
		.where(inMonth(month))
		.groupBy(exp.categoryId);
	const lastUsdRate = await db
		.select({ fx: exp.fxRateX10000 })
		.from(exp)
		.where(sql`${exp.fxRateX10000} is not null`)
		.orderBy(desc(exp.date))
		.limit(1);
	return {
		categories: cats,
		expenses: rows,
		byCat,
		locked: !!(await db.query.monthLocks.findFirst({ where: eq(schema.monthLocks.month, month) })),
		lastUsdRate: lastUsdRate[0]?.fx ?? null
	};
};

/** Parse the add/edit form. PKR amount wins; else USD × rate. */
async function parse(f: FormData) {
	const date = String(f.get('date') ?? '');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Pick a date.' };
	const categoryId = String(f.get('categoryId') ?? '');
	if (!(await db.query.expenseCategories.findFirst({ where: eq(cat.id, categoryId) })))
		return { error: 'Pick a category.' };
	let amount = 0,
		usdCents: number | null = null,
		fx: number | null = null;
	try {
		const pkr = String(f.get('amount') ?? '').trim();
		const usd = String(f.get('usd') ?? '').trim();
		const rate = String(f.get('rate') ?? '').trim();
		if (usd) {
			usdCents = Math.abs(toPaisa(usd));
			if (rate) fx = Math.round(Number(rate.replace(/,/g, '')) * 10_000);
			if (fx !== null && !(fx > 0)) throw new Error();
		}
		if (pkr) amount = Math.abs(toPaisa(pkr));
		else if (usdCents && fx) amount = Math.round((usdCents * fx) / 10_000);
	} catch {
		return { error: 'Amounts must be numbers.' };
	}
	if (!amount) return { error: 'Enter the Rs amount, or USD with the rate.' };
	return {
		values: {
			date,
			categoryId,
			amount,
			usdCents,
			fxRateX10000: fx,
			note: String(f.get('note') ?? '').trim() || null
		}
	};
}

export const actions: Actions = {
	save: async ({ request }) => {
		const f = await request.formData();
		const p = await parse(f);
		if (p.error || !p.values) return fail(400, { error: p.error });
		if (await isLocked(p.values.date)) return fail(400, { error: 'That month is locked. Unlock it in Reports first.' });
		const id = String(f.get('id') ?? '');
		if (id) {
			const old = await db.query.expenses.findFirst({ where: eq(exp.id, id) });
			if (!old) return fail(404, { error: 'Expense not found.' });
			if (await isLocked(old.date)) return fail(400, { error: 'That month is locked.' });
			await db.update(exp).set(p.values).where(eq(exp.id, id));
			return { saved: 'Expense updated.' };
		}
		await db.insert(exp).values(p.values);
		return { saved: 'Expense added.' };
	},

	delete: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const old = await db.query.expenses.findFirst({ where: eq(exp.id, id) });
		if (!old) return fail(404, { error: 'Expense not found.' });
		if (await isLocked(old.date)) return fail(400, { error: 'That month is locked.' });
		await db.delete(exp).where(eq(exp.id, id));
		return { saved: 'Expense deleted.' };
	},

	addCategory: async ({ request }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Category needs a name.' });
		const group = f.get('group') === 'marketing' ? 'marketing' : 'operating';
		// Re-adding a removed (archived) category brings it back.
		await db
			.insert(cat)
			.values({ name, group })
			.onConflictDoUpdate({ target: cat.name, set: { archived: false, group } });
		return { saved: `Category “${name}” added.` };
	},

	/** No expenses → delete. Has expenses → hide it (past months keep their numbers). */
	removeCategory: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const c = await db.query.expenseCategories.findFirst({ where: eq(cat.id, id) });
		if (!c) return fail(404, { error: 'Category not found.' });
		const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(exp).where(eq(exp.categoryId, id));
		if (n === 0) {
			await db.delete(cat).where(eq(cat.id, id));
			return { saved: `Category “${c.name}” removed.` };
		}
		await db.update(cat).set({ archived: true }).where(eq(cat.id, id));
		return { saved: `Category “${c.name}” hidden. Its ${n} past expense${n === 1 ? '' : 's'} stay in the reports.` };
	}
};
