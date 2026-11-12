import { error, json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { estDdp, getRates, goodsCost } from '#lib/server/costing.js';
import type { RequestHandler } from './$types';

/** How a variant's cost is built: estimate breakdown, purchases, cost history. */
export const GET: RequestHandler = async ({ params }) => {
	const v = await db.query.variants.findFirst({ where: eq(schema.variants.id, params.id) });
	if (!v) error(404, 'Product not found');
	const rates = await getRates();

	const estimate =
		v.estCnPriceMinor !== null
			? {
					price: v.estCnPriceMinor,
					currency: v.estCurrency ?? 'RMB',
					fx: rates.rmbFx,
					goods: goodsCost(v.estCnPriceMinor, v.estCurrency ?? 'RMB', rates.rmbFx),
					weightG: v.weightG,
					ddpPerKg: rates.ddpPerKg,
					ddp: estDdp(v, rates),
					ddpOverride: v.estDdp !== null,
					total: v.estCost
				}
			: null;

	const purchases = await db
		.select({
			ref: schema.importBatches.ref,
			id: schema.importBatches.id,
			landedOn: schema.importBatches.landedOn,
			qty: schema.batchItems.qty,
			landed: schema.batchItems.landedUnitCost
		})
		.from(schema.batchItems)
		.innerJoin(schema.importBatches, eq(schema.importBatches.id, schema.batchItems.batchId))
		.where(eq(schema.batchItems.variantId, v.id))
		.orderBy(desc(schema.importBatches.landedOn));

	const history = await db
		.select({
			at: schema.costHistory.at,
			oldCost: schema.costHistory.oldCost,
			newCost: schema.costHistory.newCost,
			reason: schema.costHistory.reason
		})
		.from(schema.costHistory)
		.where(eq(schema.costHistory.variantId, v.id))
		.orderBy(desc(schema.costHistory.at))
		.limit(15);

	return json({
		id: v.id,
		title: v.productTitle,
		variant: v.variantTitle,
		sku: v.sku,
		imageUrl: v.imageUrl,
		cost: v.avgCost,
		source: v.costSource,
		shopifyCost: v.shopifyCost,
		shopifyCostOk: v.shopifyCostOk,
		onHand: v.shopifyOnHand,
		estimate,
		purchases: purchases.filter((p) => p.landedOn),
		history
	});
};
