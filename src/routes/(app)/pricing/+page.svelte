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
	const fixedMode = $derived(data.settings.mode === 'fixed');
	const o = $derived(data.settings.overrides);
	/** Example for the fixed-mode explanation: a product costing Rs 1,000. */
	const example = $derived(
		[2, 2.5, 3].map((mult) => {
			const price = Math.ceil(((1000 * mult) / (1 - COD_TAX) + 1) / 100) * 100 - 1;
			return { mult, price, profit: Math.round(price * (1 - COD_TAX) - 1000) };
		})
	);

	/** perUnit: the product's own share of the per-order cost (bulk items carry less). */
	const profitAt = (price: number, cost: number, perUnit = e.perUnit) =>
		e.mode === 'fixed'
			? Math.round(price * (1 - COD_TAX) - cost) // cost-plus: only the 4% COD tax
			: Math.round(price * (1 - e.pct) - cost - perUnit);
	const COD_TAX = 0.04;
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
		{#if fixedMode}
			<Stat
				label="Markup"
				hint="Price = cost × {e.multiplier} ÷ 0.96 · ≈{formatPct(e.target, 0)} margin"
				>{e.multiplier}×</Stat
			>
		{:else}
			<Stat label="Target margin" hint="True profit as % of price">{formatPct(e.target, 0)}</Stat>
		{/if}
		<Stat label="Your margin now" hint="Weighted by units sold, last {data.windowDays} days">
			<span class={tone(data.summary.weightedMargin)}
				>{data.summary.weightedMargin === null ? '—' : formatPct(data.summary.weightedMargin)}</span
			>
		</Stat>
		<Stat label="Product profit / month" hint="Before ads and fixed costs"
			>{formatRs(data.summary.monthlyProfit)}</Stat
		>
		{#if fixedMode}
			<Stat
				label="Selling cost"
				hint="Fixed mode: courier & packaging covered by the Rs 500 minimum">4% COD tax</Stat
			>
		{:else}
			<Stat label="Selling cost per piece" hint="Adjusting (last 90 days) · bulk items carry less">
				{formatRs(e.perUnit)} + {formatPct(e.pct)}
			</Stat>
		{/if}
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
				{#if data.view === 'nocost'}
					<Card.Description>
						Add costs on the <a href="/inventory" class="underline">Inventory</a> page first.
					</Card.Description>
				{:else}
					<span></span>
				{/if}
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
											<div class="flex min-w-0 items-center gap-1.5">
												<span class="truncate">{r.variantTitle ?? 'Default'}</span>
												{#if r.isBundle}<StatusBadge
														tone="info"
														label="bundle · {r.bundleItems} items"
													/>{/if}
											</div>
											{#if r.sku}<div class="truncate text-xs text-muted-foreground">
													{r.sku}
												</div>{/if}
										{:else}
											<div class="flex min-w-0 items-center gap-1.5">
												<span class="truncate font-medium" title={r.productTitle}
													>{r.productTitle}</span
												>
												{#if r.isBundle}<StatusBadge
														tone="info"
														label="bundle · {r.bundleItems} items"
													/>{/if}
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
								title={fixedMode
									? `Price × 0.96 (4% COD tax) − cost`
									: r.piecesPerOrder
										? `Selling cost ${formatRs(r.perUnit)}/pc + ${formatPct(e.pct)} of price — orders with this product usually have ${r.piecesPerOrder} pieces`
										: `Selling cost ${formatRs(r.perUnit)}/pc + ${formatPct(e.pct)} of price (store-wide: few orders yet)`}
							>
								{#if r.profit !== null}
									<span class={['num font-medium', tone(r.margin)]}>{formatRs(r.profit)}</span>
									<div class={['text-xs', tone(r.margin)]}>{formatPct(r.margin ?? 0, 0)}</div>
									{#if !fixedMode && r.piecesPerOrder && r.piecesPerOrder !== Math.round(e.unitsPerOrder)}<div
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
									{#if np !== null && np !== r.price}
										<div class="grid text-xs leading-tight whitespace-nowrap">
											<span class={np < r.price ? 'font-medium text-danger' : 'text-success'}
												>{np < r.price ? '↓' : '↑'}
												{formatRs(Math.abs(np - r.price))}
												{np < r.price ? 'lower' : 'higher'}</span
											>
											{#if npProfit !== null}<span class={['num', tone(npProfit / np)]}
													>{formatRs(npProfit)} · {formatPct(npProfit / np, 0)}</span
												>{/if}
										</div>
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
		{@const lower = changes.filter((c) => c.price < c.r.price).length}
		{#if lower}
			<p class="mx-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
				{lower} of {changes.length} change{changes.length === 1 ? '' : 's'}
				{lower === 1 ? 'is a price decrease' : 'are price decreases'} (↓).
			</p>
		{/if}
		<div class="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto px-4 text-sm">
			{#each changes as c (c.r.id)}
				{@const after = c.r.cost > 0 ? profitAt(c.price, c.r.cost, c.r.perUnit) : null}
				<div class="flex min-w-0 items-center justify-between gap-3 border-b py-2">
					<div class="min-w-0 flex-1">
						<div class="truncate font-medium">{c.r.productTitle}</div>
						<div class="truncate text-xs text-muted-foreground">{c.r.variantTitle ?? ''}</div>
					</div>
					<div class="text-right whitespace-nowrap">
						<span class="text-muted-foreground line-through">{formatRs(c.r.price)}</span>
						<span class={['ml-1 font-medium', c.price < c.r.price ? 'text-danger' : 'text-success']}
							>{c.price < c.r.price ? '↓' : '↑'} {formatRs(c.price)}</span
						>
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

<Dialog.Root
	bind:open={costsOpen}
	onOpenChange={(v) => {
		if (!v) showCosts = false;
	}}
>
	<Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Cost of selling</Dialog.Title>
			<Dialog.Description>
				How suggested prices are worked out. Ads, salaries and rent are not included — the margin
				covers them.
			</Dialog.Description>
		</Dialog.Header>

		<!-- Mode -->
		<div class="grid grid-cols-2 gap-2">
			{#each [{ id: 'adjusting', title: 'Adjusting', sub: `Follows the last ${data.windowDays} days` }, { id: 'fixed', title: 'Fixed', sub: 'Cost × markup' }] as opt (opt.id)}
				{@const active = (data.settings.mode ?? 'adjusting') === opt.id}
				<form method="POST" action={formAction('mode')} use:enhance>
					<input type="hidden" name="mode" value={opt.id} />
					<button
						type="submit"
						class={[
							'w-full rounded-lg border px-3 py-2 text-left transition-colors',
							active ? 'border-primary bg-accent' : 'hover:bg-muted'
						]}
						aria-pressed={active}
					>
						<span class="block text-sm font-medium">{opt.title}</span>
						<span class="block text-xs text-muted-foreground">{opt.sub}</span>
					</button>
				</form>
			{/each}
		</div>

		<form
			method="POST"
			action={formAction('settings')}
			class="grid gap-4"
			use:enhance={() => {
				busy = 'settings';
				return async ({ update, result }) => {
					await update({ reset: false });
					busy = null;
					if (result.type === 'success') showCosts = false;
				};
			}}
		>
			{#snippet row(
				label: string,
				name: string,
				shown: string,
				value: string,
				hint: string,
				unit: 'rs' | 'pct' | 'n',
				tone = ''
			)}
				<div class="flex items-center justify-between gap-3 py-1.5">
					<span class="text-sm text-muted-foreground">{label}</span>
					{#if showCosts}
						<div class="flex items-center gap-1.5">
							<span class="w-5 text-right text-xs text-muted-foreground"
								>{unit === 'rs' ? 'Rs' : ''}</span
							>
							<Input
								id={name}
								{name}
								{value}
								placeholder={hint}
								inputmode="decimal"
								class="h-8 w-24 text-right"
							/>
							<span class="w-3 text-xs text-muted-foreground">{unit === 'pct' ? '%' : ''}</span>
						</div>
					{:else}
						<span class={['num text-sm font-medium', tone]}>{shown}</span>
					{/if}
				</div>
			{/snippet}

			{#if fixedMode}
				<div class="rounded-lg border px-4 py-2">
					{@render row(
						'Markup on cost',
						'multiplier',
						`${e.multiplier}×`,
						String(e.multiplier),
						'2.5',
						'n'
					)}
				</div>
				<div class="rounded-lg bg-muted/60 px-4 py-3 text-sm">
					<p class="font-medium">Suggested price = cost × {e.multiplier} ÷ 0.96, ending in 99</p>
					<p class="mt-1 text-xs text-muted-foreground">
						÷ 0.96 so you still keep cost × {e.multiplier} after PostEx withholds 4%. Advance orders get
						5% off instead, so the same allowance covers them. Courier and packaging are not counted —
						the Rs 500 minimum order covers them.
					</p>
					<div class="mt-3 grid grid-cols-3 gap-2 text-xs">
						{#each example as x (x.mult)}
							<div
								class={[
									'rounded-md border bg-card px-2 py-1.5',
									x.mult === e.multiplier && 'border-primary'
								]}
							>
								<div class="font-medium">{x.mult}×</div>
								<div class="text-muted-foreground">Cost Rs 1,000 → {formatRs(x.price * 100)}</div>
								<div class="text-success">Profit {formatRs(x.profit * 100)}</div>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="rounded-lg border px-4 py-2">
					{@render row(
						'Target margin',
						'targetMargin',
						formatPct(e.target, 0),
						pct(data.settings.targetMargin),
						'',
						'pct'
					)}
				</div>

				<div class="grid gap-1">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Per order</p>
					<div class="divide-y rounded-lg border px-4 py-1">
						{@render row(
							'Courier + returns',
							'courierPerOrder',
							formatRs(e.courierPerOrder),
							o.courierPerOrder !== undefined ? rs(o.courierPerOrder) : '',
							rs(m.courierPerOrder),
							'rs'
						)}
						{@render row(
							'Packaging',
							'packagingPerOrder',
							formatRs(e.packagingPerOrder),
							o.packagingPerOrder !== undefined ? rs(o.packagingPerOrder) : '',
							rs(m.packagingPerOrder),
							'rs'
						)}
						{@render row(
							'Shipping the customer pays',
							'shippingPerOrder',
							`−${formatRs(e.shippingPerOrder)}`,
							o.shippingPerOrder !== undefined ? rs(o.shippingPerOrder) : '',
							rs(m.shippingPerOrder),
							'rs',
							'text-success'
						)}
						<div class="flex items-center justify-between py-1.5 font-medium">
							<span class="text-sm">Net per order</span>
							<span class="num text-sm">{formatRs(e.perOrder)}</span>
						</div>
					</div>
				</div>

				<div class="grid gap-1">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						% of price
					</p>
					<div class="divide-y rounded-lg border px-4 py-1">
						{@render row(
							'Tax withheld by courier',
							'withholdingPct',
							formatPct(e.withholdingPct),
							o.withholdingPct !== undefined ? pct(o.withholdingPct) : '',
							pct(m.withholdingPct),
							'pct'
						)}
						{@render row(
							'5% advance discount',
							'advancePct',
							formatPct(e.advancePct),
							o.advancePct !== undefined ? pct(o.advancePct) : '',
							pct(m.advancePct),
							'pct'
						)}
						{@render row(
							'Other discounts',
							'otherDiscountPct',
							formatPct(e.otherDiscountPct),
							o.otherDiscountPct !== undefined ? pct(o.otherDiscountPct) : '',
							pct(m.otherDiscountPct),
							'pct'
						)}
						<div class="flex items-center justify-between py-1.5 font-medium">
							<span class="text-sm">Total</span>
							<span class="num text-sm">{formatPct(e.pct)}</span>
						</div>
					</div>
				</div>

				<div class="rounded-lg bg-muted/60 px-4 py-3">
					{@render row(
						'Pieces in a typical order',
						'unitsPerOrder',
						e.unitsPerOrder.toFixed(1),
						o.unitsPerOrder !== undefined ? String(o.unitsPerOrder) : '',
						m.unitsPerOrder.toFixed(1),
						'n'
					)}
					<div class="flex items-center justify-between gap-3 pt-1">
						<span class="text-sm font-medium">Selling cost per piece</span>
						<span class="num font-semibold"
							>{formatRs(e.perUnit)} + {formatPct(e.pct)} of price</span
						>
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						Products usually bought in bulk carry less per piece — each uses how many pieces its own
						orders have.
					</p>
				</div>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				{#if showCosts}
					<Button type="submit" disabled={!!busy}>{busy === 'settings' ? 'Saving…' : 'Save'}</Button
					>
					<Button type="button" variant="ghost" onclick={() => (showCosts = false)}>Cancel</Button>
					<span class="text-xs text-muted-foreground">
						{fixedMode ? 'e.g. 2, 2.5 or 3' : 'Empty box = measured value (hint).'}
					</span>
				{:else}
					<Button type="button" variant="outline" onclick={() => (showCosts = true)}
						>Edit numbers</Button
					>
				{/if}
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
