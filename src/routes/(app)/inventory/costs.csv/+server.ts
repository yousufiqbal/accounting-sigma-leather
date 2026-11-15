import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

const v = schema.variants;
const cell = (x: unknown) => {
	const s = x === null || x === undefined ? '' : String(x);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rs = (paisa: number | null) => (paisa === null ? '' : (paisa / 100).toFixed(2));

/** Sheet for bulk-filling buying prices and weights. Re-upload it on Opening costs. */
export const GET: RequestHandler = async () => {
	const rows = await db
		.select()
		.from(v)
		.where(and(eq(v.status, 'ACTIVE'), eq(v.isBundle, false)))
		.orderBy(
			desc(sql`max(coalesce(${v.shopifyOnHand}, 0), 0)`),
			asc(v.productTitle),
			asc(v.variantTitle)
		);
	const head = [
		'variant_id',
		'product',
		'variant',
		'sku',
		'status',
		'on_hand',
		'weight_g',
		'shopify_cost',
		'shopify_cost_correct',
		'buying_price',
		'currency',
		'transport_per_piece',
		'cost_used'
	];
	const lines = rows.map((r) =>
		[
			r.id,
			r.productTitle,
			r.variantTitle ?? '',
			r.sku ?? '',
			r.status ?? '',
			r.shopifyOnHand ?? 0,
			r.weightG ?? '',
			rs(r.shopifyCost),
			r.shopifyCostOk ? 'yes' : 'no',
			rs(r.estCnPriceMinor),
			r.estCurrency ?? 'RMB',
			rs(r.estDdp),
			rs(r.avgCost)
		]
			.map(cell)
			.join(',')
	);
	const body = '﻿' + [head.join(','), ...lines].join('\r\n');
	const date = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="product-costs-${date}.csv"`
		}
	});
};
