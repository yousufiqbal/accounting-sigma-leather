/**
 * Profit per order, for orders that finished (delivered or returned) in a month.
 *
 *   Sales (after discounts, incl. shipping charged)
 * − Product cost (cost snapshot, else current cost used)
 * − Courier fees (delivery + tax on fee + other; returns also pay return fees)
 * − Tax the courier withheld from COD (ITWH + STWH)
 * = Profit
 *
 * Same rules as the income statement (pnl.ts): an order counts in the month of its first
 * delivered parcel; cancelled-but-delivered orders use the courier COD as the sale.
 * Returned-only orders count in the month they came back, as a loss of their courier fees.
 * Running costs (ads, salaries, packaging…) stay on Reports.
 */
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { monthBoundsUtc } from '../month.js';

export type OrderProfit = {
	id: string;
	name: string;
	at: string;
	outcome: 'delivered' | 'returned';
	couriers: string;
	isPrepaid: boolean;
	sales: number;
	shipping: number;
	cogs: number;
	courier: number;
	tax: number;
	profit: number;
	margin: number;
	cogsEstimated: boolean;
	unitsNoCost: number;
	courierEstimated: boolean;
	courierOnly: boolean;
};

/** By month (orders that finished in it), for specific orders, or every finished order. */
export async function orderProfits(
	filter: { month: string } | { ids: string[] } | { all: true }
): Promise<OrderProfit[]> {
	let where;
	if ('month' in filter) {
		const { start, end } = monthBoundsUtc(filter.month);
		where = sql`s.at >= ${start} and s.at < ${end}`;
	} else if ('all' in filter) {
		where = sql`1 = 1`;
	} else {
		if (!filter.ids.length) return [];
		where = sql`o.id in (select value from json_each(${JSON.stringify(filter.ids)}))`;
	}
	const rows = (await db.all(sql`
		with p as (
			select order_id,
				min(case when status = 'delivered' then final_at end) as deliveredAt,
				max(case when status = 'returned' then final_at end) as returnedAt,
				sum(case when status = 'delivered'
					then fee_paisa + fee_tax_paisa + other_fees_paisa
					else fee_paisa + fee_tax_paisa + return_fee_paisa + return_fee_tax_paisa + other_fees_paisa end) as courier,
				sum(case when status = 'delivered' then itwh_paisa + stwh_paisa else 0 end) as tax,
				sum(case when status = 'delivered' then cod_paisa else 0 end) as cod,
				max(fees_estimated or taxes_estimated) as courierEstimated,
				group_concat(distinct courier) as couriers
			from shipments
			where order_id is not null and match_status != 'excluded' and status in ('delivered', 'returned')
			group by order_id
		),
		s as (select *, coalesce(deliveredAt, returnedAt) as at from p)
		select o.id, o.name, s.at, s.deliveredAt is not null as delivered, s.couriers,
			o.is_prepaid as isPrepaid, o.total_paisa as total, o.shipping_charged_paisa as shipping,
			(o.cancelled_at is not null or o.total_paisa <= 0) as courierOnly,
			s.courier, s.tax, s.cod, s.courierEstimated,
			c.cogs, c.cogsEstimated, c.unitsNoCost
		from s join orders o on o.id = s.order_id
		left join (
			select l.order_id,
				sum(l.q * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0)) as cogs,
				max(case when l.cost_estimated = 1 or (l.cost_snapshot_paisa is null and coalesce(v.cost_source, 'none') != 'batch')
					then 1 else 0 end) as cogsEstimated,
				sum(case when coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) = 0 then l.q else 0 end) as unitsNoCost
			from (
				select l.*, case when o2.cancelled_at is not null or o2.total_paisa <= 0
					then coalesce(nullif(l.qty, 0), l.ordered_qty, 0) else l.qty end as q
				from order_lines l join orders o2 on o2.id = l.order_id
			) l left join variants v on v.id = l.variant_id
			where l.q > 0
			group by l.order_id
		) c on c.order_id = o.id
		where ${where}`)) as {
		id: string;
		name: string;
		at: string;
		delivered: number;
		couriers: string | null;
		isPrepaid: number;
		total: number;
		shipping: number;
		courierOnly: number;
		courier: number;
		tax: number;
		cod: number;
		courierEstimated: number;
		cogs: number | null;
		cogsEstimated: number | null;
		unitsNoCost: number | null;
	}[];

	return rows.map((r) => {
		const delivered = !!r.delivered;
		const courierOnly = !!r.courierOnly;
		const sales = !delivered ? 0 : courierOnly ? r.cod : r.total;
		const cogs = delivered ? (r.cogs ?? 0) : 0;
		const profit = sales - cogs - r.courier - r.tax;
		return {
			id: r.id,
			name: r.name,
			at: r.at,
			outcome: delivered ? 'delivered' : 'returned',
			couriers: r.couriers ?? '',
			isPrepaid: !!r.isPrepaid,
			sales,
			shipping: delivered && !courierOnly ? r.shipping : 0,
			cogs,
			courier: r.courier,
			tax: r.tax,
			profit,
			margin: sales ? profit / sales : NaN,
			cogsEstimated: delivered && !!r.cogsEstimated,
			unitsNoCost: delivered ? (r.unitsNoCost ?? 0) : 0,
			courierEstimated: !!r.courierEstimated,
			courierOnly: delivered && courierOnly
		};
	});
}
