/**
 * Profit per Shopify customer, all time. Uses the same per-order profit as the Orders page
 * (delivered → sales − product cost − courier fees − courier tax; returned → courier fees lost).
 * Customers are Shopify customer records as-is (no merging by phone).
 * Risky: 2 or more returned orders.
 */
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { orderProfits, type OrderProfit } from './order-profit.js';

export const RISKY_RETURNS = 2;

type OrderRow = {
	id: string;
	name: string;
	customerId: string;
	createdAt: string;
	cancelledAt: string | null;
	total: number;
	isPrepaid: number;
};

async function loadOrders(customerId?: string) {
	return (await db.all(sql`
		select id, name, customer_id as customerId, created_at as createdAt, cancelled_at as cancelledAt,
			total_paisa as total, is_prepaid as isPrepaid
		from orders
		where customer_id is not null and test = 0
			${customerId ? sql`and customer_id = ${customerId}` : sql``}
		order by created_at desc`)) as OrderRow[];
}

function summarize(orders: OrderRow[], profits: Map<string, OrderProfit>) {
	let delivered = 0,
		returned = 0,
		open = 0,
		cancelled = 0,
		sales = 0,
		profit = 0,
		advance = 0;
	for (const o of orders) {
		const p = profits.get(o.id);
		if (p) {
			profit += p.profit;
			sales += p.sales;
			if (p.outcome === 'delivered') delivered++;
			else returned++;
		} else if (o.cancelledAt || o.total <= 0) cancelled++;
		else open++;
		if (o.isPrepaid) advance++;
	}
	const finished = delivered + returned;
	return {
		orders: orders.length,
		delivered,
		returned,
		open,
		cancelled,
		advance,
		sales,
		profit,
		avgProfit: delivered ? Math.round(profit / delivered) : 0,
		returnRate: finished ? returned / finished : NaN,
		risky: returned >= RISKY_RETURNS,
		firstOrder: orders.at(-1)?.createdAt ?? null,
		lastOrder: orders[0]?.createdAt ?? null
	};
}

export async function customerList() {
	const [orders, profits, customers] = await Promise.all([
		loadOrders(),
		orderProfits({ all: true }),
		db.all(sql`select id, name, phone, city from customers`) as Promise<
			{ id: string; name: string | null; phone: string | null; city: string | null }[]
		>
	]);
	const byId = new Map(profits.map((p) => [p.id, p]));
	const grouped = new Map<string, OrderRow[]>();
	for (const o of orders) {
		const list = grouped.get(o.customerId);
		if (list) list.push(o);
		else grouped.set(o.customerId, [o]);
	}
	return customers
		.filter((c) => grouped.has(c.id))
		.map((c) => ({ ...c, ...summarize(grouped.get(c.id)!, byId) }));
}

export async function customerDetail(id: string) {
	const customer = (await db.all(
		sql`select id, name, phone, city from customers where id = ${id}`
	)) as { id: string; name: string | null; phone: string | null; city: string | null }[];
	if (!customer.length) return null;
	const orders = await loadOrders(id);
	const profits = await orderProfits({ ids: orders.map((o) => o.id) });
	const byId = new Map(profits.map((p) => [p.id, p]));
	return {
		customer: customer[0],
		summary: summarize(orders, byId),
		orders: orders.map((o) => {
			const p = byId.get(o.id) ?? null;
			const state = p
				? p.outcome
				: o.cancelledAt || o.total <= 0
					? ('cancelled' as const)
					: ('open' as const);
			return { ...o, isPrepaid: !!o.isPrepaid, profit: p, state };
		})
	};
}
