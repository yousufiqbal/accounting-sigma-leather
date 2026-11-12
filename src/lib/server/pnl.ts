/**
 * Monthly income statement (SPEC.md §7). Everything by Asia/Karachi month.
 *
 * Revenue: an order counts once, in the month its first parcel was delivered.
 *   Order cancelled / total 0 in Shopify but courier delivered → courier COD is the sale.
 * COGS: order lines × cost snapshot (or current cost used if not frozen yet).
 * Courier costs: every parcel (matched or not) by its final date —
 *   delivered → delivery fee + tax, withholding (ITWH+STWH), other fees
 *   returned  → all fees on it count as return cost.
 * Expenses: by expense date.
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { monthBoundsUtc } from '../month.js';

const DELIVERED_ORDERS = (start: string, end: string) => sql`
	with first_delivery as (
		select order_id, min(final_at) as at
		from shipments
		where status = 'delivered' and order_id is not null and match_status != 'excluded'
		group by order_id
	)
	select o.id, o.name, o.cancelled_at as cancelledAt, o.total_paisa as total,
		o.gross_sales_paisa as gross, o.total_discounts_paisa as discounts,
		o.prepaid_discount_paisa as prepaid, o.shipping_charged_paisa as shipping,
		o.outstanding_paisa as outstanding,
		(select coalesce(sum(cod_paisa), 0) from shipments s where s.order_id = o.id and s.status = 'delivered') as cod
	from first_delivery d join orders o on o.id = d.order_id
	where d.at >= ${start} and d.at < ${end}`;

export type Pnl = Awaited<ReturnType<typeof incomeStatement>>;

export async function incomeStatement(month: string) {
	const { start, end } = monthBoundsUtc(month);

	// ── Sales ──
	const orders = (await db.all(DELIVERED_ORDERS(start, end))) as {
		id: string;
		name: string;
		cancelledAt: string | null;
		total: number;
		gross: number;
		discounts: number;
		prepaid: number;
		shipping: number;
		outstanding: number;
		cod: number;
	}[];
	/** Unpaid in Shopify but the courier collected (much) less — money may be missing. */
	const shortCollected: { name: string; outstanding: number; cod: number }[] = [];
	let gross = 0,
		prepaidDisc = 0,
		otherDisc = 0,
		shipping = 0,
		adjust = 0,
		courierOnly = 0;
	const normalIds: string[] = [];
	for (const o of orders) {
		if (o.cancelledAt || o.total <= 0) {
			// Cancelled/voided in Shopify but the courier delivered and collected.
			gross += o.cod;
			courierOnly++;
			continue;
		}
		normalIds.push(o.id);
		if (o.outstanding - o.cod > 10_000)
			shortCollected.push({ name: o.name, outstanding: o.outstanding, cod: o.cod });
		gross += o.gross;
		prepaidDisc += o.prepaid;
		otherDisc += o.discounts - o.prepaid;
		shipping += o.shipping;
		adjust += o.total - (o.gross - o.discounts + o.shipping); // taxes / rounding / edits
	}
	const netSales = gross - prepaidDisc - otherDisc + shipping + adjust;

	// ── COGS + per product ──
	const lines = normalIds.length
		? ((await db.all(sql`
			select coalesce(v.product_id, 'line:' || l.title) as productKey,
				coalesce(v.product_title, l.title) as product,
				sum(l.qty) as units,
				sum(l.qty * l.unit_price_paisa - l.line_discount_paisa) as sales,
				sum(l.qty * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0)) as cogs,
				sum(case when coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) = 0 then l.qty else 0 end) as unitsNoCost,
				sum(case when l.cost_estimated = 1 or (l.cost_snapshot_paisa is null and coalesce(v.cost_source, 'none') != 'batch')
					then l.qty * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) else 0 end) as cogsEstimated
			from order_lines l left join variants v on v.id = l.variant_id
			where l.order_id in (select value from json_each(${JSON.stringify(normalIds)})) and l.qty > 0
			group by productKey
			order by sales desc`)) as {
				productKey: string;
				product: string;
				units: number;
				sales: number;
				cogs: number;
				unitsNoCost: number;
				cogsEstimated: number;
			}[])
		: [];
	const cogs = lines.reduce((s, l) => s + l.cogs, 0);
	const cogsEstimated = lines.reduce((s, l) => s + l.cogsEstimated, 0);
	const unitsNoCost = lines.reduce((s, l) => s + l.unitsNoCost, 0);
	const grossProfit = netSales - cogs;

	// ── Courier ──
	const [c] = (await db.all(sql`
		select
			coalesce(sum(case when status = 'delivered' then fee_paisa + fee_tax_paisa else 0 end), 0) as delivery,
			coalesce(sum(case when status = 'returned' then fee_paisa + fee_tax_paisa + return_fee_paisa + return_fee_tax_paisa else 0 end), 0) as returns,
			coalesce(sum(case when status = 'delivered' then itwh_paisa + stwh_paisa else 0 end), 0) as withholding,
			coalesce(sum(other_fees_paisa), 0) as other,
			coalesce(sum(case when status = 'delivered' then 1 else 0 end), 0) as delivered,
			coalesce(sum(case when status = 'returned' then 1 else 0 end), 0) as returned,
			coalesce(sum(case when fees_estimated = 1 or taxes_estimated = 1 then 1 else 0 end), 0) as estimated,
			coalesce(sum(case when status = 'delivered' and order_id is null then 1 else 0 end), 0) as unmatchedDelivered,
			coalesce(sum(case when status = 'delivered' and order_id is null then cod_paisa else 0 end), 0) as unmatchedCod
		from shipments
		where final_at >= ${start} and final_at < ${end}
			and status in ('delivered', 'returned') and match_status != 'excluded'`)) as {
		delivery: number;
		returns: number;
		withholding: number;
		other: number;
		delivered: number;
		returned: number;
		estimated: number;
		unmatchedDelivered: number;
		unmatchedCod: number;
	}[];
	const courierTotal = c.delivery + c.returns + c.withholding + c.other;

	// ── Expenses ──
	const exp = await db
		.select({
			category: schema.expenseCategories.name,
			group: schema.expenseCategories.group,
			amount: sql<number>`sum(${schema.expenses.amount})`
		})
		.from(schema.expenses)
		.innerJoin(schema.expenseCategories, eq(schema.expenseCategories.id, schema.expenses.categoryId))
		.where(and(gte(schema.expenses.date, `${month}-01`), lt(schema.expenses.date, `${month}-32`)))
		.groupBy(schema.expenseCategories.id)
		.orderBy(sql`sum(${schema.expenses.amount}) desc`);
	const marketing = exp.filter((e) => e.group === 'marketing');
	const operating = exp.filter((e) => e.group !== 'marketing');
	const marketingTotal = marketing.reduce((s, e) => s + e.amount, 0);
	const operatingTotal = operating.reduce((s, e) => s + e.amount, 0);

	const netProfit = grossProfit - courierTotal - marketingTotal - operatingTotal;

	const lock = await db.query.monthLocks.findFirst({ where: eq(schema.monthLocks.month, month) });
	const provisional = c.estimated > 0 || cogsEstimated > 0 || unitsNoCost > 0;

	return {
		month,
		status: lock ? ('locked' as const) : provisional ? ('provisional' as const) : ('final' as const),
		lockedAt: lock?.lockedAt ?? null,
		sales: { gross, prepaidDisc, otherDisc, shipping, adjust, net: netSales, courierOnly },
		cogs: { total: cogs, estimated: cogsEstimated, unitsNoCost },
		grossProfit,
		courier: { ...c, total: courierTotal },
		expenses: { marketing, operating, marketingTotal, operatingTotal },
		netProfit,
		kpi: {
			orders: orders.length,
			aov: orders.length ? Math.round(netSales / orders.length) : 0,
			returnRate: c.delivered + c.returned ? c.returned / (c.delivered + c.returned) : NaN,
			grossMargin: netSales ? grossProfit / netSales : NaN,
			netMargin: netSales ? netProfit / netSales : NaN,
			courierPerOrder: orders.length ? Math.round(courierTotal / orders.length) : 0
		},
		shortCollected,
		products: lines.map((l) => ({ ...l, profit: l.sales - l.cogs }))
	};
}
