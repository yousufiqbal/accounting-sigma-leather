import { SHOPIFY_ADMIN_TOKEN, SHOPIFY_STORE_DOMAIN } from '$app/env/private';

export const SHOPIFY_API_VERSION = '2026-10';

export function shopifyConfigured() {
	return !!(SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_TOKEN);
}

/** Admin GraphQL call. Throws on HTTP or GraphQL errors. */
export async function shopifyGql<T>(
	query: string,
	variables: Record<string, unknown> = {}
): Promise<T> {
	if (!shopifyConfigured()) throw new Error('Shopify is not configured');
	const res = await fetch(
		`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN!
			},
			body: JSON.stringify({ query, variables })
		}
	);
	if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
	const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
	if (body.errors?.length)
		throw new Error(`Shopify: ${body.errors.map((e) => e.message).join('; ')}`);
	return body.data as T;
}

/** "gid://shopify/ProductVariant/123" → "123" */
export const gidId = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1);
