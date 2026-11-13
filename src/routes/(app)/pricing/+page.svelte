<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import Calculator from '@lucide/svelte/icons/calculator';
	import { productGroups } from '#lib/group-rows.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formAction } from '#lib/form-action.js';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Thumb from '#lib/components/app/thumb.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let costsOpen = $state(false);
	let { data, form }: PageProps = $props();
	const groups = $derived(productGroups(data.rows));
	type Row = (typeof data.rows)[number];

	/** Edits keep their row, so changes made on other pages/filters still get pushed. */
	let edits = $state<Record<string, { val: string; row: Row }>>({});
	let busy = $state<string | null>(null);
	let review = $state(false);
	let showCosts = $state(false);

	const e = $derived(data.e);
	const m = $derived(data.measured);
	const o = $derived(data.settings.overrides);

	/** perUnit: the product's own share of the per-order cost (bulk items carry less). */
	const profitAt = (price: number, cost: number, perUnit = e.perUnit) =>
		Math.round(price * (1 - e.pct) - cost - perUnit);
	const parse = (s: string) => {
		const n = Number(s.replace(/[,\s]/g, ''));
		return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
	};
	/** New price (paisa) if edited and different from current. */
	const newPrice = (r: Row) => {
		const p = edits[r.id] !== undefined ? parse(edits[r.id].val) : null;
		return p !== null && p !== r.price ? p : null;
	};
	function setEdit(r: Row, val: string) {
		if (val.trim() === '' || parse(val) === r.price) delete edits[r.id];
		else edits[r.id] = { val, row: r };
	}
	const useSuggested = (r: Row) => r.suggested && setEdit(r, String(r.suggested / 100));

	/** "Price for all" box on a product's header row: same new price on every variant on this page. */
	let groupVal = $state<Record<string, string>>({});
	function setGroup(r: Row, val: string) {
		groupVal[r.productId] = val;
		for (const x of data.rows) if (x.productId === r.productId) setEdit(x, val);
	}
	function suggestAllOnPage() {
		for (const r of data.rows) if (r.suggested && r.suggested !== r.price) useSuggested(r);
	}

	const tone = (margin: number | null) =>
		margin === null
			? 'text-muted-foreground'
			: margin < 0
				? 'text-danger'
				: margin < e.target
					? 'text-warning'
					: 'text-success';

	const changes = $derived(
		Object.values(edits)
			.map(({ row }) => ({ r: row, price: newPrice(row) }))
			.filter((c): c is { r: Row; price: number } => c.price !== null)
	);
	/** Monthly profit change if the same units sell (last 90 days × 30/90). */
	const impact = $derived(
		Math.round(
			changes.reduce(
				(t, c) =>
					t +
					(c.r.cost > 0
						? (profitAt(c.price, c.r.cost, c.r.perUnit) - (c.r.profit ?? 0)) * c.r.sold
						: 0),
				0
			) *
				(30 / data.windowDays)
		)
	);

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
		{ id: 'below', label: `Below target (${data.counts.below})` },
		{ id: 'losing', label: `Losing money (${data.counts.losing})` },
		{ id: 'nocost', label: `No cost (${data.counts.nocost})` },
		{ id: 'best', label: `Best sellers (${data.counts.best})` },
		{ id: 'all', label: `All (${data.counts.all})` }
	]);
	const pct = (x: number) => (x * 100).toFixed(1);
	const rs = (p: number) => (p / 100).toFixed(0);
</script>

<div class="grid gap-6 pb-24">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Pricing</h1>
			<p class="text-sm text-muted-foreground">
				True profit per piece after courier, returns, withholding and discounts. Suggested prices
				hit your target margin and end in 99.
			</p>
		</div>
		<Button variant="outline" onclick={() => (costsOpen = true)}
			><Calculator /> Cost of selling</Button
		>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Target margin" hint="True profit as % of price">{formatPct(e.target, 0)}</Stat>
		<Stat label="Your margin now" hint="Weighted by units sold, last {data.windowDays} days">
			<span class={tone(data.summary.weightedMargin)}
				>{data.summary.weightedMargin === null ? '—' : formatPct(data.summary.weightedMargin)}</span
			>
		</Stat>
		<Stat label="Product profit / month" hint="Before ads and fixed costs"
			>{formatRs(data.summary.monthlyProfit)}</Stat
		>
		<Stat
			label="Selling cost per piece"
			hint="Store-wide · bulk items carry less · see Cost of selling"
		>
			{formatRs(e.perUnit)} + {formatPct(e.pct)}
		</Stat>
	</div>

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
			<div class="flex flex-wrap items-center justify-between gap-2">
				<Card.Description>
					Profit / pc = price − selling costs − cost. Each product's share of the per-order shipping
					cost uses how many pieces its orders usually have. Green ≥ target, amber below, red
					losing.
					{#if data.view === 'nocost'}Add costs on the <a href="/inventory" class="underline"
							>Inventory</a
						> page first.{/if}
				</Card.Description>
				{#if data.rows.some((r) => r.suggested && r.suggested !== r.price)}
					<Button size="sm" variant="outline" onclick={suggestAllOnPage}
						><Wand /> Use suggested for this page</Button
					>
				{/if}
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root sticky>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Product</Table.Head>
						<Table.Head class="text-right">Cost</Table.Head>
						<Table.Head class="text-right">Sold {data.windowDays}d</Table.Head>
						<Table.Head class="text-right">Price</Table.Head>
						<Table.Head class="text-right">Profit / pc</Table.Head>
						<Table.Head class="text-right">Suggested</Table.Head>
						<Table.Head class="pr-6">New price</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r, i (r.id)}
						{@const np = newPrice(r)}
						{@const npProfit = np !== null && r.cost > 0 ? profitAt(np, r.cost, r.perUnit) : null}
						{#if groups[i].first && groups[i].grouped}
							<Table.Row class="bg-muted/40 hover:bg-muted/40">
								<Table.Cell colspan={7} class="py-2 pr-6 pl-6">
									<div class="flex items-center gap-3">
										<span class="max-w-md min-w-0 truncate font-medium" title={r.productTitle}
											>{r.productTitle}</span
										>
										<span class="text-xs text-muted-foreground">{groups[i].size} variants</span>
										<div class="ml-auto flex items-center gap-2">
											<span class="text-xs text-muted-foreground">Price for all</span>
											<Input
												value={groupVal[r.productId] ?? ''}
												oninput={(ev) => setGroup(r, ev.currentTarget.value)}
												placeholder="Rs"
												inputmode="decimal"
												class="h-8 w-24 text-right"
												aria-label="New price for every variant of {r.productTitle}"
											/>
										</div>
									</div>
								</Table.Cell>
							</Table.Row>
						{/if}
						<Table.Row class={np !== null ? 'bg-warning-soft/40' : ''}>
							<Table.Cell class={['max-w-80 pl-6', groups[i].grouped && 'pl-12']}>
								<div class="flex items-center gap-3">
									<Thumb src={r.imageUrl} alt={`${r.productTitle} ${r.variantTitle ?? ''}`} />
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
							<Table.Cell class="text-right">
								{#if r.cost > 0}
									<Money paisa={r.cost} />
									{#if r.costSource !== 'batch'}<div class="text-xs text-muted-foreground">
											estimated
										</div>{/if}
								{:else}<a
										href="/inventory/opening?view=all&q={encodeURIComponent(
											r.sku ?? r.productTitle
										)}"
										class="text-sm text-danger underline">add cost</a
									>{/if}
							</Table.Cell>
							<Table.Cell class="num text-right">
								{r.sold || '—'}
								{#if r.returned}<div class="text-xs text-danger">{r.returned} returned</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right font-medium"><Money paisa={r.price} /></Table.Cell>
							<Table.Cell
								class="text-right"
								title={r.piecesPerOrder
									? `Selling cost ${formatRs(r.perUnit)}/pc + ${formatPct(e.pct)} of price — orders with this product usually have ${r.piecesPerOrder} pieces`
									: `Selling cost ${formatRs(r.perUnit)}/pc + ${formatPct(e.pct)} of price (store-wide: few orders yet)`}
							>
								{#if r.profit !== null}
									<span class={['num font-medium', tone(r.margin)]}>{formatRs(r.profit)}</span>
									<div class={['text-xs', tone(r.margin)]}>{formatPct(r.margin ?? 0, 0)}</div>
									{#if r.piecesPerOrder && r.piecesPerOrder !== Math.round(e.unitsPerOrder)}<div
											class="text-[11px] text-muted-foreground"
										>
											~{r.piecesPerOrder} pcs/order
										</div>{/if}
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if r.suggested}
									<button
										type="button"
										class={[
											'num rounded px-1.5 py-0.5 font-medium hover:bg-accent',
											r.suggested === r.price ? 'text-muted-foreground' : 'text-info'
										]}
										title="Use this price"
										onclick={() => useSuggested(r)}>{formatRs(r.suggested)}</button
									>
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="pr-6">
								<div class="flex items-center gap-2">
									<Input
										value={edits[r.id]?.val ?? ''}
										oninput={(ev) => setEdit(r, ev.currentTarget.value)}
										placeholder={rs(r.price)}
										inputmode="decimal"
										class="h-8 w-24 text-right"
										aria-label="New price for {r.productTitle} {r.variantTitle ?? ''}"
									/>
									{#if npProfit !== null && np}
										<span class={['num text-xs whitespace-nowrap', tone(npProfit / np)]}
											>{formatRs(npProfit)} · {formatPct(npProfit / np, 0)}</span
										>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={7} class="py-10 text-center text-muted-foreground"
								>Nothing here.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		<Card.Footer class="text-sm text-muted-foreground">{data.totalRows} variants</Card.Footer>
	</Card.Root>
</div>

{#if changes.length}
	<div
		class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur md:left-(--sidebar-width)"
	>
		<span class="text-sm text-muted-foreground">
			{changes.length} price change{changes.length === 1 ? '' : 's'} ·
			<span class={impact >= 0 ? 'text-success' : 'text-danger'}
				>{impact >= 0 ? '+' : ''}{formatRs(impact)}/month</span
			>
			<span class="text-xs">if the same units sell</span>
		</span>
		<Button variant="ghost" onclick={() => ((edits = {}), (groupVal = {}))}>Discard</Button>
		<Button onclick={() => (review = true)}>Review & update Shopify</Button>
	</div>
{/if}

<Sheet.Root bind:open={review}>
	<Sheet.Content side="right" class="w-full sm:max-w-lg">
		<Sheet.Header>
			<Sheet.Title>Update {changes.length} prices in Shopify</Sheet.Title>
			<Sheet.Description>
				Live store prices change immediately. Compare-at prices are not touched.
			</Sheet.Description>
		</Sheet.Header>
		<div class="grid max-h-[60vh] gap-2 overflow-auto px-4 text-sm">
			{#each changes as c (c.r.id)}
				{@const after = c.r.cost > 0 ? profitAt(c.price, c.r.cost, c.r.perUnit) : null}
				<div class="flex items-center justify-between gap-3 border-b py-2">
					<div class="min-w-0">
						<div class="truncate font-medium">{c.r.productTitle}</div>
						<div class="truncate text-xs text-muted-foreground">{c.r.variantTitle ?? ''}</div>
					</div>
					<div class="text-right whitespace-nowrap">
						<span class="text-muted-foreground line-through">{formatRs(c.r.price)}</span>
						<span class="ml-1 font-medium">{formatRs(c.price)}</span>
						{#if after !== null}<div class={['text-xs', tone(after / c.price)]}>
								profit {formatRs(after)} / pc
							</div>{/if}
					</div>
				</div>
			{/each}
		</div>
		<form
			method="POST"
			action={formAction('push')}
			class="grid gap-2 p-4"
			use:enhance={() => {
				busy = 'push';
				return async ({ update, result }) => {
					await update({ reset: false });
					busy = null;
					if (result.type === 'success') {
						edits = {};
						groupVal = {};
						review = false;
					}
				};
			}}
		>
			<input
				type="hidden"
				name="changes"
				value={JSON.stringify(changes.map((c) => ({ id: c.r.id, price: String(c.price / 100) })))}
			/>
			<p class="text-sm">
				Estimated effect: <b class={impact >= 0 ? 'text-success' : 'text-danger'}
					>{impact >= 0 ? '+' : ''}{formatRs(impact)}/month</b
				>
				<span class="text-muted-foreground"
					>(same units as the last {data.windowDays} days — higher prices may sell fewer)</span
				>
			</p>
			<Button type="submit" disabled={!!busy}
				>{busy === 'push' ? 'Updating Shopify…' : `Update ${changes.length} prices`}</Button
			>
		</form>
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={costsOpen}>
	<Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header class="flex flex-row flex-wrap items-center justify-between gap-2 pr-8">
			<div>
				<Dialog.Title>Cost of selling</Dialog.Title>
				<Dialog.Description>
					Measured from {m.orders} delivered orders in the last {data.windowDays} days. Ads and fixed
					costs are left out.
				</Dialog.Description>
			</div>
			<Button variant="ghost" size="sm" onclick={() => (showCosts = !showCosts)}
				>{showCosts ? 'Hide' : 'Adjust'}</Button
			>
		</Dialog.Header>
		<div class="grid gap-4">
			<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
				<div>
					<span class="text-muted-foreground">Courier + returns / order</span>
					<div class="num font-medium">{formatRs(e.courierPerOrder)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">Packaging / order</span>
					<div class="num font-medium">{formatRs(e.packagingPerOrder)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">Shipping charged / order</span>
					<div class="num font-medium text-success">−{formatRs(e.shippingPerOrder)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">Pieces per order (typical)</span>
					<div class="num font-medium">{e.unitsPerOrder.toFixed(1)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">Withholding (4% of COD)</span>
					<div class="num font-medium">{formatPct(e.withholdingPct)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">5% advance discount</span>
					<div class="num font-medium">{formatPct(e.advancePct)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">Other discounts</span>
					<div class="num font-medium">{formatPct(e.otherDiscountPct)}</div>
				</div>
				<div>
					<span class="text-muted-foreground">Per piece</span>
					<div class="num font-medium">{formatRs(e.perUnit)} + {formatPct(e.pct)} of price</div>
				</div>
			</div>
			{#if showCosts}
				<form
					method="POST"
					action={formAction('settings')}
					class="mt-4 grid gap-3 border-t pt-4"
					use:enhance={() => {
						busy = 'settings';
						return async ({ update }) => {
							await update({ reset: false });
							busy = null;
						};
					}}
				>
					<p class="text-xs text-muted-foreground">
						Leave a box empty to use the measured value (shown faded).
					</p>
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<div class="grid gap-1.5">
							<Label for="targetMargin">Target margin %</Label><Input
								id="targetMargin"
								name="targetMargin"
								inputmode="decimal"
								value={pct(data.settings.targetMargin)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="courierPerOrder">Courier + returns Rs</Label><Input
								id="courierPerOrder"
								name="courierPerOrder"
								inputmode="decimal"
								value={o.courierPerOrder !== undefined ? rs(o.courierPerOrder) : ''}
								placeholder={rs(m.courierPerOrder)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="packagingPerOrder">Packaging Rs</Label><Input
								id="packagingPerOrder"
								name="packagingPerOrder"
								inputmode="decimal"
								value={o.packagingPerOrder !== undefined ? rs(o.packagingPerOrder) : ''}
								placeholder={rs(m.packagingPerOrder)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="shippingPerOrder">Shipping charged Rs</Label><Input
								id="shippingPerOrder"
								name="shippingPerOrder"
								inputmode="decimal"
								value={o.shippingPerOrder !== undefined ? rs(o.shippingPerOrder) : ''}
								placeholder={rs(m.shippingPerOrder)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="unitsPerOrder">Pieces per order</Label><Input
								id="unitsPerOrder"
								name="unitsPerOrder"
								inputmode="decimal"
								value={o.unitsPerOrder ?? ''}
								placeholder={m.unitsPerOrder.toFixed(1)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="withholdingPct">Withholding %</Label><Input
								id="withholdingPct"
								name="withholdingPct"
								inputmode="decimal"
								value={o.withholdingPct !== undefined ? pct(o.withholdingPct) : ''}
								placeholder={pct(m.withholdingPct)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="advancePct">Advance discount %</Label><Input
								id="advancePct"
								name="advancePct"
								inputmode="decimal"
								value={o.advancePct !== undefined ? pct(o.advancePct) : ''}
								placeholder={pct(m.advancePct)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="otherDiscountPct">Other discounts %</Label><Input
								id="otherDiscountPct"
								name="otherDiscountPct"
								inputmode="decimal"
								value={o.otherDiscountPct !== undefined ? pct(o.otherDiscountPct) : ''}
								placeholder={pct(m.otherDiscountPct)}
							/>
						</div>
					</div>
					<div>
						<Button type="submit" disabled={!!busy}
							>{busy === 'settings' ? 'Saving…' : 'Save'}</Button
						>
					</div>
				</form>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
