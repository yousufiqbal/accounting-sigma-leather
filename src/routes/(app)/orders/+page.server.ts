import { fail } from '@sveltejs/kit';
import { and, desc, eq, gte, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { monthBoundsUtc } from '#lib/month.js';
import { toPaisa } from '#lib/money.js';
import { orderProfits } from '#lib/server/order-profit.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 50;
const VIEWS = ['profit', 'month', 'nocourier', 'all'] as const;
const SORTS = ['recent', 'low', 'high'] as const;
type View = (typeof VIEWS)[number];
const o = schema.orders;

/** Has at least one non-cancelled parcel. */
const hasParcel = sql`exists (select 1 from shipments s where s.order_id = orders.id and s.status != 'cancelled')`;
/** Shipped from Shopify's side, but no courier data at all. */
const noCourierData = and(
	isNull(o.cancelledAt),
	eq(o.test, false),
	or(eq(o.fulfillmentStatus, 'FULFILLED'), eq(o.fulfillmentStatus, 'PARTIALLY_FULFILLED')),
	sql`not ${hasParcel}`
)!;

export const load: PageServerLoad = async ({ url, parent }) => {
	const { month } = await parent();
	const { start, end } = monthBoundsUtc(month);
	const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as View)
		: 'profit';
	const sort = (SORTS as readonly string[]).includes(url.searchParams.get('sort') ?? '')
		? (url.searchParams.get('sort') as (typeof SORTS)[number])
		: 'recent';
	const q = url.searchParams.get('q')?.trim().replace(/^#/, '') ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const inMonth = and(gte(o.createdAt, start), lt(o.createdAt, end))!;
	const [summary] = await db
		.select({
			orders: sql<number>`count(*)`,
			cancelled: sql<number>`sum(case when ${o.cancelledAt} is not null then 1 else 0 end)`,
			prepaid: sql<number>`sum(case when ${o.isPrepaid} and ${o.cancelledAt} is null then 1 else 0 end)`,
			booked: sql<number>`sum(case when ${o.cancelledAt} is null then ${o.total} else 0 end)`
		})
		.from(o)
		.where(inMonth);
	const [{ n: noCourierCount }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(o)
		.where(noCourierData);

	const lastSync = await db.query.syncRuns.findFirst({
		where: like(schema.syncRuns.kind, 'shopify_orders%'),
		orderBy: desc(schema.syncRuns.startedAt)
	});
	const base = {
		view,
		q,
		sort,
		page,
		summary,
		noCourierCount,
		lastSync: lastSync ? { at: lastSync.startedAt, ok: lastSync.ok } : null
	};

	if (view === 'profit') {
		const all = await orderProfits(month);
		const sum = (k: 'sales' | 'cogs' | 'courier' | 'tax' | 'profit') =>
			all.reduce((s, r) => s + r[k], 0);
		const returned = all.filter((r) => r.outcome === 'returned');
		const totals = {
			orders: all.length - returned.length,
			returned: returned.length,
			returnLoss: returned.reduce((s, r) => s + r.profit, 0),
			losing: all.filter((r) => r.outcome === 'delivered' && r.profit < 0).length,
			sales: sum('sales'),
			cogs: sum('cogs'),
			courier: sum('courier'),
			tax: sum('tax'),
			profit: sum('profit'),
			estimated: all.some((r) => r.cogsEstimated || r.courierEstimated || r.unitsNoCost > 0)
		};
		const list = (q ? all.filter((r) => r.name.includes(q)) : all).sort((a, b) =>
			sort === 'low'
				? a.profit - b.profit
				: sort === 'high'
					? b.profit - a.profit
					: b.at.localeCompare(a.at)
		);
		return {
			...base,
			pageCount: Math.max(1, Math.ceil(list.length / PAGE_SIZE)),
			totalRows: list.length,
			totals,
			profits: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
			orders: [] as never[]
		};
	}

	const filters: SQL[] = [];
	if (view === 'month') filters.push(inMonth);
	if (view === 'nocourier') filters.push(noCourierData);
	if (q) filters.push(like(o.name, `%${q}%`));
	const where = filters.length ? and(...filters) : undefined;

	const [{ n: totalRows }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(o)
		.where(where);
	const rows = await db
		.select({
			id: o.id,
			name: o.name,
			createdAt: o.createdAt,
			cancelledAt: o.cancelledAt,
			financialStatus: o.financialStatus,
			fulfillmentStatus: o.fulfillmentStatus,
			isPrepaid: o.isPrepaid,
			grossSales: o.grossSales,
			prepaidDiscount: o.prepaidDiscount,
			totalDiscounts: o.totalDiscounts,
			shippingCharged: o.shippingCharged,
			total: o.total,
			outstanding: o.outstanding,
			tags: o.tags,
			gateways: o.gateways,
			parcels: sql<string | null>`(
				select json_group_array(json_object(
					'courier', s.courier, 'status', s.status, 'trackingNo', s.tracking_no,
					'finalAt', s.final_at, 'cod', s.cod_paisa, 'label', s.courier_status, 'extra', s.extra_parcel))
				from shipments s where s.order_id = orders.id and s.status != 'cancelled')`
		})
		.from(o)
		.where(where)
		.orderBy(desc(o.createdAt))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE);

	return {
		...base,
		pageCount: Math.max(1, Math.ceil(totalRows / PAGE_SIZE)),
		totalRows,
		totals: null,
		profits: [],
		orders: rows.map((r) => ({
			...r,
			tags: JSON.parse(r.tags ?? '[]') as string[],
			gateways: JSON.parse(r.gateways ?? '[]') as string[],
			parcels: (
				JSON.parse(r.parcels ?? '[]') as {
					courier: string;
					status: string;
					trackingNo: string;
					finalAt: string | null;
					cod: number;
					label: string | null;
					extra: number;
				}[]
			).filter((p) => p.trackingNo)
		}))
	};
};

export const actions: Actions = {
	/** Record a delivery that has no PostEx/DEX data (Leopards, pickup, own rider…). */
	manualDelivery: async ({ request }) => {
		const f = await request.formData();
		const orderId = String(f.get('orderId') ?? '');
		const order = await db.query.orders.findFirst({ where: eq(o.id, orderId) });
		if (!order) return fail(400, { error: 'Order not found.' });
		const status = f.get('status') === 'returned' ? 'returned' : 'delivered';
		const date = String(f.get('date') ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, { error: 'Pick a date.' });
		const how = String(f.get('how') ?? '').trim() || 'Manual';
		let cash: number, fee: number;
		try {
			cash = status === 'delivered' ? toPaisa(String(f.get('cash') ?? '0')) : 0;
			fee = Math.abs(toPaisa(String(f.get('fee') ?? '0')));
		} catch {
			return fail(400, { error: 'Amounts must be numbers.' });
		}
		const received = f.get('received') === 'on';
		const finalAt = new Date(`${date}T12:00:00+05:00`).toISOString();
		await db.insert(schema.shipments).values({
			courier: 'manual',
			trackingNo: `M-${order.name}-${Date.now().toString(36)}`,
			orderRefRaw: order.name,
			orderName: order.name,
			orderId: order.id,
			matchStatus: 'manual',
			status,
			courierStatus: how,
			finalAt,
			cod: cash,
			fee: status === 'delivered' ? fee : 0,
			returnFee: status === 'returned' ? fee : 0,
			netPayable: cash - fee,
			settledAt: received ? finalAt : null,
			updatedAt: new Date().toISOString()
		});
		return { saved: `#${order.name} marked ${status} (${how}).` };
	}
};
