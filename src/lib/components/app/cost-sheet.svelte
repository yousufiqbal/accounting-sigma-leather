<script lang="ts">
	/** Cost details for one product variant (how its cost is built). Open with `show(variantId)`. */
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import Thumb from '#lib/components/app/thumb.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import { COST_SOURCE as SOURCE } from '#lib/cost-source.js';

	type Details = {
		id: string;
		title: string;
		variant: string | null;
		sku: string | null;
		imageUrl: string | null;
		cost: number;
		source: string;
		shopifyCost: number | null;
		shopifyCostOk: boolean;
		onHand: number | null;
		estimate: null | {
			price: number;
			currency: string;
			fx: number;
			goods: number;
			weightG: number | null;
			ddpPerKg: number;
			ddp: number;
			ddpOverride: boolean;
			total: number | null;
		};
		purchases: { ref: string; id: string; landedOn: string; qty: number; landed: number }[];
		history: { at: string; oldCost: number; newCost: number; reason: string }[];
	};
	let detailsOpen = $state(false);
	let details = $state<Details | null>(null);
	let loadingDetails = $state(false);
	/** Open the sheet for one variant. */
	export async function show(id: string) {
		detailsOpen = true;
		details = null;
		loadingDetails = true;
		try {
			const res = await fetch(`/inventory/cost/${id}`);
			details = res.ok ? await res.json() : null;
		} finally {
			loadingDetails = false;
		}
	}
	const fmtDay = (d: string) =>
		new Date(d.length === 10 ? `${d}T12:00:00+05:00` : d).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			timeZone: 'Asia/Karachi'
		});
</script>

<Sheet.Root bind:open={detailsOpen}>
	<Sheet.Content side="right" class="w-full sm:max-w-md!">
		<Sheet.Header>
			<Sheet.Title>Cost details</Sheet.Title>
			<Sheet.Description>How this product's cost is built.</Sheet.Description>
		</Sheet.Header>
		<div class="grid gap-5 overflow-auto px-4 pb-6 text-sm">
			{#if loadingDetails}
				<div class="flex items-center gap-2 text-muted-foreground">
					<LoaderCircle class="size-4 animate-spin" /> Loading…
				</div>
			{:else if details}
				{@const d = details}
				<div class="flex items-center gap-3">
					<Thumb src={d.imageUrl} alt={`${d.title} ${d.variant ?? ''}`} size={48} />
					<div class="min-w-0">
						<div class="font-medium">{d.title}</div>
						<div class="text-xs text-muted-foreground">
							{d.variant ?? ''}{d.variant && d.sku ? ' · ' : ''}{d.sku ?? ''} · {d.onHand ?? 0} on hand
						</div>
					</div>
				</div>
				<div class="flex items-baseline justify-between rounded-lg bg-muted/60 px-3 py-2">
					<span>Cost used</span>
					<span class="flex items-center gap-2">
						<b class="num text-base">{formatRs(d.cost, { decimals: true })}</b>
						<StatusBadge tone={SOURCE[d.source].tone} label={SOURCE[d.source].label} />
					</span>
				</div>

				{#if d.purchases.length}
					<div class="grid gap-1.5">
						<p class="font-medium">
							From purchases <span class="font-normal text-muted-foreground"
								>(weighted average)</span
							>
						</p>
						{#each d.purchases as p (p.id)}
							<a
								href="/purchases/{p.id}"
								class="flex justify-between rounded px-2 py-1 hover:bg-accent"
							>
								<span>{p.ref} · {fmtDay(p.landedOn)}</span>
								<span class="num">{p.qty} × {formatRs(p.landed, { decimals: true })}</span>
							</a>
						{/each}
					</div>
				{/if}

				{#if d.estimate}
					{@const e = d.estimate}
					<div class="grid gap-1.5">
						<p class="font-medium">
							Estimate {#if d.source === 'batch'}<span class="font-normal text-muted-foreground"
									>(used before the first purchase)</span
								>{/if}
						</p>
						<div class="grid gap-1 rounded-lg border p-3">
							<div class="flex justify-between gap-3">
								<span class="text-muted-foreground">
									Goods: {e.currency === 'PKR'
										? `Rs ${e.price / 100}`
										: `¥${e.price / 100} × Rs ${e.fx / 10_000}`}
								</span>
								<span class="num">{formatRs(e.goods, { decimals: true })}</span>
							</div>
							<div class="flex justify-between gap-3">
								<span class="text-muted-foreground">
									DDP: {#if e.ddpOverride}{e.ddp === 0
											? 'local, none'
											: 'set by hand'}{:else if e.currency === 'PKR'}local, none{:else}{e.weightG ??
											0} g × Rs {(e.ddpPerKg / 100).toLocaleString('en-PK')}/kg{/if}
								</span>
								<span class="num">{formatRs(e.ddp, { decimals: true })}</span>
							</div>
							<div class="flex justify-between border-t pt-1 font-medium">
								<span>Estimated cost</span><span class="num"
									>{formatRs(e.total ?? 0, { decimals: true })}</span
								>
							</div>
						</div>
					</div>
				{:else if d.source === 'shopify'}
					<p class="text-muted-foreground">
						Using the Shopify “cost per item” ({formatRs(d.shopifyCost ?? 0)}), marked as correct.
					</p>
				{:else if d.source === 'none'}
					<p class="text-danger">No cost yet — add the buying price on Opening costs.</p>
				{/if}

				{#if d.source !== 'batch'}
					<Button
						variant="outline"
						href="/inventory/opening?view=all&q={encodeURIComponent(d.sku ?? d.title)}"
						>Edit on Opening costs</Button
					>
				{/if}

				{#if d.history.length}
					<div class="grid gap-1">
						<p class="font-medium">History</p>
						{#each d.history as h, i (i)}
							<div class="flex justify-between text-xs text-muted-foreground">
								<span
									>{fmtDay(h.at)} · {h.reason === 'batch'
										? 'purchase'
										: h.reason === 'opening'
											? 'estimate'
											: h.reason}</span
								>
								<span class="num">{formatRs(h.oldCost)} → {formatRs(h.newCost)}</span>
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<p class="text-danger">Couldn't load this product.</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
