import { fail } from '@sveltejs/kit';
import { and, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { orderProfits } from '#lib/server/order-profit.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 50;
const SORTS = ['recent', 'order', 'order_asc', 'low', 'high'] as const;
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

type Parcel = {
	courier: string;
	status: string;
	trackingNo: string;
	finalAt: string | null;
	cod: number;
	label: string | null;
	extra: number;
};

/** Order rows (any month) with parcels and profit, for search and the no-courier list. */
async function orderRows(where: SQL) {
	const rows = await db
		.select({
			id: o.id,
			name: o.name,
			createdAt: o.createdAt,
			cancelledAt: o.cancelledAt,
			fulfillmentStatus: o.fulfillmentStatus,
			isPrepaid: o.isPrepaid,
			total: o.total,
			outstanding: o.outstanding,
			tags: o.tags,
			parcels: sql<string | null>`(
				select json_group_array(json_object(
					'courier', s.courier, 'status', s.status, 'trackingNo', s.tracking_no,
					'finalAt', s.final_at, 'cod', s.cod_paisa, 'label', s.courier_status, 'extra', s.extra_parcel))
				from shipments s where s.order_id = orders.id and s.status != 'cancelled')`
		})
		.from(o)
		.where(where)
		.orderBy(desc(o.createdAt))
		.limit(PAGE_SIZE);
	const profits = new Map(
		(await orderProfits({ ids: rows.map((r) => r.id) })).map((p) => [p.id, p])
	);
	return rows.map((r) => {
		const parcels = (JSON.parse(r.parcels ?? '[]') as Parcel[]).filter((p) => p.trackingNo);
		const profit = profits.get(r.id) ?? null;
		const shipped =
			r.fulfillmentStatus === 'FULFILLED' || r.fulfillmentStatus === 'PARTIALLY_FULFILLED';
		const state: 'delivered' | 'returned' | 'cancelled' | 'in_transit' | 'shipped' | 'not_shipped' =
			profit
				? profit.outcome
				: r.cancelledAt
					? 'cancelled'
					: parcels.length
						? 'in_transit'
						: shipped
							? 'shipped'
							: 'not_shipped';
		return { ...r, tags: JSON.parse(r.tags ?? '[]') as string[], parcels, profit, state, shipped };
	});
}

export const load: PageServerLoad = async ({ url, parent }) => {
	const { month } = await parent();
	const sort = (SORTS as readonly string[]).includes(url.searchParams.get('sort') ?? '')
		? (url.searchParams.get('sort') as (typeof SORTS)[number])
		: 'recent';
	const q = url.searchParams.get('q')?.trim().replace(/^#/, '') ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const mode: 'profit' | 'search' | 'nocourier' = q
		? 'search'
		: url.searchParams.get('view') === 'nocourier'
			? 'nocourier'
			: 'profit';

	const [{ n: noCourierCount }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(o)
		.where(noCourierData);
	// Not delivered or returned yet (same rule as the In progress page).
	const [{ n: openCount }] = (await db.all(sql`
		select count(*) as n from orders o
		where o.cancelled_at is null and o.test = 0 and o.total_paisa > 0
			and not exists (select 1 from shipments s where s.order_id = o.id
				and s.status in ('delivered', 'returned') and s.match_status != 'excluded')`)) as {
		n: number;
	}[];
	// Delivered custom items (no Shopify product) still without a cost.
	const [{ n: noCostCount }] = (await db.all(sql`
		select count(*) as n from order_lines l join orders o on o.id = l.order_id
		where l.variant_id is null and l.qty > 0 and coalesce(l.cost_snapshot_paisa, 0) = 0 and o.test = 0
			and exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered')`)) as {
		n: number;
	}[];
	const base = { mode, q, sort, page, noCourierCount, openCount, noCostCount };

	if (mode !== 'profit') {
		const orders = await orderRows(mode === 'search' ? like(o.name, `%${q}%`) : noCourierData);
		return { ...base, orders, totals: null, profits: [], pageCount: 1, totalRows: orders.length };
	}

	const all = await orderProfits({ month });
	const sum = (k: 'sales' | 'cogs' | 'courier' | 'tax' | 'profit') =>
		all.reduce((s, r) => s + r[k], 0);
	const returned = all.filter((r) => r.outcome === 'returned');
	const totals = {
		orders: all.length - returned.length,
		returned: returned.length,
		returnLoss: returned.reduce((s, r) => s + r.profit, 0),
		losing: all.filter((r) => r.outcome === 'delivered' && r.profit < 0).length,
		sales: sum('sales'),
		profit: sum('profit'),
		estimated: all.some((r) => r.cogsEstimated || r.courierEstimated || r.unitsNoCost > 0)
	};
	const byName = (a: { name: string }, b: { name: string }) =>
		Number(a.name) - Number(b.name) || a.name.localeCompare(b.name);
	const list = all.sort((a, b) =>
		sort === 'low'
			? a.profit - b.profit
			: sort === 'high'
				? b.profit - a.profit
				: sort === 'order'
					? byName(b, a)
					: sort === 'order_asc'
						? byName(a, b)
						: b.at.localeCompare(a.at)
	);
	return {
		...base,
		orders: [],
		totals,
		profits: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
		pageCount: Math.max(1, Math.ceil(list.length / PAGE_SIZE)),
		totalRows: list.length
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
