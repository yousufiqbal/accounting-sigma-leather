/**
 * Database schema. See SPEC.md §3.
 * Conventions:
 * - Money: integer paisa (`*_paisa`). Never floats.
 * - Timestamps: ISO-8601 text with offset (Asia/Karachi where it matters).
 * - Shopify ids: numeric part of the GID, stored as text (exceeds 2^53 safely as text).
 */
import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
	text('created_at')
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const money = (name: string) => integer(name).notNull().default(0);

// ─── Catalog & cost ────────────────────────────────────────────────────────────

export const variants = sqliteTable(
	'variants',
	{
		id: text('id').primaryKey(), // shopify variant id
		productId: text('product_id').notNull(),
		productTitle: text('product_title').notNull(),
		variantTitle: text('variant_title'),
		sku: text('sku'),
		inventoryItemId: text('inventory_item_id'),
		status: text('status'), // ACTIVE / DRAFT / ARCHIVED
		weightG: integer('weight_g'),
		price: money('price_paisa'),
		avgCost: money('avg_cost_paisa'),
		/** none = no cost yet · estimated = China price estimate · shopify = trusted Shopify cost · batch = from a landed import */
		costSource: text('cost_source', { enum: ['none', 'estimated', 'shopify', 'batch'] })
			.notNull()
			.default('none'),
		estCnPriceMinor: integer('est_cn_price_minor'), // for opening estimate, e.g. RMB fen
		estCurrency: text('est_currency', { enum: ['RMB', 'PKR'] }),
		/** Computed estimate: RMB price × FX + kg × DDP (PKR price as-is). */
		estCost: integer('est_cost_paisa'),
		/** Owner confirmed the Shopify "cost per item" is a correct landed cost. */
		shopifyCostOk: integer('shopify_cost_ok', { mode: 'boolean' }).notNull().default(false),
		shopifyCost: integer('shopify_cost_paisa'), // "cost per item" currently set in Shopify
		shopifyOnHand: integer('shopify_on_hand'),
		shopifySyncedAt: text('shopify_synced_at'),
		updatedAt: text('updated_at')
	},
	(t) => [index('variants_product_idx').on(t.productId), index('variants_sku_idx').on(t.sku)]
);

export const costHistory = sqliteTable('cost_history', {
	id: id(),
	variantId: text('variant_id').notNull(),
	at: text('at').notNull(),
	oldCost: money('old_cost_paisa'),
	newCost: money('new_cost_paisa'),
	reason: text('reason', { enum: ['opening', 'batch', 'manual'] }).notNull(),
	refId: text('ref_id'),
	createdAt: createdAt()
});

// ─── Imports from China (DDP) ──────────────────────────────────────────────────

export const importBatches = sqliteTable('import_batches', {
	id: id(),
	ref: text('ref').notNull(),
	supplier: text('supplier'),
	currency: text('currency', { enum: ['RMB', 'USD', 'PKR'] })
		.notNull()
		.default('RMB'),
	fxRateX10000: integer('fx_rate_x10000').notNull().default(0), // PKR per 1 unit × 10^4
	ddpRatePerKg: money('ddp_rate_per_kg_paisa'),
	status: text('status', { enum: ['draft', 'paid', 'landed'] })
		.notNull()
		.default('draft'),
	paidOn: text('paid_on'),
	landedOn: text('landed_on'),
	notes: text('notes'),
	createdAt: createdAt()
});

export const batchItems = sqliteTable('batch_items', {
	id: id(),
	batchId: text('batch_id').notNull(),
	variantId: text('variant_id').notNull(),
	qty: integer('qty').notNull(),
	unitPriceForeignMinor: integer('unit_price_foreign_minor').notNull().default(0),
	unitWeightG: integer('unit_weight_g').notNull().default(0),
	landedUnitCost: money('landed_unit_cost_paisa')
});

export const batchCosts = sqliteTable('batch_costs', {
	id: id(),
	batchId: text('batch_id').notNull(),
	type: text('type', { enum: ['ddp_cargo', 'local_cartage', 'other'] }).notNull(),
	amount: money('amount_paisa'),
	alloc: text('alloc', { enum: ['weight', 'value', 'qty'] })
		.notNull()
		.default('weight'),
	note: text('note')
});

// ─── Stock ledger ──────────────────────────────────────────────────────────────

export const stockMovements = sqliteTable(
	'stock_movements',
	{
		id: id(),
		variantId: text('variant_id').notNull(),
		at: text('at').notNull(),
		qtyDelta: integer('qty_delta').notNull(),
		type: text('type', {
			enum: ['opening', 'receipt', 'shipped', 'returned', 'adjust', 'variance']
		}).notNull(),
		unitCost: money('unit_cost_paisa'),
		reason: text('reason'),
		refType: text('ref_type'),
		refId: text('ref_id'),
		createdAt: createdAt()
	},
	(t) => [index('stock_variant_at_idx').on(t.variantId, t.at)]
);

// ─── Sales ─────────────────────────────────────────────────────────────────────

export const orders = sqliteTable(
	'orders',
	{
		id: text('id').primaryKey(), // shopify order id
		name: text('name').notNull(), // "2657"
		createdAt: text('created_at').notNull(),
		cancelledAt: text('cancelled_at'),
		financialStatus: text('financial_status'),
		fulfillmentStatus: text('fulfillment_status'),
		gateways: text('gateways'), // json array
		isPrepaid: integer('is_prepaid', { mode: 'boolean' }).notNull().default(false),
		/** Σ original unit price × current qty (before any discount). */
		grossSales: money('gross_sales_paisa'),
		/** Shopify current subtotal (after line discounts, before shipping). */
		subtotal: money('subtotal_paisa'),
		totalDiscounts: money('total_discounts_paisa'), // line-item discounts (prepaid + other)
		prepaidDiscount: money('prepaid_discount_paisa'), // the 5% advance-payment discount
		shippingCharged: money('shipping_charged_paisa'), // after shipping discounts
		total: money('total_paisa'), // current total (after edits/removals)
		refunded: money('refunded_paisa'),
		outstanding: money('outstanding_paisa'), // still to collect (COD part)
		discountCodes: text('discount_codes'), // json [{kind,label,value,amount}]
		tags: text('tags'), // json array
		fulfilledAt: text('fulfilled_at'),
		test: integer('test', { mode: 'boolean' }).notNull().default(false),
		shopifyUpdatedAt: text('shopify_updated_at'),
		updatedAt: text('updated_at')
	},
	(t) => [uniqueIndex('orders_name_idx').on(t.name), index('orders_created_idx').on(t.createdAt)]
);

export const orderLines = sqliteTable(
	'order_lines',
	{
		id: text('id').primaryKey(), // shopify line item id
		orderId: text('order_id').notNull(),
		variantId: text('variant_id'),
		sku: text('sku'),
		title: text('title').notNull(),
		qty: integer('qty').notNull(), // current quantity (after edits/removals)
		unitPrice: money('unit_price_paisa'),
		lineDiscount: money('line_discount_paisa'),
		costSnapshot: integer('cost_snapshot_paisa'), // avg cost at fulfillment
		costEstimated: integer('cost_estimated', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [index('order_lines_order_idx').on(t.orderId)]
);

// ─── Courier ───────────────────────────────────────────────────────────────────

export const statements = sqliteTable(
	'statements',
	{
		id: id(),
		courier: text('courier', { enum: ['postex', 'dex', 'manual'] }).notNull(),
		number: text('number').notNull(), // CPR-… / …NETOFF-…
		periodStart: text('period_start'),
		periodEnd: text('period_end'),
		statementDate: text('statement_date'),
		totalCod: money('total_cod_paisa'),
		totalPayable: money('total_payable_paisa'),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('statements_courier_number_idx').on(t.courier, t.number)]
);

export const shipments = sqliteTable(
	'shipments',
	{
		id: id(),
		courier: text('courier', { enum: ['postex', 'dex', 'manual'] }).notNull(),
		trackingNo: text('tracking_no').notNull(),
		originalTrackingNo: text('original_tracking_no'),
		orderRefRaw: text('order_ref_raw'),
		orderName: text('order_name'), // normalized Shopify order number, e.g. "2657"
		extraParcel: integer('extra_parcel', { mode: 'boolean' }).notNull().default(false), // "1326-2"
		orderId: text('order_id'),
		matchStatus: text('match_status', { enum: ['auto', 'manual', 'unmatched', 'excluded'] })
			.notNull()
			.default('unmatched'),
		status: text('status', {
			enum: ['booked', 'in_transit', 'delivered', 'returned', 'cancelled']
		}).notNull(),
		courierStatus: text('courier_status'), // raw status text
		bookedAt: text('booked_at'),
		pickupAt: text('pickup_at'),
		finalAt: text('final_at'), // delivered / returned date
		weightKg: text('weight_kg'),
		province: text('province'),
		city: text('city'),
		cod: money('cod_paisa'),
		fee: money('fee_paisa'),
		feeTax: money('fee_tax_paisa'),
		returnFee: money('return_fee_paisa'),
		returnFeeTax: money('return_fee_tax_paisa'),
		otherFees: money('other_fees_paisa'),
		itwh: money('itwh_paisa'),
		stwh: money('stwh_paisa'),
		netPayable: money('net_payable_paisa'),
		feesEstimated: integer('fees_estimated', { mode: 'boolean' }).notNull().default(false),
		taxesEstimated: integer('taxes_estimated', { mode: 'boolean' }).notNull().default(false),
		statementId: text('statement_id'),
		settledAt: text('settled_at'),
		conflictNote: text('conflict_note'), // set when a source disagrees; needs review
		raw: text('raw'), // json of last source row
		createdAt: createdAt(),
		updatedAt: text('updated_at')
	},
	(t) => [
		uniqueIndex('shipments_courier_tracking_idx').on(t.courier, t.trackingNo),
		index('shipments_order_idx').on(t.orderId),
		index('shipments_order_name_idx').on(t.orderName),
		index('shipments_final_idx').on(t.finalAt),
		index('shipments_statement_idx').on(t.statementId)
	]
);

export const shipmentChanges = sqliteTable('shipment_changes', {
	id: id(),
	shipmentId: text('shipment_id').notNull(),
	at: createdAt(),
	source: text('source').notNull(), // api | file:<id> | manual
	diff: text('diff').notNull() // json { field: [old, new] }
});

export const payouts = sqliteTable('payouts', {
	id: id(),
	courier: text('courier', { enum: ['postex', 'dex', 'manual'] }).notNull(),
	receivedOn: text('received_on').notNull(),
	amount: money('amount_paisa'),
	bankRef: text('bank_ref'),
	note: text('note'),
	createdAt: createdAt()
});

export const payoutStatements = sqliteTable(
	'payout_statements',
	{
		payoutId: text('payout_id').notNull(),
		statementId: text('statement_id').notNull()
	},
	(t) => [primaryKey({ columns: [t.payoutId, t.statementId] })]
);

export const importFiles = sqliteTable('import_files', {
	id: id(),
	sha256: text('sha256').notNull().unique(),
	filename: text('filename').notNull(),
	courier: text('courier').notNull(),
	counts: text('counts'), // json
	importedAt: createdAt()
});

/** Parsed file awaiting the admin's confirm on the preview screen. */
export const pendingImports = sqliteTable('pending_imports', {
	id: id(),
	sha256: text('sha256').notNull(),
	filename: text('filename').notNull(),
	courier: text('courier').notNull(),
	payload: text('payload').notNull(), // json ParsedFile
	createdAt: createdAt()
});

// ─── Expenses ──────────────────────────────────────────────────────────────────

export const expenseCategories = sqliteTable('expense_categories', {
	id: id(),
	name: text('name').notNull().unique(),
	group: text('group', { enum: ['marketing', 'operating', 'other'] }).notNull(),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
});

export const expenses = sqliteTable(
	'expenses',
	{
		id: id(),
		date: text('date').notNull(), // YYYY-MM-DD
		categoryId: text('category_id').notNull(),
		amount: money('amount_paisa'), // PKR actually paid (what the P&L uses)
		usdCents: integer('usd_cents'), // optional: original USD amount (card payments)
		fxRateX10000: integer('fx_rate_x10000'), // optional: PKR per 1 USD × 10^4
		note: text('note'),
		recurringId: text('recurring_id'),
		createdAt: createdAt()
	},
	(t) => [index('expenses_date_idx').on(t.date)]
);

export const recurringExpenses = sqliteTable('recurring_expenses', {
	id: id(),
	categoryId: text('category_id').notNull(),
	amount: money('amount_paisa'),
	dayOfMonth: integer('day_of_month').notNull().default(1),
	note: text('note'),
	active: integer('active', { mode: 'boolean' }).notNull().default(true)
});

// ─── System ────────────────────────────────────────────────────────────────────

export const monthLocks = sqliteTable('month_locks', {
	month: text('month').primaryKey(), // YYYY-MM
	lockedAt: createdAt()
});

export const syncRuns = sqliteTable('sync_runs', {
	id: id(),
	kind: text('kind').notNull(), // postex | shopify_products | shopify_orders | reconcile
	startedAt: createdAt(),
	finishedAt: text('finished_at'),
	ok: integer('ok', { mode: 'boolean' }),
	summary: text('summary') // json
});

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull() // json
});

export const loginAttempts = sqliteTable('login_attempts', {
	ip: text('ip').primaryKey(),
	count: integer('count').notNull().default(0),
	windowStart: integer('window_start').notNull() // epoch ms
});
