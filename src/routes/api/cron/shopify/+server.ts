import { error, json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '$app/env/private';
import { syncOrders, syncVariants } from '#lib/server/shopify-sync.js';
import type { RequestHandler } from './$types';

/** Vercel cron: refresh product variants and recently updated orders. */
export const GET: RequestHandler = async ({ request }) => {
	const given = Buffer.from(request.headers.get('authorization') ?? '');
	const expected = Buffer.from(`Bearer ${CRON_SECRET ?? ''}`);
	if (!CRON_SECRET || given.length !== expected.length || !timingSafeEqual(given, expected))
		error(401, 'Unauthorized');
	const variants = await syncVariants();
	const orders = await syncOrders('recent');
	return json({ ...variants, ...orders });
};
