/**
 * Shopify Admin API client.
 *
 * Auth: Dev Dashboard app using the client credentials grant
 * (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET → 24h access token, refreshed automatically).
 * Fallback: a legacy admin-created app token (SHOPIFY_ADMIN_TOKEN, "shpat_…").
 * https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
 */
import { eq } from 'drizzle-orm';
import {
	SHOPIFY_ADMIN_TOKEN,
	SHOPIFY_CLIENT_ID,
	SHOPIFY_CLIENT_SECRET,
	SHOPIFY_STORE_DOMAIN
} from '$app/env/private';
import { db, schema } from './db/index.js';

export const SHOPIFY_API_VERSION = '2026-10';
const TOKEN_KEY = 'shopify_access_token';
const REFRESH_MARGIN_MS = 30 * 60 * 1000; // refresh 30 min before expiry

type CachedToken = { token: string; expiresAt: number };
let memoryToken: CachedToken | null = null;

export function shopifyConfigured() {
	return !!(
		SHOPIFY_STORE_DOMAIN &&
		(SHOPIFY_ADMIN_TOKEN || (SHOPIFY_CLIENT_ID && SHOPIFY_CLIENT_SECRET))
	);
}

const fresh = (t: CachedToken | null): t is CachedToken =>
	!!t && t.expiresAt - REFRESH_MARGIN_MS > Date.now();

async function requestToken(): Promise<CachedToken> {
	const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: SHOPIFY_CLIENT_ID!,
			client_secret: SHOPIFY_CLIENT_SECRET!
		})
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`Shopify token HTTP ${res.status}: ${text.slice(0, 300)}`);
	const body = JSON.parse(text) as { access_token: string; expires_in: number };
	return { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

/** Memory → DB cache (survives serverless cold starts) → new token. */
async function getAccessToken(): Promise<string> {
	if (SHOPIFY_ADMIN_TOKEN) return SHOPIFY_ADMIN_TOKEN;
	if (fresh(memoryToken)) return memoryToken.token;

	const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, TOKEN_KEY) });
	const stored = row ? (JSON.parse(row.value) as CachedToken) : null;
	if (fresh(stored)) return (memoryToken = stored).token;

	memoryToken = await requestToken();
	const value = JSON.stringify(memoryToken);
	await db
		.insert(schema.settings)
		.values({ key: TOKEN_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value } });
	return memoryToken.token;
}

/** Admin GraphQL call. Throws on HTTP or GraphQL errors. */
export async function shopifyGql<T>(
	query: string,
	variables: Record<string, unknown> = {}
): Promise<T> {
	if (!shopifyConfigured()) throw new Error('Shopify is not configured');
	const token = await getAccessToken();
	const res = await fetch(
		`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
			body: JSON.stringify({ query, variables })
		}
	);
	if (res.status === 401) memoryToken = null; // force refresh next time
	if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
	const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
	if (body.errors?.length)
		throw new Error(`Shopify: ${body.errors.map((e) => e.message).join('; ')}`);
	return body.data as T;
}

/** "gid://shopify/ProductVariant/123" → "123" */
export const gidId = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1);
