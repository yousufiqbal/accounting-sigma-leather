import { error, json } from '@sveltejs/kit';
import { pushPrices } from '#lib/server/pricing.js';
import type { RequestHandler } from './$types';

/**
 * One batch of price changes → Shopify. The Pricing page sends batches one after another so it
 * can show progress (a long list in one request would also risk the server time limit).
 * Body: [{ id, price }] with price in paisa.
 */
export const POST: RequestHandler = async ({ request }) => {
	let changes: { id: string; price: number }[];
	try {
		changes = ((await request.json()) as { id: unknown; price: unknown }[]).map((c) => {
			const price = Number(c.price);
			if (!Number.isInteger(price) || price <= 0) throw new Error();
			return { id: String(c.id), price };
		});
	} catch {
		error(400, 'Prices must be numbers above 0.');
	}
	if (!changes.length || changes.length > 100) error(400, 'Send 1–100 changes per batch.');
	const r = await pushPrices(changes);
	return json({ doneIds: r.doneIds, failedIds: r.failedIds });
};

export const config = { maxDuration: 120 };
