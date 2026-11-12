import { sql } from 'drizzle-orm';
import { ADMIN_EMAIL } from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { currentMonth, isMonth } from '#lib/month.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url }) => {
	const m = url.searchParams.get('m');
	// Sidebar attention counters (cheap counts).
	const [counts] = (await db.all(sql`
		select
			(select count(*) from shipments
				where conflict_note is not null
					or (order_id is null and match_status = 'unmatched' and status != 'cancelled')) as couriers,
			(select count(*) from stock_movements where type = 'variance' and reason is null) as inventory`)) as {
		couriers: number;
		inventory: number;
	}[];
	return {
		month: isMonth(m) ? m : currentMonth(),
		email: ADMIN_EMAIL,
		attention: counts
	};
};
