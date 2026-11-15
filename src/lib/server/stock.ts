/**
 * Stock ledger + import batches (SPEC.md §3 "Imports", §5).
 *
 * Landed unit cost = unit price × FX (PKR: as-is)
 *                  + unit kg × transport rate/kg
 *                  + share of extra batch costs (by goods value).
 * Landing a batch:
 *   0. claims the batch (status → 'landing'; a second click is refused) and saves the
 *      pre-receipt on-hand snapshot, so a retry after a failure reuses it,
 *   1. reads live Shopify on-hand (first attempt only),
 *   2. freezes cost snapshots of everything sold so far at the old cost,
 *   3. new avg = (on_hand × old + qty × landed) / (on_hand + qty),
 *   4. pushes +qty (reason "received", idempotent per batch) and new cost to Shopify,
 *   5. writes receipt movements + cost history and marks the batch landed.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { gidId, shopifyGql } from './shopify.js';
import { ddpCost, goodsCost } from './costing.js';

const v = schema.variants;

// ─── Opening stock ─────────────────────────────────────────────────────────────

/** One-time: Shopify on-hand today becomes the opening stock (cutover). */
export async function recordOpeningStock() {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(schema.stockMovements)
		.where(eq(schema.stockMovements.type, 'opening'));
	if (n > 0) throw new Error('Opening stock is already recorded.');
	const rows = await db
		.select({ id: v.id, onHand: v.shopifyOnHand, avgCost: v.avgCost })
		.from(v)
		.where(sql`${v.shopifyOnHand} > 0`);
	const at = new Date().toISOString();
	const stmts = rows.map((r) =>
		db.insert(schema.stockMovements).values({
			variantId: r.id,
			at,
			qtyDelta: r.onHand!,
			type: 'opening',
			unitCost: r.avgCost,
			reason: 'Shopify on-hand at cutover'
		})
	);
	for (let i = 0; i < stmts.length; i += 100) {
		const chunk = stmts.slice(i, i + 100);
		await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
	}
	return { variants: rows.length, units: rows.reduce((s, r) => s + (r.onHand ?? 0), 0) };
}

// ─── Batch maths ───────────────────────────────────────────────────────────────

type Batch = typeof schema.importBatches.$inferSelect;
type Item = typeof schema.batchItems.$inferSelect;
type Cost = typeof schema.batchCosts.$inferSelect;

/**
 * Landed cost per piece:
 *   goods  = unit price × FX (PKR: as-is)
 *   transport = either per kg (billed box weight × rate/kg — the China forwarder) or one fixed
 *               bill (e.g. local carriage); before the box weight is known, per-kg transport is
 *               estimated as unit weight × rate and the purchase is "transport pending"
 *   extra     = other shipment costs
 * Transport and extras are split by weight (a fixed bill can choose goods value instead). When
 * not every item has a weight, by value — so no item ends up without a share; no value: by pieces.
 */
export function priceBatch(batch: Batch, items: Item[], costs: Cost[]) {
	const fx = batch.currency === 'PKR' ? 10_000 : batch.fxRateX10000;
	const itemWeight = items.reduce((t, it) => t + it.unitWeightG * it.qty, 0);
	const goodsTotal = items.reduce(
		(t, it) => t + goodsCost(it.unitPriceForeignMinor, batch.currency, fx) * it.qty,
		0
	);
	const billed = batch.billedWeightG ?? null;
	const fixed = batch.ddpTotal !== null;
	const ddpTotal = fixed
		? batch.ddpTotal!
		: billed !== null
			? Math.round((billed * batch.ddpRatePerKg) / 1000)
			: null;
	const ddpPending = !fixed && ddpTotal === null && batch.ddpRatePerKg > 0;
	const extraTotal = costs.reduce((t, c) => t + c.amount, 0);

	const units = items.reduce((t, it) => t + it.qty, 0);
	/** What the purchase asks for, and what is actually used (weight needs every item's weight). */
	const splitChosen: 'weight' | 'value' =
		fixed && batch.transportSplit === 'value' ? 'value' : 'weight';
	const allWeighed = items.length > 0 && items.every((it) => it.unitWeightG > 0);
	const split: 'weight' | 'value' | 'pieces' =
		splitChosen === 'weight' && allWeighed ? 'weight' : goodsTotal > 0 ? 'value' : 'pieces';
	/** One piece's share (0–1) of a shipment-wide cost. */
	const share = (it: Item, goods: number) =>
		split === 'weight'
			? it.unitWeightG / itemWeight
			: split === 'value'
				? goods / goodsTotal
				: units > 0
					? 1 / units
					: 0;

	const out = items.map((it) => {
		const goods = goodsCost(it.unitPriceForeignMinor, batch.currency, fx);
		const ddp =
			ddpTotal === null
				? ddpCost(it.unitWeightG, batch.ddpRatePerKg) // estimate until the box is weighed
				: Math.round(ddpTotal * share(it, goods));
		const extra = Math.round(extraTotal * share(it, goods));
		return { ...it, goods, ddp, extra, landed: goods + ddp + extra };
	});
	return {
		lines: out,
		totals: {
			units: out.reduce((t, l) => t + l.qty, 0),
			goods: goodsTotal,
			ddp: out.reduce((t, l) => t + l.ddp * l.qty, 0),
			extra: extraTotal,
			landed: out.reduce((t, l) => t + l.landed * l.qty, 0),
			weightG: itemWeight
		},
		shipment: {
			billedWeightG: billed,
			ddpTotal,
			ddpPending,
			/** One fixed transport bill instead of weight × rate. */
			fixed,
			/** How transport and extras are shared between items (chosen vs used). */
			splitChosen,
			split,
			/** Box weight vs item weights: cartons, packing, rounding. */
			overhead: billed !== null && itemWeight > 0 ? billed / itemWeight - 1 : null,
			itemsWithoutWeight: out.filter((l) => l.unitWeightG <= 0).length
		}
	};
}

export async function loadBatch(id: string) {
	const batch = await db.query.importBatches.findFirst({ where: eq(schema.importBatches.id, id) });
	if (!batch) return null;
	const items = await db.select().from(schema.batchItems).where(eq(schema.batchItems.batchId, id));
	const costs = await db.select().from(schema.batchCosts).where(eq(schema.batchCosts.batchId, id));
	return { batch, items, costs, ...priceBatch(batch, items, costs) };
}

// ─── Shopify helpers ───────────────────────────────────────────────────────────

async function primaryLocation() {
	const d = await shopifyGql<{ locations: { nodes: { id: string; isActive: boolean }[] } }>(
		`{ locations(first: 10) { nodes { id isActive } } }`
	);
	const loc = d.locations.nodes.find((l) => l.isActive);
	if (!loc) throw new Error('No active Shopify location.');
	return loc.id;
}

async function liveOnHand(inventoryItemIds: string[], locationId: string) {
	const out = new Map<string, number>();
	for (let i = 0; i < inventoryItemIds.length; i += 100) {
		const ids = inventoryItemIds.slice(i, i + 100).map((x) => `gid://shopify/InventoryItem/${x}`);
		const d = await shopifyGql<{
			nodes: ({
				id: string;
				inventoryLevel: { quantities: { quantity: number }[] } | null;
			} | null)[];
		}>(
			`query($ids: [ID!]!, $loc: ID!) { nodes(ids: $ids) { ... on InventoryItem {
				id inventoryLevel(locationId: $loc) { quantities(names: ["on_hand"]) { quantity } }
			} } }`,
			{ ids, loc: locationId }
		);
		for (const n of d.nodes)
			if (n) out.set(gidId(n.id), n.inventoryLevel?.quantities[0]?.quantity ?? 0);
	}
	return out;
}

async function pushReceipt(
	batchId: string,
	ref: string,
	changes: { inventoryItemId: string; delta: number }[],
	locationId: string
) {
	for (let i = 0; i < changes.length; i += 100) {
		const d = await shopifyGql<{
			inventoryAdjustQuantities: { userErrors: { field: string[]; message: string }[] };
		}>(
			`mutation($input: InventoryAdjustQuantitiesInput!, $key: String!) {
				inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } }
			}`,
			{
				key: `sl-batch-${batchId}-${i / 100}`,
				input: {
					name: 'available',
					reason: 'received',
					referenceDocumentUri: `accounting-panel://import-batch/${encodeURIComponent(ref)}`,
					changes: changes.slice(i, i + 100).map((c) => ({
						inventoryItemId: `gid://shopify/InventoryItem/${c.inventoryItemId}`,
						locationId,
						delta: c.delta,
						changeFromQuantity: null
					}))
				}
			}
		);
		const errs = d.inventoryAdjustQuantities.userErrors;
		if (errs.length)
			throw new Error(`Shopify stock update: ${errs.map((e) => e.message).join('; ')}`);
	}
}

/** Set Shopify "cost per item" for many inventory items (25 per request, aliased). */
export async function pushCosts(items: { inventoryItemId: string; cost: number }[]) {
	const failed: string[] = [];
	for (let i = 0; i < items.length; i += 25) {
		const chunk = items.slice(i, i + 25);
		const body = chunk
			.map(
				(c, j) =>
					`m${j}: inventoryItemUpdate(id: "gid://shopify/InventoryItem/${c.inventoryItemId}", input: { cost: "${(c.cost / 100).toFixed(2)}" }) { userErrors { message } }`
			)
			.join('\n');
		const d = await shopifyGql<Record<string, { userErrors: { message: string }[] }>>(
			`mutation { ${body} }`
		);
		chunk.forEach((c, j) => {
			if (d[`m${j}`]?.userErrors.length) failed.push(c.inventoryItemId);
		});
	}
	return failed;
}

// ─── Land ──────────────────────────────────────────────────────────────────────

export async function landBatch(id: string, landedOn: string) {
	const b = await loadBatch(id);
	if (!b) throw new Error('Batch not found.');
	if (b.batch.status === 'landed') throw new Error('Already landed.');
	const retry = b.batch.status === 'landing';
	if (!b.lines.length) throw new Error('Add items first.');
	if (b.batch.currency !== 'PKR' && !b.batch.fxRateX10000)
		throw new Error('Enter the exchange rate.');
	if (b.lines.some((l) => l.qty <= 0)) throw new Error('Every item needs a quantity.');
	if (b.shipment.ddpPending)
		throw new Error('Transport pending — enter the billed box weight first.');
	if (!b.shipment.fixed && b.shipment.ddpTotal && b.shipment.itemsWithoutWeight)
		throw new Error(
			`${b.shipment.itemsWithoutWeight} items have no weight, so they would get no transport share. Enter their weights.`
		);

	const vars = await db
		.select()
		.from(v)
		.where(
			inArray(
				v.id,
				b.lines.map((l) => l.variantId)
			)
		);
	const byId = new Map(vars.map((x) => [x.id, x]));
	const missing = b.lines.filter((l) => !byId.get(l.variantId)?.inventoryItemId);
	if (missing.length)
		throw new Error(`${missing.length} items are not linked to Shopify — run a product sync.`);

	const { getSetting, setSetting } = await import('./settings.js');
	const snapKey = `landing:${id}`;
	if (!retry) {
		// Claim atomically: only one request can move draft/paid → landing.
		const claimed = await db
			.update(schema.importBatches)
			.set({ status: 'landing' })
			.where(
				and(
					eq(schema.importBatches.id, id),
					inArray(schema.importBatches.status, ['draft', 'paid'])
				)
			)
			.returning({ id: schema.importBatches.id });
		if (!claimed.length)
			throw new Error('This purchase is already being added — refresh the page.');
	}
	const locationId = await primaryLocation();
	// On-hand BEFORE this receipt. Saved on the first attempt; a retry must not re-read it
	// (Shopify may already include this batch's units).
	let snap = await getSetting<Record<string, number>>(snapKey);
	if (!snap) {
		try {
			snap = Object.fromEntries(
				await liveOnHand(
					vars.map((x) => x.inventoryItemId!),
					locationId
				)
			);
			await setSetting(snapKey, snap);
		} catch (e) {
			// Nothing pushed yet: release the claim so the user can simply try again.
			await db
				.update(schema.importBatches)
				.set({ status: b.batch.paidOn ? 'paid' : 'draft' })
				.where(eq(schema.importBatches.id, id));
			throw e;
		}
	}
	const onHand = new Map(Object.entries(snap));

	const at = new Date(`${landedOn}T12:00:00+05:00`).toISOString();
	const plan = b.lines.map((l) => {
		const x = byId.get(l.variantId)!;
		const have = Math.max(0, onHand.get(x.inventoryItemId!) ?? 0);
		// Unknown old cost → treat existing units as costing the same as this batch.
		const old = x.avgCost > 0 ? x.avgCost : l.landed;
		const newAvg = Math.round((have * old + l.qty * l.landed) / (have + l.qty));
		return { line: l, variant: x, have, newAvg };
	});

	// 1. Shopify first (idempotent key per batch → safe to retry if a later step fails).
	await pushReceipt(
		id,
		b.batch.ref,
		plan.map((p) => ({ inventoryItemId: p.variant.inventoryItemId!, delta: p.line.qty })),
		locationId
	);
	const costFailed = await pushCosts(
		plan.map((p) => ({ inventoryItemId: p.variant.inventoryItemId!, cost: p.newAvg }))
	);

	// 2. Local ledger.
	const now = new Date().toISOString();
	const stmts = [];
	for (const p of plan) {
		const x = p.variant;
		// Everything sold before this receipt keeps the old cost.
		stmts.push(
			db
				.update(schema.orderLines)
				.set({ costSnapshot: x.avgCost || null, costEstimated: x.costSource !== 'batch' })
				.where(and(eq(schema.orderLines.variantId, x.id), isNull(schema.orderLines.costSnapshot)))
		);
		stmts.push(
			db.insert(schema.stockMovements).values({
				variantId: x.id,
				at,
				qtyDelta: p.line.qty,
				type: 'receipt',
				unitCost: p.line.landed,
				reason: `Purchase ${b.batch.ref}`,
				refType: 'batch',
				refId: id
			}),
			db.insert(schema.costHistory).values({
				variantId: x.id,
				at,
				oldCost: x.avgCost,
				newCost: p.newAvg,
				reason: 'batch',
				refId: id
			}),
			db
				.update(v)
				.set({
					avgCost: p.newAvg,
					costSource: 'batch',
					shopifyCost: costFailed.includes(x.inventoryItemId!) ? x.shopifyCost : p.newAvg,
					shopifyOnHand: p.have + p.line.qty,
					updatedAt: now
				})
				.where(eq(v.id, x.id)),
			db
				.update(schema.batchItems)
				.set({ landedUnitCost: p.line.landed })
				.where(eq(schema.batchItems.id, p.line.id))
		);
	}
	stmts.push(
		db
			.update(schema.importBatches)
			.set({ status: 'landed', landedOn })
			.where(eq(schema.importBatches.id, id))
	);
	stmts.push(db.delete(schema.settings).where(eq(schema.settings.key, snapKey)));
	// One batch = one transaction: the ledger is never half-written.
	await db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
	return { items: plan.length, units: b.totals.units, costFailed: costFailed.length };
}

// ─── Shopify stock check (SPEC.md §5) ──────────────────────────────────────────

export const VARIANCE_REASONS = ['returned', 'damaged', 'missing', 'count', 'ignore'] as const;
export type VarianceReason = (typeof VARIANCE_REASONS)[number];
/** Reasons that cost money (go to "Inventory write-offs"). */
export const WRITE_OFF_REASONS: VarianceReason[] = ['damaged', 'missing', 'count'];

/**
 * Compare Shopify on-hand before/after a sync. Changes not explained by orders fulfilled
 * in (lastCheck, anchor] land in the stock-changes inbox (type "variance", reason null).
 * `anchor` = when the orders sync that preceded this started.
 */
export async function recordStockChanges(
	before: Map<string, number | null>,
	after: Map<string, number>,
	anchor: string
) {
	const { getSetting, setSetting } = await import('./settings.js');
	const last = await getSetting<string>('stock_checked_at');
	await setSetting('stock_checked_at', anchor);
	if (!last) return { baseline: true, changes: 0 };

	const shipped = (await db.all(sql`
		select l.variant_id as id, sum(l.qty) as qty
		from order_lines l join orders o on o.id = l.order_id
		where o.fulfilled_at > ${last} and o.fulfilled_at <= ${anchor}
			and o.cancelled_at is null and o.test = 0 and l.variant_id is not null
		group by l.variant_id`)) as { id: string; qty: number }[];
	const shippedBy = new Map(shipped.map((s) => [s.id, s.qty]));

	const vrows = await db.select({ id: v.id, avgCost: v.avgCost, status: v.status }).from(v);
	const costs = new Map(vrows.map((x) => [x.id, x.avgCost]));
	const inactive = new Set(vrows.filter((x) => x.status !== 'ACTIVE').map((x) => x.id));
	const rows = [];
	for (const [id, now] of after) {
		const was = before.get(id);
		if (was === undefined || was === null) continue; // new variant
		if (inactive.has(id)) continue; // draft/archived leftovers: not tracked
		const unexplained = now - was + (shippedBy.get(id) ?? 0);
		if (unexplained === 0) continue;
		rows.push({
			variantId: id,
			at: anchor,
			qtyDelta: unexplained,
			type: 'variance' as const,
			unitCost: costs.get(id) ?? 0,
			refType: 'shopify_check',
			refId: `${last}..${anchor}`
		});
	}
	for (let i = 0; i < rows.length; i += 100)
		await db.insert(schema.stockMovements).values(rows.slice(i, i + 100));
	return { baseline: false, changes: rows.length };
}

export async function classifyStockChanges(ids: string[], reason: VarianceReason) {
	if (!ids.length) return 0;
	const r = await db
		.update(schema.stockMovements)
		.set({ reason })
		.where(and(inArray(schema.stockMovements.id, ids), eq(schema.stockMovements.type, 'variance')))
		.returning({ id: schema.stockMovements.id });
	return r.length;
}

/** Value of goods out of the warehouse but not final yet, and paid purchases not arrived. */
export async function stockElsewhere() {
	const [withCourier] = (await db.all(sql`
		select coalesce(sum(l.qty * coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0)), 0) as value,
			coalesce(sum(l.qty), 0) as units
		from order_lines l
		left join variants v on v.id = l.variant_id
		where l.order_id in (
			select order_id from shipments
			where status in ('booked', 'in_transit') and order_id is not null and match_status != 'excluded'
		) and l.qty > 0`)) as { value: number; units: number }[];
	const paid = await db
		.select({ id: schema.importBatches.id })
		.from(schema.importBatches)
		.where(eq(schema.importBatches.status, 'paid'));
	let onTheWay = 0,
		onTheWayUnits = 0;
	for (const b of paid) {
		const x = await loadBatch(b.id);
		if (x) {
			onTheWay += x.totals.landed;
			onTheWayUnits += x.totals.units;
		}
	}
	return { withCourier, onTheWay: { value: onTheWay, units: onTheWayUnits } };
}
