import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { incomeStatement } from '#lib/server/pnl.js';
import { stockSummary } from '#lib/server/costing.js';
import { currentMonth, monthFromUrl, shiftMonth } from '#lib/month.js';
import type { PageServerLoad } from './$types';

const FIRST_MONTH = '2025-12'; // first Shopify sale

export const load: PageServerLoad = async ({ url }) => {
	const month = monthFromUrl(url); // not via parent(): saves a round trip
	// Every month from the first sale to the current month (not limited by the selected month).
	const months: string[] = [];
	for (let m = FIRST_MONTH; m <= currentMonth(); m = shiftMonth(m, 1)) months.push(m);
	const trend = await Promise.all(months.map((m) => incomeStatement(m)));
	const current = trend.find((t) => t.month === month) ?? (await incomeStatement(month));
	const [owed] = (await db.all(sql`
		select coalesce(sum(net_payable_paisa), 0) as amount, count(*) as parcels
		from shipments
		where status = 'delivered' and courier != 'manual' and statement_id is null and settled_at is null
			and match_status != 'excluded'`)) as { amount: number; parcels: number }[];
	// To-do counts (things only the owner can fix).
	const [todo] = (await db.all(sql`
		select
			(select count(*) from order_lines l join orders o on o.id = l.order_id
				where l.variant_id is null and l.qty > 0 and coalesce(l.cost_snapshot_paisa, 0) = 0 and o.test = 0
					and exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered')) as customNoCost,
			(select count(*) from orders o
				where o.cancelled_at is null and o.test = 0
					and o.fulfillment_status in ('FULFILLED', 'PARTIALLY_FULFILLED')
					and not exists (select 1 from shipments s where s.order_id = o.id and s.status != 'cancelled')) as noCourierData`)) as {
		customNoCost: number;
		noCourierData: number;
	}[];
	// Past months with no expenses at all (the current month may simply not be entered yet).
	const noExpenses = trend
		.filter(
			(p) => p.month < currentMonth() && !p.expenses.marketingTotal && !p.expenses.operatingTotal
		)
		.map((p) => p.month);
	return {
		todo: { ...todo, noExpenses },
		current,
		trend: trend.map((p) => ({
			month: p.month,
			status: p.status,
			netSales: p.sales.net,
			grossProfit: p.grossProfit,
			courier: p.courier.total,
			expenses: p.expenses.marketingTotal + p.expenses.operatingTotal + p.writeOffs.amount,
			netProfit: p.netProfit,
			orders: p.kpi.orders
		})),
		owed,
		stock: await stockSummary()
	};
};
