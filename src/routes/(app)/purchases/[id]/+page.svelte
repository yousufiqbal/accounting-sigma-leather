<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Trash from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Line = (typeof data.lines)[number];
	type Edit = { qty: string; price: string; weight: string };

	const b = $derived(data.batch);
	const locked = $derived(b.status === 'landed');
	const isRmb = $derived(b.currency !== 'PKR');
	const sym = $derived(isRmb ? '¥' : 'Rs');
	const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

	let edits = $state<Record<string, Edit>>({});
	let busy = $state<string | null>(null);
	let showPaste = $state(false);
	const dirty = $derived(Object.keys(edits).length);

	const original = (l: Line): Edit => ({
		qty: String(l.qty),
		price: String(l.unitPriceForeignMinor / 100),
		weight: String(l.unitWeightG)
	});
	const cur = (l: Line) => edits[l.id] ?? original(l);
	function set(l: Line, patch: Partial<Edit>) {
		const next = { ...cur(l), ...patch };
		const o = original(l);
		if (next.qty === o.qty && next.price === o.price && next.weight === o.weight) delete edits[l.id];
		else edits[l.id] = next;
	}

	const STATUS = {
		draft: { tone: 'muted', label: 'draft' },
		paid: { tone: 'info', label: 'paid · on the way' },
		landed: { tone: 'success', label: 'landed' }
	} as const;

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
				await update({ reset: name === 'add' || name === 'paste' || name === 'cost' });
				busy = null;
				if (result.type === 'success') after?.();
			};
		};
</script>

<div class="grid gap-6 pb-20">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<a href="/purchases" class="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
				><ArrowLeft class="size-3.5" /> Purchases</a
			>
			<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
				{b.ref}
				<StatusBadge tone={STATUS[b.status].tone} label={STATUS[b.status].label} />
			</h1>
			<p class="text-sm text-muted-foreground">
				{b.supplier ?? 'No supplier'} ·
				{isRmb ? `¥1 = Rs ${b.fxRateX10000 / 10_000}` : 'Pakistani supplier (Rs)'} · DDP {formatRs(b.ddpRatePerKg)}/kg
				{#if b.paidOn}· paid {b.paidOn}{/if}
				{#if b.landedOn}· landed {b.landedOn}{/if}
			</p>
		</div>
		{#if !locked}
			<div class="flex flex-wrap items-end gap-2">
				{#if b.status === 'draft'}
					<form method="POST" action={formAction('paid')} use:enhance={act('paid')} class="flex items-end gap-2">
						<Input type="date" name="date" value={today} class="h-9 w-40" aria-label="Paid on" />
						<Button type="submit" variant="outline" disabled={!!busy}>Mark paid</Button>
					</form>
				{/if}
				<form
					method="POST"
					action={formAction('land')}
					class="flex items-end gap-2"
					use:enhance={({ cancel }) => {
						if (dirty) {
							alert('Save or discard your item changes first.');
							return cancel();
						}
						if (
							!confirm(
								`Land "${b.ref}"?\n\nThis ADDS ${data.totals.units} units to Shopify stock and updates the cost per item in Shopify. It cannot be undone from here.`
							)
						)
							return cancel();
						return act('land')();
					}}
				>
					<Input type="date" name="date" value={today} class="h-9 w-40" aria-label="Arrived on" />
					<Button type="submit" disabled={!!busy || !data.lines.length}>
						{busy === 'land' ? 'Landing…' : 'Arrived — add to stock'}
					</Button>
				</form>
			</div>
		{/if}
	</div>

	{#if form && 'error' in form && form.error}
		<div class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
			<TriangleAlert class="mt-0.5 size-4 shrink-0" />{form.error}
		</div>
	{/if}
	{#if form && 'saved' in form && form.saved}
		<div class="rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success" role="status">
			{form.saved}
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3 md:grid-cols-5">
		<Stat label="Units">{data.totals.units.toLocaleString('en-PK')}</Stat>
		<Stat label="Weight">{(data.totals.weightG / 1000).toFixed(1)} kg</Stat>
		<Stat label="Goods">{formatRs(data.totals.goods)}</Stat>
		<Stat label="DDP + other costs">{formatRs(data.totals.ddp + data.totals.extra)}</Stat>
		<Stat label="Landed total">{formatRs(data.totals.landed)}</Stat>
	</div>

	<Card.Root>
		<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
			<div>
				<Card.Title>Items</Card.Title>
				<Card.Description>
					Landed per piece = price{isRmb ? ' × rate' : ''} + weight × DDP + share of other costs (by value).
				</Card.Description>
			</div>
			{#if !locked}
				<Button size="sm" variant="ghost" onclick={() => (showPaste = !showPaste)}>
					{showPaste ? 'Close paste' : 'Paste many lines'}
				</Button>
			{/if}
		</Card.Header>
		{#if !locked}
			<Card.Content class="grid gap-3">
				<form method="POST" action={formAction('add')} use:enhance={act('add')} class="flex flex-wrap items-end gap-2">
					<div class="grid min-w-72 flex-1 gap-1.5">
						<Label for="variant">Product</Label>
						<Input id="variant" name="variant" list="variant-options" placeholder="Type name or SKU…" autocomplete="off" />
						<datalist id="variant-options">
							{#each data.options as o (o.id)}<option value="{o.label} [{o.id}]"></option>{/each}
						</datalist>
					</div>
					<div class="grid gap-1.5">
						<Label for="qty">Qty</Label>
						<Input id="qty" name="qty" inputmode="numeric" class="w-20" />
					</div>
					<div class="grid gap-1.5">
						<Label for="price">Price / piece ({sym})</Label>
						<Input id="price" name="price" inputmode="decimal" class="w-28" />
					</div>
					<Button type="submit" variant="outline" disabled={!!busy}>Add</Button>
				</form>
				{#if showPaste}
					<form method="POST" action={formAction('paste')} use:enhance={act('paste', () => (showPaste = false))} class="grid gap-2">
						<Textarea
							name="lines"
							rows={6}
							class="font-mono text-sm"
							placeholder={'SKU, qty, price — one per line (copy from Excel works)\nSL-WALLET-BLK, 50, 18.5'}
						/>
						<div><Button type="submit" size="sm" disabled={!!busy}>Add lines</Button></div>
					</form>
				{/if}
			</Card.Content>
		{/if}
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Product</Table.Head>
						<Table.Head class="text-right">Qty</Table.Head>
						<Table.Head class="text-right">Price ({sym})</Table.Head>
						<Table.Head class="text-right">Weight (g)</Table.Head>
						<Table.Head class="text-right">Goods</Table.Head>
						<Table.Head class="text-right">DDP</Table.Head>
						<Table.Head class="text-right">Other</Table.Head>
						<Table.Head class="text-right">Landed / pc</Table.Head>
						<Table.Head class="text-right">{locked ? 'Cost before' : 'Current cost'}</Table.Head>
						<Table.Head class="pr-6 text-right">Line total</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.lines as l (l.id)}
						{@const e = cur(l)}
						<Table.Row class={edits[l.id] ? 'bg-warning-soft/40' : ''}>
							<Table.Cell class="max-w-72 pl-6">
								<div class="truncate font-medium">{l.variant?.productTitle ?? 'Deleted product'}</div>
								<div class="truncate text-xs text-muted-foreground">
									{l.variant?.variantTitle ?? ''}{l.variant?.variantTitle && l.variant?.sku ? ' · ' : ''}{l.variant?.sku ?? ''}
								</div>
							</Table.Cell>
							{#if locked}
								<Table.Cell class="num text-right">{l.qty}</Table.Cell>
								<Table.Cell class="num text-right">{(l.unitPriceForeignMinor / 100).toLocaleString('en-PK')}</Table.Cell>
								<Table.Cell class="num text-right">{l.unitWeightG}</Table.Cell>
							{:else}
								<Table.Cell class="text-right">
									<Input value={e.qty} oninput={(ev) => set(l, { qty: ev.currentTarget.value })} inputmode="numeric" class="ml-auto h-8 w-16 text-right" aria-label="Quantity" />
								</Table.Cell>
								<Table.Cell class="text-right">
									<Input value={e.price} oninput={(ev) => set(l, { price: ev.currentTarget.value })} inputmode="decimal" class="ml-auto h-8 w-20 text-right" aria-label="Price" />
								</Table.Cell>
								<Table.Cell class="text-right">
									<Input
										value={e.weight}
										oninput={(ev) => set(l, { weight: ev.currentTarget.value })}
										inputmode="numeric"
										class={['ml-auto h-8 w-20 text-right', !l.unitWeightG && 'border-danger']}
										aria-label="Weight in grams"
									/>
								</Table.Cell>
							{/if}
							<Table.Cell class="text-right"><Money paisa={l.goods} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={l.ddp} muted /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={l.extra} muted /></Table.Cell>
							<Table.Cell class="text-right font-medium"><Money paisa={l.landed} /></Table.Cell>
							<Table.Cell class="text-right text-muted-foreground">
								{#if !locked && l.variant}<Money paisa={l.variant.avgCost} muted />{:else}—{/if}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right">
								<div class="flex items-center justify-end gap-1">
									<Money paisa={l.landed * l.qty} />
									{#if !locked}
										<form method="POST" action={formAction('remove')} use:enhance={act('remove')}>
											<input type="hidden" name="itemId" value={l.id} />
											<Button type="submit" size="icon-sm" variant="ghost" aria-label="Remove"><Trash /></Button>
										</form>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={10} class="py-10 text-center text-muted-foreground">No items yet.</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<div class="grid gap-4 lg:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>Other costs</Card.Title>
				<Card.Description>Local cartage, customs extras… shared across items by value. DDP is per kg above.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3">
				{#each data.costs as c (c.id)}
					<div class="flex items-center justify-between gap-2 text-sm">
						<span>{c.type === 'local_cartage' ? 'Local cartage' : 'Other'}{c.note ? ` · ${c.note}` : ''}</span>
						<span class="flex items-center gap-1">
							<Money paisa={c.amount} />
							{#if !locked}
								<form method="POST" action={formAction('removeCost')} use:enhance={act('removeCost')}>
									<input type="hidden" name="costId" value={c.id} />
									<Button type="submit" size="icon-sm" variant="ghost" aria-label="Remove"><Trash /></Button>
								</form>
							{/if}
						</span>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">None.</p>
				{/each}
				{#if !locked}
					<form method="POST" action={formAction('addCost')} use:enhance={act('cost')} class="flex flex-wrap items-end gap-2">
						<select name="type" class="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Type">
							<option value="local_cartage">Local cartage</option>
							<option value="other">Other</option>
						</select>
						<Input name="amount" inputmode="decimal" placeholder="Rs" class="w-28" aria-label="Amount" />
						<Input name="note" placeholder="Note" class="w-40 flex-1" aria-label="Note" />
						<Button type="submit" variant="outline" disabled={!!busy}>Add</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>Details</Card.Title></Card.Header>
			<Card.Content>
				<form method="POST" action={formAction('header')} use:enhance={act('header')} class="grid gap-3">
					<fieldset disabled={locked} class="grid gap-3 sm:grid-cols-2">
						<div class="grid gap-1.5"><Label for="ref">Name</Label><Input id="ref" name="ref" value={b.ref} /></div>
						<div class="grid gap-1.5"><Label for="supplier">Supplier</Label><Input id="supplier" name="supplier" value={b.supplier ?? ''} /></div>
						{#if isRmb}
							<div class="grid gap-1.5"><Label for="fx">Rs per 1 yuan</Label><Input id="fx" name="fx" inputmode="decimal" value={b.fxRateX10000 / 10_000} /></div>
						{/if}
						<div class="grid gap-1.5"><Label for="ddp">DDP Rs per kg</Label><Input id="ddp" name="ddp" inputmode="decimal" value={b.ddpRatePerKg / 100} /></div>
						<div class="grid gap-1.5 sm:col-span-2"><Label for="notes">Notes</Label><Textarea id="notes" name="notes" rows={2} value={b.notes ?? ''} /></div>
					</fieldset>
					{#if !locked}
						<div class="flex justify-between">
							<Button type="submit" variant="outline" disabled={!!busy}>Save details</Button>
						</div>
					{/if}
				</form>
				{#if !locked}
					<form
						method="POST"
						action={formAction('delete')}
						class="mt-3 border-t pt-3"
						use:enhance={({ cancel }) => {
							if (!confirm(`Delete purchase "${b.ref}" and its ${data.lines.length} items?`)) return cancel();
						}}
					>
						<Button type="submit" variant="ghost" size="sm" class="text-danger">Delete purchase</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>

{#if dirty}
	<form
		method="POST"
		action={formAction('items')}
		use:enhance={act('items', () => (edits = {}))}
		class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur md:left-(--sidebar-width)"
	>
		<input type="hidden" name="rows" value={JSON.stringify(Object.entries(edits).map(([id, x]) => ({ id, ...x })))} />
		<span class="text-sm text-muted-foreground">{dirty} unsaved line{dirty === 1 ? '' : 's'}</span>
		<Button type="button" variant="ghost" onclick={() => (edits = {})}>Discard</Button>
		<Button type="submit" disabled={!!busy}>{busy === 'items' ? 'Saving…' : 'Save items'}</Button>
	</form>
{/if}
