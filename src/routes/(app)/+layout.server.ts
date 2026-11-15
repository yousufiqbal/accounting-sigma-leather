import { sql } from 'drizzle-orm';
import { ADMIN_EMAIL } from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { monthFromUrl } from '#lib/month.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url }) => {
	// Sidebar attention counters + sync status (cheap).
	const [counts] = (await db.all(sql`
		select
			(select count(*) from shipments
				where conflict_note is not null
					or (order_id is null and match_status = 'unmatched' and status != 'cancelled')) as couriers,
			(select count(*) from stock_movements where type = 'variance' and reason is null) as inventory,
			(select json_extract(value, '$') from settings where key = 'sync:last') as lastSync,
			(select max(created_at) from import_files where courier = 'dex') as lastDex`)) as {
		couriers: number;
		inventory: number;
		lastSync: string | null;
		lastDex: string | null;
	}[];
	return {
		month: monthFromUrl(url),
		email: ADMIN_EMAIL,
		attention: { couriers: counts.couriers, inventory: counts.inventory },
		sync: { last: counts.lastSync, lastDex: counts.lastDex }
	};
};
