import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { orderProfits } from '#lib/server/order-profit.js';
import { openOrders } from '#lib/server/open-orders.js';
import { PKT_OFFSET_MS } from '#lib/month.js';
import type { PageServerLoad } from './$types';

/**
 * Profit of every order PLACED in a period (by order date, not delivery date):
 *   delivered → real profit; returned → courier-fee loss;
 *   not finished yet → estimated like the In progress page (usual courier fee + tax).
 * Cancelled orders are left out (unless the courier delivered them anyway).
 */
const PRESETS = ['today', 'yesterday', '3d', '7d', 'custom'] as const;
type Preset = (typeof PRESETS)[number];

const todayPkt = () => new Date(Date.now() + PKT_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
	new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isDate = (s: string | null): s is string =>
	!!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export const load: PageServerLoad = async ({ url }) => {
	const today = todayPkt();
	const asked = url.searchParams.get('p') as Preset | null;
	let preset: Preset = asked && PRESETS.includes(asked) ? asked : 'today';
	let from = today,
		to = today;
	if (preset === 'yesterday') from = to = addDays(today, -1);
	else if (preset === '3d') from = addDays(today, -2);
	else if (preset === '7d') from = addDays(today, -6);
	else if (preset === 'custom') {
		const f = url.searchParams.get('from');
		const t = url.searchParams.get('to');
		if (isDate(f) && isDate(t) && f <= t) [from, to] = [f, t];
		else preset = 'today';
	}
	const start = new Date(Date.parse(`${from}T00:00:00Z`) - PKT_OFFSET_MS).toISOString();
	const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000 - PKT_OFFSET_MS).toISOString();

	const placed = (await db.all(sql`
		select o.id, o.name, o.created_at as createdAt, o.is_prepaid as isPrepaid,
			o.cancelled_at is not null as cancelled, c.name as customer,
			exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered'
				and s.match_status != 'excluded') as delivered
		from orders o left join customers c on c.id = o.customer_id
		where o.test = 0 and o.created_at >= ${start} and o.created_at < ${end}
		order by o.created_at desc`)) as {
		id: string;
		name: string;
		createdAt: string;
		isPrepaid: number;
		cancelled: number;
		customer: string | null;
		delivered: number;
	}[];
	// Cancelled and never delivered = not a sale.
	const counted = placed.filter((o) => !o.cancelled || o.delivered);
	const ids = counted.map((o) => o.id);

	const [finished, open] = await Promise.all([orderProfits({ ids }), openOrders({ ids })]);
	const fin = new Map(finished.map((p) => [p.id, p]));
	const opn = new Map(open.orders.map((o) => [o.id, o]));

	const rows = counted
		.map((o) => {
			const f = fin.get(o.id);
			const e = opn.get(o.id);
			const base = {
				id: o.id,
				name: o.name,
				createdAt: o.createdAt,
				isPrepaid: !!o.isPrepaid,
				customer: o.customer
			};
			if (f)
				return {
					...base,
					state: f.outcome,
					estimated: false,
					sales: f.sales,
					cogs: f.cogs,
					courier: f.courier,
					tax: f.tax,
					profit: f.profit,
					costMissing: f.unitsNoCost > 0,
					partlyEstimated: f.cogsEstimated || f.courierEstimated
				};
			if (e)
				return {
					...base,
					state: e.state,
					estimated: true,
					sales: e.sales,
					cogs: e.cogs,
					courier: e.courier,
					tax: e.tax,
					profit: e.profit,
					costMissing: e.unitsNoCost > 0,
					partlyEstimated: true
				};
			return null; // zero-value orders etc.
		})
		.filter((r) => r !== null);

	const sum = (list: typeof rows, k: 'sales' | 'cogs' | 'courier' | 'tax' | 'profit') =>
		list.reduce((s, r) => s + r[k], 0);
	const done = rows.filter((r) => !r.estimated);
	const pending = rows.filter((r) => r.estimated);
	const rr = open.rates.returnRate;
	// Expected for open orders after the usual share comes back (no sale, courier fee still paid).
	const pendingAfterReturns = Math.round(
		sum(pending, 'profit') * (1 - rr) - sum(pending, 'courier') * rr
	);

	return {
		preset,
		from,
		to,
		rows,
		cancelled: placed.length - counted.length,
		rates: open.rates,
		totals: {
			orders: rows.length,
			sales: sum(rows, 'sales'),
			cogs: sum(rows, 'cogs'),
			courier: sum(rows, 'courier'),
			tax: sum(rows, 'tax'),
			profit: sum(rows, 'profit'),
			done: { count: done.length, profit: sum(done, 'profit') },
			pending: {
				count: pending.length,
				profit: sum(pending, 'profit'),
				afterReturns: pendingAfterReturns
			},
			costMissing: rows.filter((r) => r.costMissing).length
		}
	};
};
