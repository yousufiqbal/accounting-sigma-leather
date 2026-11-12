import { error, json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '$app/env/private';
import { syncPostex } from '#lib/server/couriers/sync-postex.js';
import type { RequestHandler } from './$types';

/** Vercel cron calls this with `Authorization: Bearer <CRON_SECRET>`. */
export const GET: RequestHandler = async ({ request }) => {
	const given = Buffer.from(request.headers.get('authorization') ?? '');
	const expected = Buffer.from(`Bearer ${CRON_SECRET ?? ''}`);
	if (!CRON_SECRET || given.length !== expected.length || !timingSafeEqual(given, expected))
		error(401, 'Unauthorized');
	return json(await syncPostex('recent'));
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
