<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { ask } from '#lib/confirm.svelte.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import CopyCheck from '@lucide/svelte/icons/copy-check';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Thumb from '#lib/components/app/thumb.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Row = (typeof data.rows)[number];
	type Edit = { price: string; currency: 'RMB' | 'PKR'; ok: boolean; ddp: string; weight: string };

	let edits = $state<Record<string, Edit>>({});
	let busy = $state<string | null>(null);

	const dirty = $derived(Object.keys(edits).length);
	const fxRs = $derived(data.rates.rmbFx / 10_000);
	const ddpRs = $derived(data.rates.ddpPerKg / 100);
	const ratesSet = $derived(data.rates.rmbFx > 0 && data.rates.ddpPerKg > 0);
	const pct = $derived(data.progress.inStock ? Math.round((data.progress.costed / data.progress.inStock) * 100) : 100);

	const original = (r: Row): Edit => ({
		price: r.cnPrice === null ? '' : String(r.cnPrice / 100),
		currency: r.currency ?? 'RMB',
		ok: r.shopifyCostOk,
		ddp: r.ddp === null ? '' : String(r.ddp / 100),
		weight: r.weightG ? String(r.weightG) : ''
	});
	const cur = (r: Row): Edit => edits[r.id] ?? original(r);

	function set(r: Row, patch: Partial<Edit>) {
		const next = { ...cur(r), ...patch };
		const o = original(r);
		if (
			next.price.trim() === o.price &&
			next.currency === o.currency &&
			next.ok === o.ok &&
			next.ddp.trim() === o.ddp &&
			next.weight.trim() === o.weight
		)
			delete edits[r.id];
		else edits[r.id] = next;
	}
	const costChanged = (r: Row, e: Edit) => {
		const o = original(r);
		return e.price.trim() !== o.price || e.currency !== o.currency || e.ok !== o.ok || e.ddp.trim() !== o.ddp;
	};
	const weightG = (r: Row) => {
		const w = Number(cur(r).weight.replace(/,/g, ''));
		return Number.isFinite(w) && w > 0 ? w : 0;
	};

	/** Automatic DDP per piece (paisa): weight × rate; local (Rs) prices default to 0. */
	const autoDdp = (r: Row, e: Edit) => (e.currency === 'PKR' ? 0 : Math.round((weightG(r) / 1000) * ddpRs * 100));
	function ddpUsed(r: Row): number {
		const e = cur(r);
		const d = Number(e.ddp.replace(/,/g, ''));
		return e.ddp.trim() !== '' && Number.isFinite(d) ? Math.round(d * 100) : autoDdp(r, e);
	}
	function ddpHigh(r: Row): boolean {
		const e = cur(r);
		const p = Number(e.price.replace(/,/g, ''));
		if (!p || e.ddp.trim() !== '') return false;
		const goods = e.currency === 'PKR' ? p * 100 : p * fxRs * 100;
		return ddpUsed(r) > goods * 2;
	}
	function preview(r: Row): number | null {
		const e = cur(r);
		const p = Number(e.price.replace(/,/g, ''));
		if (e.price.trim() === '' || !Number.isFinite(p)) return null;
		if (e.currency === 'PKR') return Math.round(p * 100) + ddpUsed(r);
		if (!fxRs) return null;
		return Math.round(p * fxRs * 100) + ddpUsed(r);
	}
	function costUsed(r: Row): { cost: number; source: string } {
		const est = preview(r);
		if (est !== null) return { cost: est, source: 'estimated' };
		if (cur(r).ok && r.shopifyCost) return { cost: r.shopifyCost, source: 'shopify' };
		return { cost: 0, source: 'none' };
	}

	const siblings = (r: Row) => data.rows.filter((x) => x.productId === r.productId && x.id !== r.id);
	function copyToSiblings(r: Row, what: 'price' | 'weight') {
		const e = cur(r);
		for (const s of siblings(r))
			set(s, what === 'price' ? { price: e.price, currency: e.currency, ddp: e.ddp } : { weight: e.weight });
	}
	const firstOfProduct = (r: Row, i: number) => i === 0 || data.rows[i - 1].productId !== r.productId;

	const SOURCE: Record<string, { tone: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
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
		{ id: 'missing', label: `In stock, no cost (${data.counts.missing})` },
		{ id: 'noweight', label: `No weight (${data.counts.noweight})` },
		{ id: 'highddp', label: `High DDP (${data.counts.highddp})` },
		{ id: 'estimated', label: `Estimated (${data.counts.estimated})` },
		{ id: 'all', label: `All not yet purchased (${data.counts.all})` }
	]);

	// ── Spreadsheet-style entry ──
	let saveForm = $state<HTMLFormElement>();
	const COLS = ['weight', 'price', 'ddp'] as const;
	type Col = (typeof COLS)[number];
	function focusCell(row: number, col: string) {
		const el = document.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-col="${col}"]`);
		if (el) {
			el.focus();
			el.select();
		}
	}
	function gridKeys(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		const col = t.dataset?.col;
		if (!col) return;
		const row = Number(t.dataset.row);
		if (e.key === 'Enter' || e.key === 'ArrowDown') {
			e.preventDefault();
			focusCell(e.shiftKey && e.key === 'Enter' ? row - 1 : row + 1, col);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusCell(row - 1, col);
		}
	}
	/** Paste from Excel: lines fill down from this row; tab-separated cells fill across (weight → price → DDP). */
	function gridPaste(e: ClipboardEvent) {
		const t = e.target as HTMLElement;
		const col = t.dataset?.col as Col | undefined;
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!col || !/[\t\n]/.test(text.trim())) return; // single value: normal paste
		e.preventDefault();
		const start = Number(t.dataset.row);
		const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
		const first = COLS.indexOf(col);
		lines.forEach((line, k) => {
			const r = data.rows[start + k];
			if (!r) return;
			line.split('\t').forEach((raw, j) => {
				const c = COLS[first + j];
				if (!c) return;
				const val = raw.trim().replace(/[^0-9.,-]/g, '');
				if (c === 'price') set(r, { price: val });
				else if (c === 'weight') set(r, { weight: val });
				else set(r, { ddp: val });
			});
		});
		focusCell(Math.min(start + lines.length, data.rows.length - 1), col);
	}

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
			<a href="/inventory?m={page.url.searchParams.get('m') ?? ''}" class="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
				><ArrowLeft class="size-3.5" /> Inventory</a
			>
			<h1 class="text-2xl font-semibold tracking-tight">Opening costs</h1>
			<p class="text-sm text-muted-foreground">
				Costs for stock you had before the panel. Products drop off this list once a purchase gives them a real cost.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" href="/inventory/costs.csv" data-sveltekit-reload><Download /> Download sheet</Button>
			<form method="POST" action={formAction('upload')} enctype="multipart/form-data" use:enhance={act('upload')}>
				<label class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-muted">
					<Upload class="size-4" />
					{busy === 'upload' ? 'Importing…' : 'Upload filled sheet'}
					<input type="file" name="file" accept=".csv,.xlsx" class="sr-only" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
				</label>
			</form>
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
		<Card.Root size="sm">
			<Card.Content class="grid gap-2">
				<div class="flex items-baseline justify-between gap-3 text-sm">
					<span><b class="num">{data.progress.costed}</b> of <b class="num">{data.progress.inStock}</b> in-stock products have a cost</span>
					<span class={['num font-medium', pct === 100 ? 'text-success' : 'text-muted-foreground']}>{pct}%</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-muted">
					<div class="h-full rounded-full bg-success transition-[width]" style:width="{pct}%"></div>
				</div>
			</Card.Content>
		</Card.Root>
		<Card.Root size="sm">
			<Card.Content>
				<form method="POST" action={formAction('rates')} use:enhance={act('rates')} class="flex flex-wrap items-end gap-3">
					<div class="grid gap-1.5">
						<Label for="fx">Rs per 1 yuan</Label>
						<Input id="fx" name="fx" inputmode="decimal" class="w-28" value={fxRs || ''} placeholder="e.g. 44.2" />
					</div>
					<div class="grid gap-1.5">
						<Label for="ddp">DDP Rs per kg</Label>
						<Input id="ddp" name="ddp" inputmode="decimal" class="w-28" value={ddpRs || ''} placeholder="e.g. 3400" />
					</div>
					<Button type="submit" variant="outline" disabled={!!busy}>{busy === 'rates' ? 'Saving…' : 'Save rates'}</Button>
				</form>
				{#if !ratesSet}<p class="mt-2 text-xs text-warning">Set both rates — yuan prices can't be costed without them.</p>{/if}
			</Card.Content>
		</Card.Root>
	</div>

	{#if !data.openingRecorded}
		<div class="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-soft px-4 py-2.5 text-sm text-info">
			<span>Opening stock not recorded yet — today's Shopify on-hand ({data.units.toLocaleString('en-PK')} units) becomes the starting point. Done once.</span>
			<form
				method="POST"
				action={formAction('opening')}
				class="ml-auto"
				use:enhance={async ({ cancel }) => {
					const ok = await ask({
						title: 'Record opening stock?',
						description: `Today's Shopify on-hand (${data.units.toLocaleString('en-PK')} units) becomes the starting point of the stock ledger. This is done once.`,
						confirmLabel: 'Record opening stock'
					});
					if (!ok) return cancel();
					return act('opening')();
				}}
			>
				<Button type="submit" size="sm" variant="outline" disabled={!!busy}>Record opening stock</Button>
			</form>
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
			<Card.Description>
				Buying price per piece (¥ from China, Rs from Pakistan). Enter/↓ = next row · paste a column from
				Excel to fill down · Ctrl+S saves. Weight is saved to Shopify too. DDP / pc = weight × DDP rate unless you type one —
				“Local” = 0 for items bought in Pakistan; amber = DDP above 2× the goods cost.
			</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<!-- Spreadsheet-style entry: Enter/↓/↑ move between rows, paste from Excel fills down/across. -->
			<div role="presentation" onkeydown={gridKeys} onpaste={gridPaste}>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Product</Table.Head>
						<Table.Head class="text-right">On hand</Table.Head>
						<Table.Head>Weight (g)</Table.Head>
						<Table.Head>Buying price</Table.Head>
						<Table.Head>DDP / pc</Table.Head>
						<Table.Head class="text-right">Cost</Table.Head>
						<Table.Head class="pr-6 text-right">Stock value</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r, i (r.id)}
						{@const e = cur(r)}
						{@const used = costUsed(r)}
						<Table.Row class={edits[r.id] ? 'bg-warning-soft/40' : ''}>
							<Table.Cell class="max-w-72 pl-6">
								<div class="flex items-center gap-3">
									<Thumb src={r.imageUrl} alt={`${r.productTitle} ${r.variantTitle ?? ''}`} />
									<div class="min-w-0">
										<div class={['truncate', firstOfProduct(r, i) ? 'font-medium' : 'text-muted-foreground']}>{r.productTitle}</div>
										<div class="truncate text-xs text-muted-foreground">{r.variantTitle ?? ''}{r.variantTitle && r.sku ? ' · ' : ''}{r.sku ?? ''}</div>
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">{r.onHand ?? 0}</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-1">
									<Input
										value={e.weight}
										oninput={(ev) => set(r, { weight: ev.currentTarget.value })}
										inputmode="numeric"
										placeholder="g"
										class={['h-8 w-20 text-right', !e.weight && 'border-danger/60']}
										aria-label="Weight in grams"
										data-col="weight"
										data-row={i}
										onfocus={(ev) => ev.currentTarget.select()}
									/>
									{#if e.weight && siblings(r).length && firstOfProduct(r, i)}
										<Button size="icon-sm" variant="ghost" title="Same weight for all variants" onclick={() => copyToSiblings(r, 'weight')}><CopyCheck /></Button>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-1">
									<Input
										value={e.price}
										oninput={(ev) => set(r, { price: ev.currentTarget.value })}
										inputmode="decimal"
										class="h-8 w-24 text-right"
										aria-label="Buying price for {r.productTitle} {r.variantTitle ?? ''}"
										data-col="price"
										data-row={i}
										onfocus={(ev) => ev.currentTarget.select()}
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
									{#if e.price && siblings(r).length && firstOfProduct(r, i)}
										<Button size="icon-sm" variant="ghost" title="Same price for all variants" onclick={() => copyToSiblings(r, 'price')}><CopyCheck /></Button>
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
											data-col="ddp"
											data-row={i}
											onfocus={(ev) => ev.currentTarget.select()}
										/>
										{#if e.ddp.trim() !== '0'}
											<Button size="xs" variant="ghost" onclick={() => set(r, { ddp: '0' })}>Local</Button>
										{:else}
											<Button size="xs" variant="ghost" onclick={() => set(r, { ddp: '' })}>Auto</Button>
										{/if}
									</div>
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={used.cost} muted />
								<div class="mt-0.5"><StatusBadge tone={SOURCE[used.source].tone} label={SOURCE[used.source].label} /></div>
							</Table.Cell>
							<Table.Cell class="pr-6 text-right"><Money paisa={Math.max(0, r.onHand ?? 0) * used.cost} muted /></Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={7} class="py-10 text-center text-muted-foreground">Nothing here — well done.</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
			</div>
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

<svelte:window
	onkeydown={(e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			if (dirty && !busy) saveForm?.requestSubmit();
		}
	}}
/>

{#if dirty}
	<form
		method="POST"
		action={formAction('save')}
		bind:this={saveForm}
		use:enhance={act('save', () => (edits = {}))}
		class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur md:left-(--sidebar-width)"
	>
		<input
			type="hidden"
			name="rows"
			value={JSON.stringify(
				Object.entries(edits).map(([id, x]) => {
					const row = data.rows.find((r) => r.id === id);
					return {
						id,
						...x,
						costChanged: row ? costChanged(row, x) : true,
						weightChanged: row ? x.weight.trim() !== (row.weightG ? String(row.weightG) : '') : false
					};
				})
			)}
		/>
		<span class="text-sm text-muted-foreground">{dirty} unsaved change{dirty === 1 ? '' : 's'}</span>
		<Button type="button" variant="ghost" onclick={() => (edits = {})}>Discard</Button>
		<Button type="submit" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
	</form>
{/if}
