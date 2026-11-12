import { STORE_NAME } from '$app/env/private';
import { getSetting, setSetting } from './settings.js';
import { shopifyConfigured, shopifyGql } from './shopify.js';

let cached: string | null = null;

/** Display name: STORE_NAME, else the Shopify shop name (fetched once, stored in settings). */
export async function storeName(): Promise<string> {
	if (STORE_NAME?.trim()) return STORE_NAME.trim();
	if (cached) return cached;
	cached = await getSetting<string>('shop_name');
	if (cached) return cached;
	if (!shopifyConfigured()) return 'Store';
	try {
		const d = await shopifyGql<{ shop: { name: string } }>(`{ shop { name } }`);
		cached = d.shop.name;
		await setSetting('shop_name', cached);
		return cached;
	} catch {
		return 'Store';
	}
}
