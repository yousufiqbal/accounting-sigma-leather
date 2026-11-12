import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { shopifyConfigured, shopifyGql } from '#lib/server/shopify.js';
import { postexConfigured, postexGet } from '#lib/server/postex.js';
import type { PageServerLoad } from './$types';

type Check = { name: string; ok: boolean; detail: string };

async function check(name: string, fn: () => Promise<string>): Promise<Check> {
	try {
		return { name, ok: true, detail: await fn() };
	} catch (e) {
		return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
	}
}

export const load: PageServerLoad = async () => {
	const checks = await Promise.all([
		check('Database (Turso)', async () => {
			const rows = await db.all<{ n: number }>(
				sql`select count(*) as n from sqlite_master where type = 'table'`
			);
			return `${rows[0]?.n ?? 0} tables`;
		}),
		check('Shopify', async () => {
			if (!shopifyConfigured()) throw new Error('Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN');
			const d = await shopifyGql<{ shop: { name: string; currencyCode: string } }>(
				`{ shop { name currencyCode } }`
			);
			return `${d.shop.name} (${d.shop.currencyCode})`;
		}),
		check('PostEx', async () => {
			if (!postexConfigured()) throw new Error('Set POSTEX_TOKEN');
			const cities = await postexGet<unknown[]>('v1/get-operational-city');
			return `Connected · ${cities.length} cities`;
		})
	]);
	return { checks };
};
