<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Calculator from '@lucide/svelte/icons/calculator';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Thumb from '#lib/components/app/thumb.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = (typeof data.rows)[number];

	let busy = $state<string | null>(null);
	let picked = $state<string[]>([]);
	let changesOpen = $state(false);

	/** cost: true → inventory write-off (expense); false → no effect on profit. */
	const REASONS = [
		{ id: 'returned', label: 'Returned to stock', cost: false },
		{ id: 'ignore', label: "Wasn't real stock", cost: false },
		{ id: 'damaged', label: 'Damaged', cost: true },
		{ id: 'missing', label: 'Missing / lost', cost: true },
		{ id: 'count', label: 'Lost in recount', cost: true }
	] as const;
	const reasonOf = (id: string | null) => REASONS.find((r) => r.id === id);

	const SOURCE: Record<string, { tone: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
		batch: { tone: 'success', label: 'from purchase' },
		estimated: { tone: 'warning', label: 'estimated' },
		shopify: { tone: 'info', label: 'Shopify cost' },
		none: { tone: 'danger', label: 'missing' }
	};
	const firstOfProduct = (r: Row, i: number) => i === 0 || data.rows[i - 1].productId !== r.productId;

	function href(changes: Record<string, string | number | null>) {
		const p = new URLSearchParams(page.url.searchParams.toString());
		for (const [k, val] of Object.entries(changes)) {
			if (val === null || val === '') p.delete(k);
			else p.set(k, String(val));
		}
		if (!('page' in changes)) p.delete('page');
		return `?${p}`;
	}
	const views = $derived([
		{ id: 'needs', label: `In stock, no cost (${data.counts.needs})` },
		{ id: 'noweight', label: `No weight (${data.counts.noweight})` },
		{ id: 'estimated', label: `Estimated (${data.counts.estimated})` },
		{ id: 'all', label: `All (${data.counts.all})` }
	]);
	const s = $derived(data.summary);
	const openingHref = $derived(`/inventory/opening?m=${page.url.searchParams.get('m') ?? ''}`);

	// ── Cost details (loaded on demand) ──
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
	async function openDetails(r: Row) {
		detailsOpen = true;
		details = null;
		loadingDetails = true;
		try {
			const res = await fetch(`/inventory/cost/${r.id}`);
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

	const act =
		(name: string, after?: () => void) =>
		() => {
			busy = name;
			return async ({
				update,
				result
			}: {
				update: (o?: { reset?: boolean }) => Promise<void>;
				result: { type: string };
			}) => {
				await update({ reset: false });
				busy = null;
				if (result.type === 'success') after?.();
			};
		};
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Inventory</h1>
			<p class="text-sm text-muted-foreground">Stock from Shopify, valued at cost. Click a cost to see how it's built.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<form method="POST" action={formAction('refresh')} use:enhance={act('refresh')}>
				<Button type="submit" variant="outline" disabled={!!busy}>
					<RefreshCw class={busy === 'refresh' ? 'animate-spin' : ''} />
					{busy === 'refresh' ? 'Pulling…' : 'Pull from Shopify'}
				</Button>
			</form>
			<Button variant="outline" href={openingHref}><Calculator /> Opening costs</Button>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Total stock value (at cost)" hint="Warehouse + couriers + on the way">
			{formatRs(Number(s.value) + Number(data.elsewhere.withCourier.value) + data.elsewhere.onTheWay.value)}
		</Stat>
		<Stat label="In warehouse" hint="{Number(s.units).toLocaleString('en-PK')} units · Shopify on-hand × cost">
			{formatRs(Number(s.value))}
		</Stat>
		<Stat label="With couriers" hint="{Number(data.elsewhere.withCourier.units)} units in parcels not yet delivered/returned">
			{formatRs(Number(data.elsewhere.withCourier.value))}
		</Stat>
		<Stat label="On the way (paid purchases)" hint="{data.elsewhere.onTheWay.units} units in paid purchases">
			{formatRs(data.elsewhere.onTheWay.value)}
		</Stat>
	</div>
	<div class="-mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
		{#if s.missing}
			<a href={openingHref} class="text-danger underline-offset-2 hover:underline">
				{s.missing} in-stock products have no cost ({Number(s.missingUnits).toLocaleString('en-PK')} units not valued) → Opening costs
			</a>
		{/if}
		<span>{s.value ? formatPct(Number(s.estimatedValue) / Number(s.value)) : '—'} of warehouse value is estimated</span>
		{#if !data.changes.length && data.decided.length}
			<span>
				Stock changes: none waiting ·
				<button type="button" class="underline underline-offset-2 hover:text-foreground" onclick={() => (changesOpen = true)}>
					review {data.decided.length} recent decision{data.decided.length === 1 ? '' : 's'}
				</button>
			</span>
		{/if}
	</div>

	{#if data.changes.length}
		<div class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
			<span>
				<b>{data.changes.length}</b> stock change{data.changes.length === 1 ? '' : 's'} made in Shopify need a reason
				(returned, damaged, wasn't real…).
			</span>
			<Button size="sm" variant="outline" class="ml-auto" onclick={() => (changesOpen = true)}>Review</Button>
		</div>
	{/if}

	<Card.Root>
		<Card.Header class="gap-3" data-sveltekit-noscroll>
			<div class="flex flex-wrap items-center gap-1">
				{#each views as view (view.id)}
					<Button href={href({ view: view.id })} size="sm" variant={data.view === view.id ? 'secondary' : 'ghost'}>{view.label}</Button>
				{/each}
				<form method="GET" class="ml-auto" data-sveltekit-keepfocus>
					{#each [...page.url.searchParams].filter(([k]) => k !== 'q' && k !== 'page') as [k, val] (k)}
						<input type="hidden" name={k} value={val} />
					{/each}
					<Input name="q" value={data.q} placeholder="Product or SKU" class="h-8 w-44" />
				</form>
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Product</Table.Head>
						<Table.Head class="text-right">On hand</Table.Head>
						<Table.Head class="text-right">Weight</Table.Head>
						<Table.Head class="text-right">Cost</Table.Head>
						<Table.Head class="pr-6 text-right">Stock value</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r, i (r.id)}
						<Table.Row>
							<Table.Cell class="max-w-96 pl-6">
								<div class="flex items-center gap-3">
									<Thumb src={r.imageUrl} alt={`${r.productTitle} ${r.variantTitle ?? ''}`} />
									<div class="min-w-0">
										<div class={['truncate', firstOfProduct(r, i) ? 'font-medium' : 'text-muted-foreground']}>{r.productTitle}</div>
										<div class="truncate text-xs text-muted-foreground">
											{r.variantTitle ?? ''}{r.variantTitle && r.sku ? ' · ' : ''}{r.sku ?? ''}
										</div>
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">{r.onHand ?? 0}</Table.Cell>
							<Table.Cell class="num text-right">
								{#if r.weightG}{r.weightG} g{:else}<span class="text-danger">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<button
									type="button"
									class="rounded px-1.5 py-0.5 text-right hover:bg-accent"
									title="How is this cost built?"
									onclick={() => openDetails(r)}
								>
									<Money paisa={r.avgCost} muted />
									<div class="mt-0.5"><StatusBadge tone={SOURCE[r.costSource].tone} label={SOURCE[r.costSource].label} /></div>
								</button>
							</Table.Cell>
							<Table.Cell class="pr-6 text-right"><Money paisa={Math.max(0, r.onHand ?? 0) * r.avgCost} muted /></Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row><Table.Cell colspan={5} class="py-10 text-center text-muted-foreground">Nothing here.</Table.Cell></Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		{#if data.pageCount > 1}
			<Card.Footer class="flex items-center justify-between text-sm text-muted-foreground">
				<span>{data.totalRows} variants · page {data.page} of {data.pageCount}</span>
				<div class="flex gap-2">
					<Button size="sm" variant="outline" href={href({ page: data.page - 1 })} disabled={data.page <= 1}>Previous</Button>
					<Button size="sm" variant="outline" href={href({ page: data.page + 1 })} disabled={data.page >= data.pageCount}>Next</Button>
				</div>
			</Card.Footer>
		{/if}
	</Card.Root>
</div>

<Sheet.Root bind:open={changesOpen}>
	<Sheet.Content side="right" class="w-full sm:max-w-2xl!">
		<Sheet.Header>
			<Sheet.Title>Stock changes made in Shopify</Sheet.Title>
			<Sheet.Description>
				Changes not explained by orders — returns put back, damaged or missing items, recounts. Damaged,
				missing and lost-in-recount go to the income statement as inventory write-offs (qty × cost).
				{#if data.lastStockCheck}Last check {new Date(data.lastStockCheck).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}.{/if}
			</Sheet.Description>
		</Sheet.Header>
		{#if data.changes.length}
			<div class="overflow-auto">
				<form method="POST" action={formAction('classify')} use:enhance={act('classify', () => ((picked = []), (changesOpen = data.changes.length > 0)))}>
					<div class="flex flex-wrap items-center gap-2 border-y bg-muted/40 px-4 py-2">
						<span class="text-sm text-muted-foreground">{picked.length} selected</span>
						<Button type="button" size="xs" variant="ghost" onclick={() => (picked = data.changes.filter((c) => c.qty > 0).map((c) => c.id))}>Select all +</Button>
						<Button type="button" size="xs" variant="ghost" onclick={() => (picked = data.changes.filter((c) => c.qty < 0).map((c) => c.id))}>Select all −</Button>
						<span class="ml-auto flex flex-wrap gap-1">
							{#each REASONS as r (r.id)}
								<Button type="submit" name="reason" value={r.id} size="xs" variant={r.cost ? 'outline' : 'secondary'} disabled={!picked.length || !!busy}>{r.label}{r.cost ? ' (write-off)' : ''}</Button>
							{/each}
						</span>
					</div>
					<div class="max-h-[28rem] overflow-auto px-0">
						<Table.Root>
							<Table.Body>
								{#each data.changes as c (c.id)}
									<Table.Row>
										<Table.Cell class="w-8 pl-6">
											<input type="checkbox" name="id" value={c.id} bind:group={picked} aria-label="Select" />
										</Table.Cell>
										<Table.Cell class="text-sm text-muted-foreground">
											{new Date(c.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Karachi' })}
										</Table.Cell>
										<Table.Cell class="max-w-80">
											<div class="flex items-center gap-3">
												<Thumb src={c.imageUrl} alt={`${c.productTitle ?? ''} ${c.variantTitle ?? ''}`} size={32} />
												<div class="min-w-0">
													<div class="truncate">{c.productTitle ?? 'Deleted product'}</div>
													<div class="truncate text-xs text-muted-foreground">{c.variantTitle ?? ''}{c.variantTitle && c.sku ? ' · ' : ''}{c.sku ?? ''}</div>
												</div>
											</div>
										</Table.Cell>
										<Table.Cell class={['num text-right font-medium', c.qty < 0 ? 'text-danger' : 'text-success']}>
											{c.qty > 0 ? '+' : ''}{c.qty}
										</Table.Cell>
										<Table.Cell class="pr-6 text-right"><Money paisa={c.qty * c.unitCost} muted /></Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</form>
			</div>
		{:else}
			<p class="px-4 text-sm text-muted-foreground">Nothing waiting for a reason.</p>
		{/if}

		{#if data.decided.length}
			<div class="grid gap-2 border-t px-4 pt-4 pb-6">
				<div>
					<p class="text-sm font-medium">Recently decided (last 90 days)</p>
					<p class="text-xs text-muted-foreground">
						Picked the wrong reason? Change it here — the income statement updates. “Wasn't real stock” and “Returned”
						cost nothing; damaged, missing and lost-in-recount are write-offs.
					</p>
				</div>
				<div class="grid max-h-[24rem] gap-1 overflow-auto pr-1">
					{#each data.decided as d (d.id)}
						{@const r = reasonOf(d.reason)}
						{@const value = -d.qty * (d.unitCost || d.avgCost || 0)}
						<div class="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted/50">
							<Thumb src={d.imageUrl} alt={`${d.productTitle ?? ''} ${d.variantTitle ?? ''}`} size={32} />
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm">{d.productTitle ?? 'Deleted product'}</div>
								<div class="truncate text-xs text-muted-foreground">
									{d.variantTitle ?? ''} · {new Date(d.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Karachi' })}
								</div>
							</div>
							<div class={['num w-14 text-right text-sm font-medium', d.qty < 0 ? 'text-danger' : 'text-success']}>
								{d.qty > 0 ? '+' : ''}{d.qty}
							</div>
							<div class="w-28 text-right text-xs">
								{#if r?.cost && value > 0}<span class="text-danger">write-off {formatRs(value)}</span>{:else}<span class="text-muted-foreground">no cost</span>{/if}
							</div>
							<form method="POST" action={formAction('classify')} use:enhance={act('classify')}>
								<input type="hidden" name="id" value={d.id} />
								<select
									name="reason"
									class="h-8 rounded-md border bg-background px-1.5 text-sm"
									value={d.reason}
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
									aria-label="Reason"
								>
									{#each REASONS as o (o.id)}<option value={o.id}>{o.label}{o.cost ? ' (write-off)' : ''}</option>{/each}
								</select>
							</form>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={detailsOpen}>
	<Sheet.Content side="right" class="w-full sm:max-w-md!">
		<Sheet.Header>
			<Sheet.Title>Cost details</Sheet.Title>
			<Sheet.Description>How this product's cost is built.</Sheet.Description>
		</Sheet.Header>
		<div class="grid gap-5 overflow-auto px-4 pb-6 text-sm">
			{#if loadingDetails}
				<div class="flex items-center gap-2 text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Loading…</div>
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
						<p class="font-medium">From purchases <span class="font-normal text-muted-foreground">(weighted average)</span></p>
						{#each d.purchases as p (p.id)}
							<a href="/purchases/{p.id}" class="flex justify-between rounded px-2 py-1 hover:bg-accent">
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
							Estimate {#if d.source === 'batch'}<span class="font-normal text-muted-foreground">(used before the first purchase)</span>{/if}
						</p>
						<div class="grid gap-1 rounded-lg border p-3">
							<div class="flex justify-between gap-3">
								<span class="text-muted-foreground">
									Goods: {e.currency === 'PKR' ? `Rs ${e.price / 100}` : `¥${e.price / 100} × Rs ${e.fx / 10_000}`}
								</span>
								<span class="num">{formatRs(e.goods, { decimals: true })}</span>
							</div>
							<div class="flex justify-between gap-3">
								<span class="text-muted-foreground">
									DDP: {#if e.ddpOverride}{e.ddp === 0 ? 'local, none' : 'set by hand'}{:else if e.currency === 'PKR'}local, none{:else}{e.weightG ?? 0} g × Rs {(e.ddpPerKg / 100).toLocaleString('en-PK')}/kg{/if}
								</span>
								<span class="num">{formatRs(e.ddp, { decimals: true })}</span>
							</div>
							<div class="flex justify-between border-t pt-1 font-medium">
								<span>Estimated cost</span><span class="num">{formatRs(e.total ?? 0, { decimals: true })}</span>
							</div>
						</div>
					</div>
				{:else if d.source === 'shopify'}
					<p class="text-muted-foreground">Using the Shopify “cost per item” ({formatRs(d.shopifyCost ?? 0)}), marked as correct.</p>
				{:else if d.source === 'none'}
					<p class="text-danger">No cost yet — add the buying price on Opening costs.</p>
				{/if}

				{#if d.source !== 'batch'}
					<Button variant="outline" href="/inventory/opening?view=all&q={encodeURIComponent(d.sku ?? d.title)}">Edit on Opening costs</Button>
				{/if}

				{#if d.history.length}
					<div class="grid gap-1">
						<p class="font-medium">History</p>
						{#each d.history as h, i (i)}
							<div class="flex justify-between text-xs text-muted-foreground">
								<span>{fmtDay(h.at)} · {h.reason === 'batch' ? 'purchase' : h.reason === 'opening' ? 'estimate' : h.reason}</span>
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
