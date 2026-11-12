/**
 * Product cost (SPEC.md §2, §6).
 *
 * Every variant has one "cost used" (`avg_cost_paisa`) and where it came from (`cost_source`):
 *   batch      – weighted average from landed import batches (never touched by estimates)
 *   estimated  – China price × yuan rate + kg × DDP rate/kg (PKR price: used as-is, no DDP)
 *   shopify    – owner ticked "Shopify cost is correct"
 *   none       – nothing known yet
 * Estimate wins over a trusted Shopify cost when both exist (owner typed it on purpose).
 *
 * Order lines sold before the first batch keep `cost_estimated = true` snapshots that follow
 * the estimate, so fixing a China price later also fixes past months' COGS.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { getSetting, setSetting } from './settings.js';

const v = schema.variants;

export type CostRates = {
	/** DDP cargo, paisa per kg. */
	ddpPerKg: number;
	/** PKR per 1 yuan × 10,000 (e.g. 39.5 → 395000). */
	rmbFx: number;
};

export async function getRates(): Promise<CostRates> {
	return (await getSetting<CostRates>('cost_rates')) ?? { ddpPerKg: 0, rmbFx: 0 };
}

export async function setRates(r: CostRates) {
	await setSetting('cost_rates', r);
	return recomputeCosts();
}

/** Yuan fen (or PKR paisa) → paisa. */
export function goodsCost(priceMinor: number, currency: 'RMB' | 'PKR' | 'USD', fxX10000: number) {
	return currency === 'PKR' ? priceMinor : Math.round((priceMinor * fxX10000) / 10_000);
}

export function ddpCost(weightG: number | null, ddpPerKg: number) {
	return Math.round(((weightG ?? 0) * ddpPerKg) / 1000);
}

/** DDP per piece: override if set (0 = local), else weight × rate; PKR (local) prices default to 0. */
export function estDdp(
	row: { estCurrency: 'RMB' | 'PKR' | null; weightG: number | null; estDdp: number | null },
	r: CostRates
) {
	if (row.estDdp !== null) return row.estDdp;
	return (row.estCurrency ?? 'RMB') === 'PKR' ? 0 : ddpCost(row.weightG, r.ddpPerKg);
}

export function estimate(
	row: {
		estCnPriceMinor: number | null;
		estCurrency: 'RMB' | 'PKR' | null;
		weightG: number | null;
		estDdp: number | null;
	},
	r: CostRates
): number | null {
	if (row.estCnPriceMinor === null) return null;
	const cur = row.estCurrency ?? 'RMB';
	if (cur === 'PKR') return row.estCnPriceMinor + estDdp(row, r);
	if (!r.rmbFx) return null;
	return goodsCost(row.estCnPriceMinor, cur, r.rmbFx) + estDdp(row, r);
}

/** Cost before any batch: estimate, else trusted Shopify cost. */
export function baseCost(
	row: Parameters<typeof estimate>[0] & { shopifyCost: number | null; shopifyCostOk: boolean },
	r: CostRates
): { cost: number; source: 'estimated' | 'shopify' | 'none'; est: number | null } {
	const est = estimate(row, r);
	if (est !== null) return { cost: est, source: 'estimated', est };
	if (row.shopifyCostOk && row.shopifyCost) return { cost: row.shopifyCost, source: 'shopify', est };
	return { cost: 0, source: 'none', est };
}

/**
 * Recompute estimates + cost used for all (or some) variants, and re-price
 * pre-batch order-line snapshots. Returns how many variants changed.
 */
export async function recomputeCosts(ids?: string[]) {
	const r = await getRates();
	const rows = await db
		.select({
			id: v.id,
			estCnPriceMinor: v.estCnPriceMinor,
			estCurrency: v.estCurrency,
			weightG: v.weightG,
			estDdp: v.estDdp,
			shopifyCost: v.shopifyCost,
			shopifyCostOk: v.shopifyCostOk,
			estCost: v.estCost,
			avgCost: v.avgCost,
			costSource: v.costSource
		})
		.from(v)
		.where(ids ? inArray(v.id, ids) : undefined);

	const now = new Date().toISOString();
	const stmts = [];
	let changed = 0;
	for (const row of rows) {
		const b = baseCost(row, r);
		const isBatch = row.costSource === 'batch';
		const avgCost = isBatch ? row.avgCost : b.cost;
		const costSource = isBatch ? 'batch' : b.source;
		if (row.estCost === b.est && row.avgCost === avgCost && row.costSource === costSource) continue;
		changed++;
		stmts.push(
			db.update(v).set({ estCost: b.est, avgCost, costSource, updatedAt: now }).where(eq(v.id, row.id))
		);
		if (!isBatch && row.avgCost !== avgCost) {
			stmts.push(
				db.insert(schema.costHistory).values({
					variantId: row.id,
					at: now,
					oldCost: row.avgCost,
					newCost: avgCost,
					reason: 'opening'
				})
			);
		}
		// Lines frozen while this variant was still on an estimate follow the estimate.
		stmts.push(
			db
				.update(schema.orderLines)
				.set({ costSnapshot: b.cost || null })
				.where(and(eq(schema.orderLines.variantId, row.id), eq(schema.orderLines.costEstimated, true)))
		);
	}
	for (let i = 0; i < stmts.length; i += 100) {
		const chunk = stmts.slice(i, i + 100);
		await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
	}
	return { changed };
}

/** Save China prices / currency / "Shopify cost is correct" for many variants at once. */
export async function saveCostInputs(
	inputs: {
		id: string;
		priceMinor: number | null;
		currency: 'RMB' | 'PKR';
		shopifyCostOk: boolean;
		/** DDP per piece override; null = automatic; undefined = leave as is. */
		ddp?: number | null;
	}[]
) {
	const now = new Date().toISOString();
	const stmts = inputs.map((i) =>
		db
			.update(v)
			.set({
				estCnPriceMinor: i.priceMinor,
				estCurrency: i.priceMinor === null ? null : i.currency,
				shopifyCostOk: i.shopifyCostOk,
				...(i.ddp !== undefined ? { estDdp: i.ddp } : {}),
				updatedAt: now
			})
			.where(eq(v.id, i.id))
	);
	for (let i = 0; i < stmts.length; i += 100) {
		const chunk = stmts.slice(i, i + 100);
		await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
	}
	return recomputeCosts(inputs.map((i) => i.id));
}

/** Stock value summary from Shopify on-hand × cost used (active products only). */
export async function stockSummary() {
	const [s] = await db
		.select({
			units: sql<number>`coalesce(sum(case when ${v.shopifyOnHand} > 0 then ${v.shopifyOnHand} else 0 end), 0)`,
			value: sql<number>`coalesce(sum(case when ${v.shopifyOnHand} > 0 then ${v.shopifyOnHand} * ${v.avgCost} else 0 end), 0)`,
			estimatedValue: sql<number>`coalesce(sum(case when ${v.shopifyOnHand} > 0 and ${v.costSource} != 'batch' then ${v.shopifyOnHand} * ${v.avgCost} else 0 end), 0)`,
			missing: sql<number>`coalesce(sum(case when ${v.shopifyOnHand} > 0 and ${v.avgCost} = 0 then 1 else 0 end), 0)`,
			missingUnits: sql<number>`coalesce(sum(case when ${v.shopifyOnHand} > 0 and ${v.avgCost} = 0 then ${v.shopifyOnHand} else 0 end), 0)`,
			noWeight: sql<number>`coalesce(sum(case when ${v.status} = 'ACTIVE' and coalesce(${v.weightG}, 0) = 0 then 1 else 0 end), 0)`
		})
		.from(v)
		.where(eq(v.status, 'ACTIVE')); // draft/archived = leftovers, not valued
	return s;
}

/**
 * Set product weights (grams) in Shopify, then locally, then recompute those costs.
 * Shopify stays the single source of truth for weight (store shipping + dispatcher use it).
 */
export async function pushWeights(items: { id: string; weightG: number }[]) {
	if (!items.length) return { done: 0, failed: 0 };
	const { shopifyGql } = await import('./shopify.js');
	const rows = await db
		.select({ id: v.id, inv: v.inventoryItemId })
		.from(v)
		.where(inArray(v.id, items.map((i) => i.id)));
	const invOf = new Map(rows.map((r) => [r.id, r.inv]));
	const ok: { id: string; weightG: number }[] = [];
	let failed = 0;
	for (let i = 0; i < items.length; i += 25) {
		const chunk = items.slice(i, i + 25).filter((x) => invOf.get(x.id));
		failed += items.slice(i, i + 25).length - chunk.length;
		if (!chunk.length) continue;
		const body = chunk
			.map(
				(c, j) =>
					`m${j}: inventoryItemUpdate(id: "gid://shopify/InventoryItem/${invOf.get(c.id)}", input: { measurement: { weight: { unit: GRAMS, value: ${Math.max(0, Math.round(c.weightG))} } } }) { userErrors { message } }`
			)
			.join('\n');
		const d = await shopifyGql<Record<string, { userErrors: { message: string }[] }>>(`mutation { ${body} }`).catch(
			() => null
		);
		chunk.forEach((c, j) => {
			if (d && !d[`m${j}`]?.userErrors.length) ok.push(c);
			else failed++;
		});
	}
	const now = new Date().toISOString();
	for (let i = 0; i < ok.length; i += 100) {
		const stmts = ok
			.slice(i, i + 100)
			.map((c) => db.update(v).set({ weightG: Math.round(c.weightG), updatedAt: now }).where(eq(v.id, c.id)));
		await db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
	}
	if (ok.length) await recomputeCosts(ok.map((c) => c.id));
	return { done: ok.length, failed };
}
