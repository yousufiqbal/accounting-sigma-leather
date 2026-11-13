<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Circle from '@lucide/svelte/icons/circle';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { sync } from '#lib/sync.svelte.js';

	let { last, lastDex }: { last: string | null; lastDex: string | null } = $props();

	const AUTO_AFTER_MS = 30 * 60_000;
	const DEX_STALE_DAYS = 7;

	let open = $state(false);
	let root = $state<HTMLDivElement>();
	let now = $state(Date.now());

	// Auto-sync once when the panel is opened, if the last sync is old.
	let autoChecked = false;
	$effect(() => {
		if (autoChecked) return;
		autoChecked = true;
		if (!last || Date.now() - Date.parse(last) > AUTO_AFTER_MS) sync.run('recent', { quiet: true });
	});
	// Keep the "x min ago" label fresh.
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	function ago(iso: string | null) {
		if (!iso) return 'never';
		const min = Math.round((now - Date.parse(iso)) / 60_000);
		if (min < 1) return 'just now';
		if (min < 60) return `${min} min ago`;
		const h = Math.round(min / 60);
		if (h < 48) return `${h}h ago`;
		return `${Math.round(h / 24)} days ago`;
	}
	const dexDays = $derived(lastDex ? Math.floor((now - Date.parse(lastDex)) / 86_400_000) : null);
	const dexStale = $derived(dexDays === null || dexDays >= DEX_STALE_DAYS);
	const failed = $derived(!sync.running && sync.steps.some((s) => s.status === 'failed'));
</script>

<svelte:window
	onclick={(e) => {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
/>

<div class="relative" bind:this={root}>
	<Button
		variant="ghost"
		size="sm"
		class="gap-2 text-muted-foreground"
		onclick={() => {
			open = true;
			if (!sync.running) sync.run('recent');
		}}
		title="Sync Shopify and PostEx now"
	>
		<RefreshCw class={sync.running ? 'animate-spin' : ''} />
		<span class="hidden sm:inline">
			{#if sync.running}Syncing…{:else}Synced {ago(sync.finishedAt ?? last)}{/if}
		</span>
		{#if failed}<TriangleAlert class="text-danger" />{:else if dexStale}<span
				class="size-1.5 rounded-full bg-warning"
				title="DEX file not imported recently"
			></span>{/if}
	</Button>

	{#if open}
		<div
			class="absolute top-full right-0 z-30 mt-2 w-80 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
		>
			<div class="mb-2 flex items-center justify-between">
				<span class="font-medium">{sync.mode === 'full' ? 'Full history sync' : 'Sync all'}</span>
				<span class="text-xs text-muted-foreground"
					>{sync.running ? 'running' : ago(sync.finishedAt ?? last)}</span
				>
			</div>
			<ul class="grid gap-2">
				{#each sync.steps as s (s.id)}
					<li class="flex gap-2">
						<span class="mt-0.5 shrink-0">
							{#if s.status === 'running'}<LoaderCircle class="size-4 animate-spin text-primary" />
							{:else if s.status === 'done'}<Check class="size-4 text-success" />
							{:else if s.status === 'failed'}<X class="size-4 text-danger" />
							{:else}<Circle class="size-4 text-muted-foreground/40" />{/if}
						</span>
						<div class="grid">
							<span>{s.label}</span>
							{#if s.text}<span
									class={[
										'text-xs',
										s.status === 'failed' ? 'text-danger' : 'text-muted-foreground'
									]}>{s.text}</span
								>{/if}
						</div>
					</li>
				{:else}
					<li class="text-muted-foreground">
						Shopify and PostEx sync on their own when you open the panel.
					</li>
				{/each}
			</ul>
			{#if dexStale}
				<a
					href="/couriers"
					onclick={() => (open = false)}
					class="mt-3 flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning hover:underline"
				>
					<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
					{dexDays === null
						? 'No DEX file imported yet. DEX has no live connection — import its statement on Couriers.'
						: `DEX file last imported ${dexDays} days ago — import the latest statement on Couriers.`}
				</a>
			{/if}
		</div>
	{/if}
</div>
