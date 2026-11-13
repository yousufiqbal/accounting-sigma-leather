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
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { PKT_OFFSET_MS, monthEnd, monthsBetween } from '../month.js';

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

export type Pnl = Awaited<ReturnType<typeof periodStatement>>;

/** One Karachi month ("YYYY-MM"). */
export async function incomeStatement(month: string) {
	return { ...(await periodStatement(`${month}-01`, monthEnd(month), month)), month };
}

/** Any period: `from`..`to` are inclusive Karachi dates ("YYYY-MM-DD"). */
export async function periodStatement(from: string, to: string, month: string | null = null) {
	const start = new Date(Date.parse(`${from}T00:00:00Z`) - PKT_OFFSET_MS).toISOString();
	const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000 - PKT_OFFSET_MS).toISOString();

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
	/** Cancelled/voided in Shopify but delivered: Shopify zeroed their lines, cost the ordered qty. */
	const courierOnlyIds: string[] = [];
	for (const o of orders) {
		if (o.cancelledAt || o.total <= 0) {
			// Cancelled/voided in Shopify but the courier delivered and collected.
			gross += o.cod;
			courierOnly++;
			courierOnlyIds.push(o.id);
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
	const lines =
		normalIds.length + courierOnlyIds.length
			? ((await db.all(sql`
			with ln as (
				select l.*, case when l.order_id in (select value from json_each(${JSON.stringify(courierOnlyIds)}))
					then coalesce(nullif(l.qty, 0), l.ordered_qty, 0) else l.qty end as q
				from order_lines l
				where l.order_id in (select value from json_each(${JSON.stringify([...normalIds, ...courierOnlyIds])}))
			)
			select coalesce(v.product_id, 'line:' || l.title) as productKey,
				coalesce(v.product_title, l.title) as product,
				sum(l.q) as units,
				sum(l.q * l.unit_price_paisa - l.line_discount_paisa) as sales,
				sum(l.q * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0)) as cogs,
				sum(case when coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) = 0 then l.q else 0 end) as unitsNoCost,
				sum(case when l.cost_estimated = 1 or (l.cost_snapshot_paisa is null and coalesce(v.cost_source, 'none') != 'batch')
					then l.q * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) else 0 end) as cogsEstimated
			from ln l left join variants v on v.id = l.variant_id
			where l.q > 0
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
		.innerJoin(
			schema.expenseCategories,
			eq(schema.expenseCategories.id, schema.expenses.categoryId)
		)
		.where(and(gte(schema.expenses.date, from), lte(schema.expenses.date, to)))
		.groupBy(schema.expenseCategories.id)
		.orderBy(sql`sum(${schema.expenses.amount}) desc`);
	const marketing = exp.filter((e) => e.group === 'marketing');
	const operating = exp.filter((e) => e.group !== 'marketing');
	const marketingTotal = marketing.reduce((s, e) => s + e.amount, 0);
	const operatingTotal = operating.reduce((s, e) => s + e.amount, 0);

	// ── Stock write-offs (damaged / missing / count fixes from Shopify stock checks) ──
	const [wo] = (await db.all(sql`
		select
			coalesce(sum(case when m.reason in ('damaged', 'missing', 'count')
				then -m.qty_delta * coalesce(nullif(m.unit_cost_paisa, 0), v.avg_cost_paisa, 0) else 0 end), 0) as amount,
			coalesce(sum(case when m.reason is null then 1 else 0 end), 0) as pending
		from stock_movements m left join variants v on v.id = m.variant_id
		where m.type = 'variance' and m.at >= ${start} and m.at < ${end}`)) as {
		amount: number;
		pending: number;
	}[];

	const netProfit = grossProfit - courierTotal - marketingTotal - operatingTotal - wo.amount;

	const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
	const locks = await db
		.select({ month: schema.monthLocks.month, at: schema.monthLocks.lockedAt })
		.from(schema.monthLocks)
		.where(inArray(schema.monthLocks.month, months));
	const lock = locks.length === months.length ? locks[0] : null;
	const provisional = c.estimated > 0 || cogsEstimated > 0 || unitsNoCost > 0;

	return {
		month,
		from,
		to,
		status: lock
			? ('locked' as const)
			: provisional
				? ('provisional' as const)
				: ('final' as const),
		lockedAt: lock?.at ?? null,
		sales: { gross, prepaidDisc, otherDisc, shipping, adjust, net: netSales, courierOnly },
		cogs: { total: cogs, estimated: cogsEstimated, unitsNoCost },
		grossProfit,
		courier: { ...c, total: courierTotal },
		expenses: { marketing, operating, marketingTotal, operatingTotal },
		writeOffs: { amount: wo.amount, pending: wo.pending },
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
