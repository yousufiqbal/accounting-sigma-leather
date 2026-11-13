/**
 * "Sync all": runs each sync step as its own request, so the UI can show progress and no single
 * request hits the server time limit. Shared by the top-bar button and the Settings page.
 */
import { invalidateAll } from '$app/navigation';
import { toast } from 'svelte-sonner';

export type StepState = {
	id: 'shopify' | 'postex';
	label: string;
	status: 'waiting' | 'running' | 'done' | 'failed';
	text: string;
};

const STEPS: Pick<StepState, 'id' | 'label'>[] = [
	{ id: 'shopify', label: 'Shopify orders, products & stock' },
	{ id: 'postex', label: 'PostEx parcels & payments' }
];

class SyncRunner {
	running = $state(false);
	mode = $state<'recent' | 'full'>('recent');
	steps = $state<StepState[]>([]);
	finishedAt = $state<string | null>(null);

	async run(mode: 'recent' | 'full' = 'recent', opts: { quiet?: boolean } = {}) {
		if (this.running) return;
		this.running = true;
		this.mode = mode;
		this.steps = STEPS.map((s) => ({ ...s, status: 'waiting', text: '' }));
		let review = 0;
		for (const step of this.steps) {
			step.status = 'running';
			try {
				// PostEx payment linking may need a few rounds.
				for (let round = 0; round < 3; round++) {
					const r = await fetch(`/sync?step=${step.id}&mode=${mode}`, { method: 'POST' });
					if (!r.ok) throw new Error(r.status === 401 ? 'Logged out' : `HTTP ${r.status}`);
					const res = (await r.json()) as {
						ok: boolean;
						text: string;
						again?: boolean;
						review?: number;
					};
					step.status = res.ok ? 'done' : 'failed';
					step.text = res.text;
					review += res.review ?? 0;
					if (!res.ok || !res.again) break;
				}
			} catch (e) {
				step.status = 'failed';
				step.text = e instanceof Error ? e.message : String(e);
			}
		}
		this.running = false;
		this.finishedAt = new Date().toISOString();
		// A quiet (auto) sync doesn't reload the page, so it can't wipe a form being typed in;
		// the next page opened gets fresh data.
		if (!opts.quiet) await invalidateAll();
		const failed = this.steps.filter((s) => s.status === 'failed');
		if (failed.length)
			toast.error(`Sync failed: ${failed.map((s) => `${s.label} — ${s.text}`).join('; ')}`);
		else if (!opts.quiet) toast.success('Everything synced');
		else if (review) toast.info(`Synced · ${review} stock changes to review on Inventory`);
	}
}

export const sync = new SyncRunner();
