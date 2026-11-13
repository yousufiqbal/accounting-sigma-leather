/**
 * Orders not finished yet (not delivered or returned): expected profit, an ESTIMATE only.
 * Never counted in reports — revenue counts on delivery.
 *
 *   Sales (order total) − product cost
 *   − courier fee: the parcel's own fee if known, else the usual PostEx fee (median);
 *     none for prepaid orders shipped without tracking (customer paid delivery)
 *   − courier tax: the usual withholding rate (from delivered PostEx parcels) × cash to collect
 */
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { estimatedFee } from './assumptions.js';

export type OpenOrder = Awaited<ReturnType<typeof openOrders>>['orders'][number];

export async function openOrders() {
	const rows = (await db.all(sql`
		select o.id, o.name, o.created_at as createdAt, o.fulfillment_status as fulfillmentStatus,
			o.fulfillment_tracking as tracking, o.is_prepaid as isPrepaid,
			o.total_paisa as total, o.outstanding_paisa as outstanding,
			(select coalesce(sum(l.qty * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0)), 0)
				from order_lines l left join variants v on v.id = l.variant_id where l.order_id = o.id) as cogs,
			(select coalesce(sum(case when coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) = 0 then l.qty else 0 end), 0)
				from order_lines l left join variants v on v.id = l.variant_id where l.order_id = o.id and l.qty > 0) as unitsNoCost,
			(select json_group_array(json_object('courier', s.courier, 'status', s.status, 'trackingNo', s.tracking_no,
					'bookedAt', s.booked_at, 'fee', s.fee_paisa + s.fee_tax_paisa, 'label', s.courier_status))
				from shipments s where s.order_id = o.id and s.status != 'cancelled') as parcels
		from orders o
		where o.cancelled_at is null and o.test = 0 and o.total_paisa > 0
			and not exists (select 1 from shipments s where s.order_id = o.id
				and s.status in ('delivered', 'returned') and s.match_status != 'excluded')
		order by o.created_at desc`)) as {
		id: string;
		name: string;
		createdAt: string;
		fulfillmentStatus: string | null;
		tracking: string | null;
		isPrepaid: number;
		total: number;
		outstanding: number;
		cogs: number;
		unitsNoCost: number;
		parcels: string;
	}[];

	const usualFee = await estimatedFee();
	// Recent rates (last 90 days of PostEx parcels): withholding per Rs of COD, and returns.
	const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
	const [r] = (await db.all(sql`
		select
			coalesce(sum(case when status = 'delivered' and cod_paisa > 0 then itwh_paisa + stwh_paisa end) * 1.0
				/ nullif(sum(case when status = 'delivered' and cod_paisa > 0 then cod_paisa end), 0), 0) as taxRate,
			coalesce(sum(case when status = 'returned' then 1 else 0 end) * 1.0
				/ nullif(sum(case when status in ('delivered', 'returned') then 1 else 0 end), 0), 0) as returnRate
		from shipments
		where courier = 'postex' and final_at >= ${since} and match_status != 'excluded'`)) as {
		taxRate: number;
		returnRate: number;
	}[];

	const orders = rows.map((o) => {
		const parcels = (
			JSON.parse(o.parcels ?? '[]') as {
				courier: string;
				status: string;
				trackingNo: string;
				bookedAt: string | null;
				fee: number;
				label: string | null;
			}[]
		).filter((p) => p.trackingNo);
		const shipped =
			o.fulfillmentStatus === 'FULFILLED' || o.fulfillmentStatus === 'PARTIALLY_FULFILLED';
		const customerPaidDelivery = !!o.isPrepaid && shipped && !o.tracking;
		const knownFee = parcels.reduce((s, p) => s + (p.fee || 0), 0);
		const courier = customerPaidDelivery ? 0 : knownFee || usualFee;
		const cash = o.isPrepaid ? Math.max(0, o.outstanding) : o.outstanding || o.total;
		const tax = Math.round(cash * r.taxRate);
		const profit = o.total - o.cogs - courier - tax;
		const state: 'not_shipped' | 'in_transit' | 'shipped' = parcels.length
			? 'in_transit'
			: shipped
				? 'shipped'
				: 'not_shipped';
		return {
			id: o.id,
			name: o.name,
			createdAt: o.createdAt,
			isPrepaid: !!o.isPrepaid,
			state,
			parcels,
			sales: o.total,
			cogs: o.cogs,
			unitsNoCost: o.unitsNoCost,
			courier,
			courierKnown: knownFee > 0,
			tax,
			profit,
			margin: o.total ? profit / o.total : NaN
		};
	});

	const sum = (k: 'sales' | 'cogs' | 'courier' | 'tax' | 'profit') =>
		orders.reduce((s, o) => s + o[k], 0);
	const profit = sum('profit');
	// Expected after returns: returned parcels earn nothing and still pay courier fees.
	const afterReturns = Math.round(profit * (1 - r.returnRate) - sum('courier') * r.returnRate);
	return {
		orders,
		totals: {
			count: orders.length,
			notShipped: orders.filter((o) => o.state === 'not_shipped').length,
			sales: sum('sales'),
			profit,
			afterReturns,
			unitsNoCost: orders.reduce((s, o) => s + o.unitsNoCost, 0)
		},
		rates: { taxRate: r.taxRate, returnRate: r.returnRate, usualFee }
	};
}
