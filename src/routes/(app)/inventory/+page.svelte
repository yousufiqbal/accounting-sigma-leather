<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { ask } from '#lib/confirm.svelte.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import CopyCheck from '@lucide/svelte/icons/copy-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Thumb from '#lib/components/app/thumb.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Row = (typeof data.rows)[number];
	type Edit = { price: string; currency: 'RMB' | 'PKR'; ok: boolean; ddp: string };

	let edits = $state<Record<string, Edit>>({});
	let busy = $state<string | null>(null);
	let picked = $state<string[]>([]);
	let changesOpen = $state(false);
	let ratesOpen = $state(false);
	const REASONS = [
		{ id: 'returned', label: 'Returned to stock', cost: false },
		{ id: 'damaged', label: 'Damaged', cost: true },
		{ id: 'missing', label: 'Missing / lost', cost: true },
		{ id: 'count', label: 'Lost in recount', cost: true },
		{ id: 'ignore', label: 'Count was wrong (no cost)', cost: false }
	] as const;

	const dirty = $derived(Object.keys(edits).length);
	const fxRs = $derived(data.rates.rmbFx / 10_000);
	const ddpRs = $derived(data.rates.ddpPerKg / 100);
	const ratesSet = $derived(data.rates.rmbFx > 0 && data.rates.ddpPerKg > 0);

	const original = (r: Row): Edit => ({
		price: r.cnPrice === null ? '' : String(r.cnPrice / 100),
		currency: r.currency ?? 'RMB',
		ok: r.shopifyCostOk,
		ddp: r.ddp === null ? '' : String(r.ddp / 100)
	});
	const cur = (r: Row): Edit => edits[r.id] ?? original(r);

	function set(r: Row, patch: Partial<Edit>) {
		const next = { ...cur(r), ...patch };
		const o = original(r);
		if (
			next.price.trim() === o.price &&
			next.currency === o.currency &&
			next.ok === o.ok &&
			next.ddp.trim() === o.ddp
		)
			delete edits[r.id];
		else edits[r.id] = next;
	}

	/** Automatic DDP per piece (paisa): weight × rate; local (Rs) prices default to 0. */
	const autoDdp = (r: Row, e: Edit) =>
		e.currency === 'PKR' ? 0 : Math.round(((r.weightG ?? 0) / 1000) * ddpRs * 100);
	/** DDP per piece used (paisa): override if typed, else automatic. */
	function ddpUsed(r: Row): number {
		const e = cur(r);
		const d = Number(e.ddp.replace(/,/g, ''));
		return e.ddp.trim() !== '' && Number.isFinite(d) ? Math.round(d * 100) : autoDdp(r, e);
	}
	/** DDP looks high: more than 2× the goods cost. */
	function ddpHigh(r: Row): boolean {
		const e = cur(r);
		const p = Number(e.price.replace(/,/g, ''));
		if (!p || e.ddp.trim() !== '') return false;
		const goods = e.currency === 'PKR' ? p * 100 : p * fxRs * 100;
		return ddpUsed(r) > goods * 2;
	}

	/** Live preview of the estimate in paisa (null = no price). */
	function preview(r: Row): number | null {
		const e = cur(r);
		const p = Number(e.price.replace(/,/g, ''));
		if (e.price.trim() === '' || !Number.isFinite(p)) return null;
		if (e.currency === 'PKR') return Math.round(p * 100) + ddpUsed(r);
		if (!fxRs) return null;
		return Math.round(p * fxRs * 100) + ddpUsed(r);
	}

	/** Cost that will be used after saving. */
	function costUsed(r: Row): { cost: number; source: string } {
		if (r.costSource === 'batch') return { cost: r.avgCost, source: 'batch' };
		const est = preview(r);
		if (est !== null) return { cost: est, source: 'estimated' };
		if (cur(r).ok && r.shopifyCost) return { cost: r.shopifyCost, source: 'shopify' };
		return { cost: 0, source: 'none' };
	}

	const siblings = (r: Row) =>
		data.rows.filter((x) => x.productId === r.productId && x.id !== r.id);
	function copyToSiblings(r: Row) {
		const e = cur(r);
		for (const s of siblings(r)) set(s, { price: e.price, currency: e.currency, ddp: e.ddp });
	}
	const firstOfProduct = (r: Row, i: number) => i === 0 || data.rows[i - 1].productId !== r.productId;

	const SOURCE: Record<string, { tone: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
		batch: { tone: 'success', label: 'from purchase' },
		estimated: { tone: 'warning', label: 'estimated' },
		shopify: { tone: 'info', label: 'Shopify cost' },
		none: { tone: 'danger', label: 'missing' }
	};

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
		{ id: 'highddp', label: `High DDP (${data.counts.highddp})` },
		{ id: 'all', label: `All (${data.counts.all})` }
	]);

	const s = $derived(data.summary);

	/** enhance helper: busy flag, keep inputs. */
	const act =
		(name: string, after?: () => void) =>
		() => {
			busy = name;
			return async ({ update, result }: { update: (o?: { reset?: boolean }) => Promise<void>; result: { type: string } }) => {
				await update({ reset: false });
				busy = null;
				if (result.type === 'success') after?.();
			};
		};
</script>

<div class="grid gap-6 pb-20">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Inventory</h1>
			<p class="text-sm text-muted-foreground">
				Estimates: ¥1 = Rs {fxRs || '—'} · DDP Rs {ddpRs ? ddpRs.toLocaleString('en-PK') : '—'}/kg ·
				<button type="button" class="underline underline-offset-2 hover:text-foreground" onclick={() => (ratesOpen = true)}>Change</button>
				{#if !ratesSet}<span class="text-warning"> — set both rates, yuan prices can't be costed without them</span>{/if}
				{#if !data.openingRecorded}<span class="text-warning"> · opening stock not recorded</span>{/if}
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<form method="POST" action={formAction('refresh')} use:enhance={act('refresh')}>
				<Button type="submit" variant="outline" disabled={!!busy}>
					<RefreshCw class={busy === 'refresh' ? 'animate-spin' : ''} />
					{busy === 'refresh' ? 'Pulling…' : 'Pull from Shopify'}
				</Button>
			</form>
			<Button variant="outline" href="/inventory/costs.csv" data-sveltekit-reload>
				<Download /> Download sheet
			</Button>
			<form
				method="POST"
				action={formAction('upload')}
				enctype="multipart/form-data"
				use:enhance={act('upload')}
				class="flex gap-2"
			>
				<label
					class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent"
				>
					<Upload class="size-4" />
					{busy === 'upload' ? 'Importing…' : 'Upload filled sheet'}
					<input
						type="file"
						name="file"
						accept=".csv,.xlsx"
						class="sr-only"
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					/>
				</label>
			</form>
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
		<span class={s.missing ? 'text-danger' : ''}>
			{s.missing} in-stock variants have no cost ({Number(s.missingUnits).toLocaleString('en-PK')} units not valued)
		</span>
		<span>{s.value ? formatPct(Number(s.estimatedValue) / Number(s.value)) : '—'} of warehouse value is estimated</span>
	</div>

	{#if data.changes.length}
		<div class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
			<span>
				<b>{data.changes.length}</b> stock change{data.changes.length === 1 ? '' : 's'} made in Shopify need a reason
				(returned, damaged, missing…).
			</span>
			<Button size="sm" variant="outline" class="ml-auto" onclick={() => (changesOpen = true)}>Review</Button>
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
				<form method="GET" class="ml-auto" data-sveltekit-keepfocus>
					{#each [...page.url.searchParams].filter(([k]) => k !== 'q' && k !== 'page') as [k, val] (k)}
						<input type="hidden" name={k} value={val} />
					{/each}
					<Input name="q" value={data.q} placeholder="Product or SKU" class="h-8 w-44" />
				</form>
			</div>
			<Card.Description>
				Type the China price per piece. DDP / pc is weight × DDP rate unless you type one — “Local” sets 0
				for items bought in Pakistan; amber = DDP above 2× the goods cost. Tick “correct” if the Shopify
				cost is already the full landed cost. Most stock first.
				{#if data.view === 'noweight'}Weights are edited in Shopify, then “Pull from Shopify”.{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Product</Table.Head>
						<Table.Head class="text-right">On hand</Table.Head>
						<Table.Head class="text-right">Weight</Table.Head>
						<Table.Head class="text-right">Shopify cost</Table.Head>
						<Table.Head>China price</Table.Head>
						<Table.Head>DDP / pc</Table.Head>
						<Table.Head class="text-right">Cost used</Table.Head>
						<Table.Head class="pr-6 text-right">Stock value</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r, i (r.id)}
						{@const e = cur(r)}
						{@const used = costUsed(r)}
						<Table.Row class={[edits[r.id] && 'bg-warning-soft/40', r.status !== 'ACTIVE' && 'opacity-60']}>
							<Table.Cell class="max-w-80 pl-6">
								<div class="flex items-center gap-3">
									<Thumb src={r.imageUrl} alt={`${r.productTitle} ${r.variantTitle ?? ''}`} />
									<div class="min-w-0">
										<div class={['truncate', firstOfProduct(r, i) ? 'font-medium' : 'text-muted-foreground']}>
											{r.productTitle}
										</div>
										<div class="truncate text-xs text-muted-foreground">
											{r.variantTitle ?? ''}{r.variantTitle && r.sku ? ' · ' : ''}{r.sku ?? ''}
											{#if r.status !== 'ACTIVE'}· {r.status?.toLowerCase()}{/if}
										</div>
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">{r.onHand ?? 0}</Table.Cell>
							<Table.Cell class="num text-right">
								{#if r.weightG}{r.weightG} g{:else}<span class="text-danger">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if r.shopifyCost}
									<Money paisa={r.shopifyCost} />
									<label class="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
										<input
											type="checkbox"
											checked={e.ok}
											onchange={(ev) => set(r, { ok: ev.currentTarget.checked })}
										/> correct
									</label>
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-1">
									<Input
										value={e.price}
										oninput={(ev) => set(r, { price: ev.currentTarget.value })}
										inputmode="decimal"
										class="h-8 w-24 text-right"
										aria-label="China price for {r.productTitle} {r.variantTitle ?? ''}"
									/>
									<select
										class="h-8 rounded-md border bg-background px-1.5 text-sm"
										value={e.currency}
										onchange={(ev) => set(r, { currency: ev.currentTarget.value as 'RMB' | 'PKR' })}
										aria-label="Currency"
									>
										<option value="RMB">¥</option>
										<option value="PKR">Rs</option>
									</select>
									{#if e.price && siblings(r).length}
										<Button
											size="icon-sm"
											variant="ghost"
											title="Same price for all {siblings(r).length + 1} variants of this product"
											onclick={() => copyToSiblings(r)}><CopyCheck /></Button
										>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								{#if e.price}
									<div class="flex items-center gap-1">
										<Input
											value={e.ddp}
											oninput={(ev) => set(r, { ddp: ev.currentTarget.value })}
											placeholder={(autoDdp(r, e) / 100).toFixed(0)}
											inputmode="decimal"
											title="Blank = weight × DDP rate. Type 0 for locally bought items."
											class={['h-8 w-20 text-right', ddpHigh(r) && 'border-warning text-warning placeholder:text-warning']}
											aria-label="DDP per piece"
										/>
										{#if e.ddp.trim() !== '0'}
											<Button size="xs" variant="ghost" title="Bought locally — no DDP" onclick={() => set(r, { ddp: '0' })}>Local</Button>
										{:else}
											<Button size="xs" variant="ghost" title="Back to weight × DDP rate" onclick={() => set(r, { ddp: '' })}>Auto</Button>
										{/if}
									</div>
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={used.cost} muted />
								<div class="mt-0.5"><StatusBadge tone={SOURCE[used.source].tone} label={SOURCE[used.source].label} /></div>
							</Table.Cell>
							<Table.Cell class="pr-6 text-right">
								<Money paisa={Math.max(0, r.onHand ?? 0) * used.cost} muted />
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
								Nothing here.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		{#if data.pageCount > 1}
			<Card.Footer class="flex items-center justify-between text-sm text-muted-foreground">
				<span>{data.totalRows} variants · page {data.page} of {data.pageCount}</span>
				<div class="flex gap-2">
					<Button size="sm" variant="outline" href={href({ page: data.page - 1 })} disabled={data.page <= 1}
						>Previous</Button
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

{#if dirty}
	<form
		method="POST"
		action={formAction('save')}
		use:enhance={act('save', () => (edits = {}))}
		class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur md:left-(--sidebar-width)"
	>
		<input
			type="hidden"
			name="rows"
			value={JSON.stringify(Object.entries(edits).map(([id, x]) => ({ id, ...x })))}
		/>
		<span class="text-sm text-muted-foreground">{dirty} unsaved change{dirty === 1 ? '' : 's'}</span>
		<Button type="button" variant="ghost" onclick={() => (edits = {})}>Discard</Button>
		<Button type="submit" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save costs'}</Button>
	</form>
{/if}

<Sheet.Root bind:open={changesOpen}>
	<Sheet.Content side="right" class="w-full sm:max-w-2xl">
		<Sheet.Header>
			<Sheet.Title>Stock changes made in Shopify</Sheet.Title>
			<Sheet.Description>
				Changes not explained by orders — returns put back, damaged or missing items, recounts. Damaged,
				missing and count fixes go to the income statement as inventory write-offs (qty × cost).
				{#if data.lastStockCheck}Last check {new Date(data.lastStockCheck).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}.{/if}
			</Sheet.Description>
		</Sheet.Header>
		{#if data.changes.length}
			<div class="overflow-auto">
				<form method="POST" action={formAction('classify')} use:enhance={act('classify', () => ((picked = []), (changesOpen = data.changes.length > 0)))}>
					<div class="flex flex-wrap items-center gap-2 border-y bg-muted/40 py-2">
						<span class="text-sm text-muted-foreground">{picked.length} selected</span>
						<Button type="button" size="xs" variant="ghost" onclick={() => (picked = data.changes.filter((c) => c.qty > 0).map((c) => c.id))}>Select all +</Button>
						<Button type="button" size="xs" variant="ghost" onclick={() => (picked = data.changes.filter((c) => c.qty < 0).map((c) => c.id))}>Select all −</Button>
						<span class="ml-auto flex flex-wrap gap-1">
							{#each REASONS as r (r.id)}
								<Button type="submit" name="reason" value={r.id} size="xs" variant={r.cost ? 'outline' : 'secondary'} disabled={!picked.length || !!busy}>{r.label}</Button>
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
			<p class="px-4 text-sm text-muted-foreground">Nothing to review.</p>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={ratesOpen}>
	<Sheet.Content side="right">
		<Sheet.Header>
			<Sheet.Title>Estimate rates</Sheet.Title>
			<Sheet.Description>Used to cost stock you already had (China price × rate + weight × DDP). New purchases carry their own rates.</Sheet.Description>
		</Sheet.Header>
		<div class="grid gap-6 px-4">
				<form
					method="POST"
					action={formAction('rates')}
					use:enhance={act('rates', () => (ratesOpen = false))}
					class="flex flex-wrap items-end gap-3"
				>
					<div class="grid gap-1.5">
						<Label for="fx">Rs per 1 yuan</Label>
						<Input
							id="fx"
							name="fx"
							inputmode="decimal"
							class="w-32"
							value={fxRs || ''}
							placeholder="e.g. 39.5"
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="ddp">DDP Rs per kg</Label>
						<Input
							id="ddp"
							name="ddp"
							inputmode="decimal"
							class="w-32"
							value={ddpRs || ''}
							placeholder="e.g. 1450"
						/>
					</div>
					<Button type="submit" disabled={!!busy}>{busy === 'rates' ? 'Saving…' : 'Save rates'}</Button>
				</form>
				{#if !ratesSet}
					<p class="mt-3 text-sm text-warning">Set both rates — yuan prices can't be costed without them.</p>
				{/if}
			{#if !data.openingRecorded}
				<div class="grid gap-2 border-t pt-4">
					<p class="text-sm font-medium">Opening stock</p>
					<p class="text-sm text-muted-foreground">
						Records today's Shopify on-hand ({Number(s.units).toLocaleString('en-PK')} units) as the starting point. Done once; costs can be filled in afterwards.
					</p>
					<form
						method="POST"
						action={formAction('opening')}
						use:enhance={async ({ cancel }) => {
							const ok = await ask({
								title: 'Record opening stock?',
								description: `Today's Shopify on-hand (${Number(s.units).toLocaleString('en-PK')} units) becomes the starting point of the stock ledger. This is done once.`,
								confirmLabel: 'Record opening stock'
							});
							if (!ok) return cancel();
							return act('opening')();
						}}
					>
						<Button type="submit" variant="outline" disabled={!!busy}>Record opening stock</Button>
					</form>
				</div>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
