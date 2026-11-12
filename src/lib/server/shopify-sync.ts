/**
 * Shopify → local DB: variants (catalog + current cost/stock) and orders (with line items).
 * Then links courier parcels to orders by order number.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { gidId, shopifyGql } from './shopify.js';
import { toPaisa } from '../money.js';
import { getSetting, setSetting } from './settings.js';
import { recomputeCosts } from './costing.js';
import { recordStockChanges } from './stock.js';

type Money = { shopMoney: { amount: string } };
const amt = (m: Money | null | undefined) => toPaisa(m?.shopMoney.amount ?? 0);

async function logRun<T>(kind: string, fn: () => Promise<T>): Promise<T> {
	const [run] = await db
		.insert(schema.syncRuns)
		.values({ kind })
		.returning({ id: schema.syncRuns.id });
	try {
		const result = await fn();
		await db
			.update(schema.syncRuns)
			.set({ finishedAt: new Date().toISOString(), ok: true, summary: JSON.stringify(result) })
			.where(eq(schema.syncRuns.id, run.id));
		return result;
	} catch (e) {
		await db
			.update(schema.syncRuns)
			.set({
				finishedAt: new Date().toISOString(),
				ok: false,
				summary: JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
			})
			.where(eq(schema.syncRuns.id, run.id));
		throw e;
	}
}

// ─── Variants ──────────────────────────────────────────────────────────────────

type VariantNode = {
	id: string;
	title: string;
	sku: string | null;
	price: string;
	product: { id: string; title: string; status: string };
	inventoryItem: {
		id: string;
		unitCost: { amount: string } | null;
		measurement: { weight: { unit: string; value: number } | null } | null;
		inventoryLevels: { nodes: { quantities: { quantity: number }[] }[] };
	};
};

const toGrams = (w: { unit: string; value: number } | null | undefined) => {
	if (!w) return null;
	const f = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 }[w.unit] ?? 1;
	return Math.round(w.value * f);
};

/**
 * Pull all variants. Pass `stockAnchor` (time the preceding orders sync started) to also
 * record unexplained on-hand changes — callers must sync orders first. See `syncStock`.
 */
export function syncVariants(stockAnchor?: string) {
	return logRun('shopify_variants', async () => {
		let after: string | null = null;
		let count = 0;
		const now = new Date().toISOString();
		const before = new Map(
			(await db.select({ id: schema.variants.id, onHand: schema.variants.shopifyOnHand }).from(schema.variants)).map(
				(r) => [r.id, r.onHand]
			)
		);
		const afterOnHand = new Map<string, number>();
		do {
			const d: {
				productVariants: {
					pageInfo: { hasNextPage: boolean; endCursor: string };
					nodes: VariantNode[];
				};
			} = await shopifyGql(
				`query($after: String) {
					productVariants(first: 100, after: $after) {
						pageInfo { hasNextPage endCursor }
						nodes {
							id title sku price
							product { id title status }
							inventoryItem {
								id
								unitCost { amount }
								measurement { weight { unit value } }
								inventoryLevels(first: 5) { nodes { quantities(names: ["on_hand"]) { quantity } } }
							}
						}
					}
				}`,
				{ after }
			);
			const batch = d.productVariants.nodes.map((v) => {
				const onHand = v.inventoryItem.inventoryLevels.nodes.reduce(
					(s, l) => s + (l.quantities[0]?.quantity ?? 0),
					0
				);
				afterOnHand.set(gidId(v.id), onHand);
				const values = {
					id: gidId(v.id),
					productId: gidId(v.product.id),
					productTitle: v.product.title,
					variantTitle: v.title === 'Default Title' ? null : v.title,
					sku: v.sku || null,
					inventoryItemId: gidId(v.inventoryItem.id),
					status: v.product.status,
					weightG: toGrams(v.inventoryItem.measurement?.weight),
					price: toPaisa(v.price),
					shopifyCost: v.inventoryItem.unitCost ? toPaisa(v.inventoryItem.unitCost.amount) : null,
					shopifyOnHand: onHand,
					shopifySyncedAt: now,
					updatedAt: now
				};
				const { id: _id, ...update } = values;
				return db
					.insert(schema.variants)
					.values(values)
					.onConflictDoUpdate({ target: schema.variants.id, set: update });
			});
			if (batch.length) await db.batch(batch as [(typeof batch)[0], ...typeof batch]);
			count += batch.length;
			after = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
		} while (after);
		await recomputeCosts(); // weights / Shopify costs may have changed
		const stock = await recordStockChanges(before, afterOnHand, stockAnchor ?? now);
		return { variants: count, stockChanges: stock.changes };
	});
}

/** Orders first (so fulfilments explain stock drops), then variants + stock check. */
export async function syncStock(ordersMode: 'recent' | 'full' = 'recent') {
	const anchor = new Date().toISOString();
	const orders = await syncOrders(ordersMode);
	const variants = await syncVariants(anchor);
	return { ...orders, ...variants };
}

// ─── Orders ────────────────────────────────────────────────────────────────────

type DiscountApp = {
	index: number;
	__typename: string;
	targetType: string;
	value: { percentage?: number; amount?: string };
	code?: string;
	title?: string;
};
type OrderNode = {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	cancelledAt: string | null;
	test: boolean;
	displayFinancialStatus: string | null;
	displayFulfillmentStatus: string | null;
	paymentGatewayNames: string[];
	tags: string[];
	currentSubtotalPriceSet: Money;
	currentTotalPriceSet: Money;
	totalRefundedSet: Money;
	totalOutstandingSet: Money;
	shippingLines: { nodes: { discountedPriceSet: Money }[] };
	discountApplications: { nodes: DiscountApp[] };
	fulfillments: { createdAt: string }[];
	lineItems: {
		nodes: {
			id: string;
			title: string;
			sku: string | null;
			quantity: number;
			currentQuantity: number;
			variant: { id: string } | null;
			originalUnitPriceSet: Money;
			discountAllocations: { allocatedAmountSet: Money; discountApplication: { index: number } }[];
		}[];
	};
};

const ORDER_FIELDS = `
	id name createdAt updatedAt cancelledAt test
	displayFinancialStatus displayFulfillmentStatus paymentGatewayNames tags
	currentSubtotalPriceSet { shopMoney { amount } }
	currentTotalPriceSet { shopMoney { amount } }
	totalRefundedSet { shopMoney { amount } }
	totalOutstandingSet { shopMoney { amount } }
	shippingLines(first: 5) { nodes { discountedPriceSet { shopMoney { amount } } } }
	discountApplications(first: 60) { nodes {
		index __typename targetType
		value { ... on PricingPercentageValue { percentage } ... on MoneyV2 { amount } }
		... on DiscountCodeApplication { code }
		... on ManualDiscountApplication { title }
		... on AutomaticDiscountApplication { title }
	} }
	fulfillments(first: 5) { createdAt }
	lineItems(first: 60) { nodes {
		id title sku quantity currentQuantity
		variant { id }
		originalUnitPriceSet { shopMoney { amount } }
		discountAllocations { allocatedAmountSet { shopMoney { amount } } discountApplication { index } }
	} }`;

/**
 * The advance-payment discount: a manual (or ADV code) 5% discount.
 * Automatic promos like "Buy 2 Get 5% Off" are NOT prepaid discounts.
 */
export function isPrepaidDiscount(app: DiscountApp): boolean {
	const label = `${app.code ?? ''} ${app.title ?? ''}`;
	if (/adv|advance|prepa/i.test(label)) return true;
	if (app.__typename === 'AutomaticDiscountApplication') return false;
	return app.value.percentage === 5;
}

function toRows(o: OrderNode) {
	const orderId = gidId(o.id);
	const apps = new Map(o.discountApplications.nodes.map((a) => [a.index, a]));
	let grossSales = 0;
	let prepaidDiscount = 0;
	let otherDiscount = 0;
	const lines = o.lineItems.nodes.map((li) => {
		const unit = amt(li.originalUnitPriceSet);
		// Allocations are for the original quantity; scale to what's left after edits.
		const share = li.quantity ? li.currentQuantity / li.quantity : 0;
		let lineDiscount = 0;
		for (const a of li.discountAllocations) {
			const v = Math.round(amt(a.allocatedAmountSet) * share);
			lineDiscount += v;
			const app = apps.get(a.discountApplication.index);
			if (app && isPrepaidDiscount(app)) prepaidDiscount += v;
			else otherDiscount += v;
		}
		grossSales += unit * li.currentQuantity;
		return {
			id: gidId(li.id),
			orderId,
			variantId: li.variant ? gidId(li.variant.id) : null,
			sku: li.sku || null,
			title: li.title,
			qty: li.currentQuantity,
			unitPrice: unit,
			lineDiscount
		};
	});
	const gateways = o.paymentGatewayNames;
	const hasCod = gateways.some((g) => /cash on delivery|cod/i.test(g));
	const isPrepaid =
		gateways.some((g) => /advance payment/i.test(g)) ||
		(!hasCod && gateways.includes('manual')) ||
		prepaidDiscount > 0;
	const fulfilledAt = o.fulfillments.map((f) => f.createdAt).sort()[0] ?? null;
	const order = {
		id: orderId,
		name: o.name.replace(/^#/, ''),
		createdAt: o.createdAt,
		cancelledAt: o.cancelledAt,
		financialStatus: o.displayFinancialStatus,
		fulfillmentStatus: o.displayFulfillmentStatus,
		gateways: JSON.stringify(gateways),
		isPrepaid,
		grossSales,
		subtotal: amt(o.currentSubtotalPriceSet),
		totalDiscounts: prepaidDiscount + otherDiscount,
		prepaidDiscount,
		shippingCharged: o.shippingLines.nodes.reduce((s, l) => s + amt(l.discountedPriceSet), 0),
		total: amt(o.currentTotalPriceSet),
		refunded: amt(o.totalRefundedSet),
		outstanding: amt(o.totalOutstandingSet),
		discountCodes: JSON.stringify(
			o.discountApplications.nodes.map((a) => ({
				kind: isPrepaidDiscount(a) ? 'prepaid' : 'other',
				label: a.code ?? a.title ?? a.__typename.replace('DiscountApplication', ''),
				value: a.value.percentage != null ? `${a.value.percentage}%` : a.value.amount,
				target: a.targetType
			}))
		),
		tags: JSON.stringify(o.tags),
		fulfilledAt,
		test: o.test,
		shopifyUpdatedAt: o.updatedAt,
		updatedAt: new Date().toISOString()
	};
	return { order, lines };
}

/** `recent` = orders updated since the last sync (minus a safety day); `full` = everything. */
export function syncOrders(mode: 'recent' | 'full' = 'recent') {
	return logRun(`shopify_orders_${mode}`, async () => {
		const since = mode === 'recent' ? await getSetting<string>('shopify_orders_since') : null;
		const q = since
			? `updated_at:>='${new Date(new Date(since).getTime() - 86_400_000).toISOString()}'`
			: null;
		let after: string | null = null;
		let count = 0;
		let maxUpdated = since ?? '';
		do {
			const d: {
				orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: OrderNode[] };
			} = await shopifyGql(
				`query($after: String, $q: String) {
					orders(first: 40, after: $after, query: $q, sortKey: UPDATED_AT) {
						pageInfo { hasNextPage endCursor }
						nodes { ${ORDER_FIELDS} }
					}
				}`,
				{ after, q }
			);
			const stmts = [];
			for (const node of d.orders.nodes) {
				const { order, lines } = toRows(node);
				const { id: _id, ...orderUpdate } = order;
				stmts.push(
					db
						.insert(schema.orders)
						.values(order)
						.onConflictDoUpdate({ target: schema.orders.id, set: orderUpdate })
				);
				for (const l of lines) {
					const { id: _lid, ...lineUpdate } = l;
					stmts.push(
						db
							.insert(schema.orderLines)
							.values(l)
							.onConflictDoUpdate({ target: schema.orderLines.id, set: lineUpdate })
					);
				}
				if (node.updatedAt > maxUpdated) maxUpdated = node.updatedAt;
			}
			for (let i = 0; i < stmts.length; i += 120) {
				const chunk = stmts.slice(i, i + 120);
				await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
			}
			count += d.orders.nodes.length;
			after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
		} while (after);
		if (maxUpdated) await setSetting('shopify_orders_since', maxUpdated);
		const links = await linkShipmentsToOrders();
		return { orders: count, ...links };
	});
}

/**
 * Link parcels to orders by order number. Parcels with no Shopify order number that were
 * booked before the first Shopify order are pre-Shopify → excluded.
 */
export async function linkShipmentsToOrders() {
	const linked = await db.run(sql`
		update shipments set
			order_id = (select o.id from orders o where o.name = shipments.order_name),
			match_status = 'auto'
		where match_status = 'unmatched'
			and order_name is not null
			and exists (select 1 from orders o where o.name = shipments.order_name)`);
	const excluded = await db.run(sql`
		update shipments set match_status = 'excluded'
		where match_status = 'unmatched'
			and order_id is null
			and order_name is null
			and coalesce(booked_at, pickup_at, final_at) < (select min(created_at) from orders)`);
	return { parcelsLinked: linked.rowsAffected, parcelsExcluded: excluded.rowsAffected };
}
