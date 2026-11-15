import { json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { getSession } from '#lib/server/restock.js';
import type { RequestHandler } from './$types';

const ri = schema.restockItems;

/** Jump menu: one entry per product, done = any of its variants has a quantity. */
export const GET: RequestHandler = async ({ params }) => {
	await getSession(params.sessionId);
	const rows = await db
		.select({
			index: ri.position,
			title: sql<string>`min(${ri.productTitle})`,
			done: sql<number>`max(case when ${ri.actualRestock} is not null then 1 else 0 end)`
		})
		.from(ri)
		.where(eq(ri.sessionId, params.sessionId))
		.groupBy(ri.position)
		.orderBy(asc(ri.position));
	return json({ products: rows.map((r) => ({ ...r, done: !!r.done })) });
};
