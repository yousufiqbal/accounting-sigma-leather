import { error, json } from '@sveltejs/kit';
import { syncStock } from '#lib/server/shopify-sync.js';
import { syncPostex } from '#lib/server/couriers/sync-postex.js';
import { postexConfigured } from '#lib/server/postex.js';
import { setSetting } from '#lib/server/settings.js';
import type { RequestHandler } from './$types';

export type SyncStepResult = { ok: boolean; text: string; again?: boolean; review?: number };

/**
 * One sync step per request (keeps each under Vercel's time limit and lets the UI show progress).
 *   shopify: recent orders → products + stock check → delivery settling → cost refresh
 *   postex:  parcel statuses, fees, CPR payments → delivery settling
 * `mode=full` re-reads all history (Settings page).
 */
export const POST: RequestHandler = async ({ url }) => {
	const step = url.searchParams.get('step');
	const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'recent';
	let res: SyncStepResult;
	try {
		if (step === 'shopify') {
			const r = await syncStock(mode);
			res = {
				ok: true,
				text:
					`${r.orders} orders · ${r.variants} products` +
					(r.assumedDelivered ? ` · ${r.assumedDelivered} untracked counted delivered` : '') +
					(r.stockChanges ? ` · ${r.stockChanges} stock changes to review` : ''),
				review: r.stockChanges
			};
		} else if (step === 'postex') {
			if (!postexConfigured()) res = { ok: true, text: 'Not connected — skipped' };
			else {
				const r = await syncPostex(mode);
				res = {
					ok: true,
					text:
						`${r.fetched} parcels checked · ${r.new} new · ${r.updated} updated` +
						(r.cprLinked ? ` · ${r.cprLinked} linked to payments` : '') +
						(r.cprPending ? ` · ${r.cprPending} payment checks left for next sync` : ''),
					again: r.cprPending > 0
				};
			}
		} else error(400, 'Unknown step');
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		res = { ok: false, text: e instanceof Error ? e.message : String(e) };
	}
	if (step === 'postex') await setSetting('sync:last', new Date().toISOString());
	return json(res);
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
