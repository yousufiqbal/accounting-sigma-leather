<script lang="ts">
	import { productGroups } from '#lib/group-rows.js';
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
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
	import CostSheet from '#lib/components/app/cost-sheet.svelte';
	import { COST_SOURCE } from '#lib/cost-source.js';
	import { formatPct, formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const groups = $derived(productGroups(data.rows));
	const groupStock = (r: Row) =>
		data.rows.filter((x) => x.productId === r.productId).reduce((n, x) => n + (x.onHand ?? 0), 0);
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

	const SOURCE = COST_SOURCE;

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
		{ id: 'all', label: `All (${data.counts.all})` },
		{ id: 'needs', label: `In stock, no cost (${data.counts.needs})` },
		{ id: 'noweight', label: `No weight (${data.counts.noweight})` },
		{ id: 'estimated', label: `Estimated (${data.counts.estimated})` }
	]);
	const s = $derived(data.summary);
	const openingHref = $derived(`/inventory/opening?m=${page.url.searchParams.get('m') ?? ''}`);

	let costSheet = $state<CostSheet>();

	const act = (name: string, after?: () => void) => () => {
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
			<p class="text-sm text-muted-foreground">
				Stock from Shopify, valued at cost. Click a cost to see how it's built.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" href={openingHref}><Calculator /> Opening costs</Button>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Total stock value (at cost)" hint="Warehouse + couriers + on the way">
			{formatRs(
				Number(s.value) + Number(data.elsewhere.withCourier.value) + data.elsewhere.onTheWay.value
			)}
		</Stat>
		<Stat
			label="In warehouse"
			hint="{Number(s.units).toLocaleString('en-PK')} units · Shopify on-hand × cost"
		>
			{formatRs(Number(s.value))}
		</Stat>
		<Stat
			label="With couriers"
			hint="{Number(data.elsewhere.withCourier.units)} units in parcels not yet delivered/returned"
		>
			{formatRs(Number(data.elsewhere.withCourier.value))}
		</Stat>
		<Stat
			label="On the way (purchased)"
			hint="{data.elsewhere.onTheWay.units} units purchased, not arrived"
		>
			{formatRs(data.elsewhere.onTheWay.value)}
		</Stat>
	</div>
	<div class="-mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
		{#if s.missing}
			<a href={openingHref} class="text-danger underline-offset-2 hover:underline">
				{s.missing} in-stock products have no cost ({Number(s.missingUnits).toLocaleString('en-PK')} units
				not valued) → Opening costs
			</a>
		{/if}
		<span
			>{s.value ? formatPct(Number(s.estimatedValue) / Number(s.value)) : '—'} of warehouse value is estimated</span
		>
		{#if !data.changes.length && data.decided.length}
			<span>
				Stock changes: none waiting ·
				<button
					type="button"
					class="underline underline-offset-2 hover:text-foreground"
					onclick={() => (changesOpen = true)}
				>
					review {data.decided.length} recent decision{data.decided.length === 1 ? '' : 's'}
				</button>
			</span>
		{/if}
	</div>

	{#if data.changes.length}
		<div
			class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning"
		>
			<span>
				<b>{data.changes.length}</b> stock change{data.changes.length === 1 ? '' : 's'} made in Shopify
				need a reason (returned, damaged, wasn't real…).
			</span>
			<Button size="sm" variant="outline" class="ml-auto" onclick={() => (changesOpen = true)}
				>Review</Button
			>
		</div>
	{/if}

	<Card.Root>
		<Card.Header class="gap-3" data-sveltekit-noscroll>
			<div class="flex flex-wrap items-center gap-1">
				{#each views as view (view.id)}
					<Button
						href={href({ view: view.id })}
						size="sm"
						variant={data.view === view.id ? 'secondary' : 'ghost'}>{view.label}</Button
					>
				{/each}
				<form method="GET" class="w-full sm:ml-auto sm:w-auto" data-sveltekit-keepfocus>
					{#each [...page.url.searchParams].filter(([k]) => k !== 'q' && k !== 'page') as [k, val] (k)}
						<input type="hidden" name={k} value={val} />
					{/each}
					<Input name="q" value={data.q} placeholder="Product or SKU" class="h-8 w-full sm:w-44" />
				</form>
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root sticky>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Product</Table.Head>
						<Table.Head class="text-right">On hand</Table.Head>
						<Table.Head class="text-right" title="Purchased, not arrived yet">Incoming</Table.Head>
						<Table.Head class="text-right">Weight</Table.Head>
						<Table.Head class="text-right">Cost</Table.Head>
						<Table.Head class="pr-6 text-right">Stock value</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r, i (r.id)}
						{#if groups[i].first && groups[i].grouped}
							<Table.Row class="bg-muted/40 hover:bg-muted/40">
								<Table.Cell colspan={6} class="py-2 pr-6 pl-6">
									<div class="flex items-center gap-3">
										<span class="max-w-md min-w-0 truncate font-medium" title={r.productTitle}
											>{r.productTitle}</span
										>
										<span class="text-xs text-muted-foreground">{groups[i].size} variants</span>
										<span class="text-xs text-muted-foreground">· {groupStock(r)} on hand</span>
									</div>
								</Table.Cell>
							</Table.Row>
						{/if}
						<Table.Row>
							<Table.Cell class={['max-w-96 pl-6', groups[i].grouped && 'pl-12']}>
								<div class="flex items-center gap-3">
									<Thumb
										src={r.imageUrl}
										alt={`${r.productTitle}${r.variantTitle ? ` · ${r.variantTitle}` : ''}`}
										caption="{r.onHand ?? 0} on hand"
									/>
									<div class="min-w-0">
										{#if groups[i].grouped}
											<div class="truncate">{r.variantTitle ?? 'Default'}</div>
											{#if r.sku}<div class="truncate text-xs text-muted-foreground">
													{r.sku}
												</div>{/if}
										{:else}
											<div class="truncate font-medium" title={r.productTitle}>
												{r.productTitle}
											</div>
											<div class="truncate text-xs text-muted-foreground">
												{r.variantTitle ?? ''}{r.variantTitle && r.sku ? ' · ' : ''}{r.sku ?? ''}
											</div>
										{/if}
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">{r.onHand ?? 0}</Table.Cell>
							<Table.Cell class="num text-right"
								>{#if r.incoming}<span class="text-info">{r.incoming}</span>{:else}<span
										class="text-muted-foreground">—</span
									>{/if}</Table.Cell
							>
							<Table.Cell class="num text-right">
								{#if r.weightG}{r.weightG} g{:else}<span class="text-danger">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<button
									type="button"
									class="rounded px-1.5 py-0.5 text-right hover:bg-accent"
									title="How is this cost built?"
									onclick={() => costSheet?.show(r.id)}
								>
									<Money paisa={r.avgCost} muted />
									<div class="mt-0.5">
										<StatusBadge
											tone={SOURCE[r.costSource].tone}
											label={SOURCE[r.costSource].label}
										/>
									</div>
								</button>
							</Table.Cell>
							<Table.Cell class="pr-6 text-right"
								><Money paisa={Math.max(0, r.onHand ?? 0) * r.avgCost} muted /></Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={6} class="py-10 text-center text-muted-foreground"
								>Nothing here.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		{#if data.pageCount > 1}
			<Card.Footer class="flex items-center justify-between text-sm text-muted-foreground">
				<span>{data.totalRows} variants · page {data.page} of {data.pageCount}</span>
				<div class="flex gap-2">
					<Button
						size="sm"
						variant="outline"
						href={href({ page: data.page - 1 })}
						disabled={data.page <= 1}>Previous</Button
					>
					<Button
						size="sm"
						variant="outline"
						href={href({ page: data.page + 1 })}
						disabled={data.page >= data.pageCount}>Next</Button
					>
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
				Changes not explained by orders — returns put back, damaged or missing items, recounts.
				Damaged, missing and lost-in-recount go to the income statement as inventory write-offs (qty
				× cost).
				{#if data.lastStockCheck}Last check {new Date(data.lastStockCheck).toLocaleString('en-GB', {
						timeZone: 'Asia/Karachi'
					})}.{/if}
			</Sheet.Description>
		</Sheet.Header>
		{#if data.changes.length}
			<div class="overflow-auto">
				<form
					method="POST"
					action={formAction('classify')}
					use:enhance={act(
						'classify',
						() => ((picked = []), (changesOpen = data.changes.length > 0))
					)}
				>
					<div class="flex flex-wrap items-center gap-2 border-y bg-muted/40 px-4 py-2">
						<span class="text-sm text-muted-foreground">{picked.length} selected</span>
						<Button
							type="button"
							size="xs"
							variant="ghost"
							onclick={() => (picked = data.changes.filter((c) => c.qty > 0).map((c) => c.id))}
							>Select all +</Button
						>
						<Button
							type="button"
							size="xs"
							variant="ghost"
							onclick={() => (picked = data.changes.filter((c) => c.qty < 0).map((c) => c.id))}
							>Select all −</Button
						>
						<span class="ml-auto flex flex-wrap gap-1">
							{#each REASONS as r (r.id)}
								<Button
									type="submit"
									name="reason"
									value={r.id}
									size="xs"
									variant={r.cost ? 'outline' : 'secondary'}
									disabled={!picked.length || !!busy}
									>{r.label}{r.cost ? ' (write-off)' : ''}</Button
								>
							{/each}
						</span>
					</div>
					<div class="max-h-[28rem] overflow-auto px-0">
						<Table.Root>
							<Table.Body>
								{#each data.changes as c (c.id)}
									<Table.Row>
										<Table.Cell class="w-8 pl-6">
											<input
												type="checkbox"
												name="id"
												value={c.id}
												bind:group={picked}
												aria-label="Select"
											/>
										</Table.Cell>
										<Table.Cell class="text-sm text-muted-foreground">
											{new Date(c.at).toLocaleDateString('en-GB', {
												day: '2-digit',
												month: 'short',
												timeZone: 'Asia/Karachi'
											})}
										</Table.Cell>
										<Table.Cell class="max-w-80">
											<div class="flex items-center gap-3">
												<Thumb
													src={c.imageUrl}
													alt={`${c.productTitle ?? ''} ${c.variantTitle ?? ''}`}
													size={32}
												/>
												<div class="min-w-0">
													<div class="truncate">{c.productTitle ?? 'Deleted product'}</div>
													<div class="truncate text-xs text-muted-foreground">
														{c.variantTitle ?? ''}{c.variantTitle && c.sku ? ' · ' : ''}{c.sku ??
															''}
													</div>
												</div>
											</div>
										</Table.Cell>
										<Table.Cell
											class={[
												'num text-right font-medium',
												c.qty < 0 ? 'text-danger' : 'text-success'
											]}
										>
											{c.qty > 0 ? '+' : ''}{c.qty}
										</Table.Cell>
										<Table.Cell class="pr-6 text-right"
											><Money paisa={c.qty * c.unitCost} muted /></Table.Cell
										>
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
						Picked the wrong reason? Change it here — the income statement updates. “Wasn't real
						stock” and “Returned” cost nothing; damaged, missing and lost-in-recount are write-offs.
					</p>
				</div>
				<div class="grid max-h-[24rem] gap-1 overflow-auto pr-1">
					{#each data.decided as d (d.id)}
						{@const r = reasonOf(d.reason)}
						{@const value = -d.qty * (d.unitCost || d.avgCost || 0)}
						<div class="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted/50">
							<Thumb
								src={d.imageUrl}
								alt={`${d.productTitle ?? ''} ${d.variantTitle ?? ''}`}
								size={32}
							/>
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm">{d.productTitle ?? 'Deleted product'}</div>
								<div class="truncate text-xs text-muted-foreground">
									{d.variantTitle ?? ''} · {new Date(d.at).toLocaleDateString('en-GB', {
										day: '2-digit',
										month: 'short',
										timeZone: 'Asia/Karachi'
									})}
								</div>
							</div>
							<div
								class={[
									'num w-14 text-right text-sm font-medium',
									d.qty < 0 ? 'text-danger' : 'text-success'
								]}
							>
								{d.qty > 0 ? '+' : ''}{d.qty}
							</div>
							<div class="w-28 text-right text-xs">
								{#if r?.cost && value > 0}<span class="text-danger"
										>write-off {formatRs(value)}</span
									>{:else}<span class="text-muted-foreground">no cost</span>{/if}
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
									{#each REASONS as o (o.id)}<option value={o.id}
											>{o.label}{o.cost ? ' (write-off)' : ''}</option
										>{/each}
								</select>
							</form>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<CostSheet bind:this={costSheet} />
