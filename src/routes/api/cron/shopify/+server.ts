import { error, json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '$app/env/private';
import { syncStock } from '#lib/server/shopify-sync.js';
import type { RequestHandler } from './$types';

/** Vercel cron: recently updated orders, then variants + Shopify stock check. */
export const GET: RequestHandler = async ({ request }) => {
	const given = Buffer.from(request.headers.get('authorization') ?? '');
	const expected = Buffer.from(`Bearer ${CRON_SECRET ?? ''}`);
	if (!CRON_SECRET || given.length !== expected.length || !timingSafeEqual(given, expected))
		error(401, 'Unauthorized');
	return json(await syncStock('recent'));
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
