import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { incomeStatement } from '#lib/server/pnl.js';
import { stockSummary } from '#lib/server/costing.js';
import { shiftMonth } from '#lib/month.js';
import type { PageServerLoad } from './$types';

const FIRST_MONTH = '2025-12'; // first Shopify sale

export const load: PageServerLoad = async ({ parent }) => {
	const { month } = await parent();
	const months: string[] = [];
	for (let m = month, i = 0; i < 12 && m >= FIRST_MONTH; m = shiftMonth(m, -1), i++) months.unshift(m);
	const trend = await Promise.all(months.map((m) => incomeStatement(m)));
	const [owed] = (await db.all(sql`
		select coalesce(sum(net_payable_paisa), 0) as amount, count(*) as parcels
		from shipments
		where status = 'delivered' and courier != 'manual' and statement_id is null and settled_at is null
			and match_status != 'excluded'`)) as { amount: number; parcels: number }[];
	return {
		current: trend[trend.length - 1],
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
