import { POSTEX_TOKEN } from '$app/env/private';

const BASE = 'https://api.postex.pk/services/integration/api/order';

export function postexConfigured() {
	return !!POSTEX_TOKEN;
}

type PostexEnvelope<T> = { statusCode: string; statusMessage: string; dist: T };

export async function postexGet<T>(path: string): Promise<T> {
	if (!POSTEX_TOKEN) throw new Error('PostEx is not configured');
	const res = await fetch(`${BASE}/${path}`, { headers: { token: POSTEX_TOKEN } });
	if (!res.ok) throw new Error(`PostEx HTTP ${res.status}`);
	const body = (await res.json()) as PostexEnvelope<T> | T;
	// Some endpoints (e.g. get-operational-city) return a bare array, others an envelope.
	if (Array.isArray(body)) return body as T;
	const env = body as PostexEnvelope<T>;
	if (env.statusCode !== '200') throw new Error(`PostEx: ${env.statusMessage}`);
	return env.dist;
}
