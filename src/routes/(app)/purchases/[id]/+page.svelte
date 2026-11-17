<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { ask, notice } from '#lib/confirm.svelte.js';
	import Thumb from '#lib/components/app/thumb.svelte';
	import ProductPickerDialog from '#lib/components/app/product-picker-dialog.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { tick } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Line = (typeof data.lines)[number];
	type Edit = { qty: string; price: string; weight: string };

	const b = $derived(data.batch);
	const locked = $derived(b.status === 'landed' || b.status === 'landing');
	const retrying = $derived(b.status === 'landing');
	const isRmb = $derived(b.currency !== 'PKR');
	const sym = $derived(isRmb ? '¥' : 'Rs');
	const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

	let edits = $state<Record<string, Edit>>({});
	let busy = $state<string | null>(null);
	let pickerOpen = $state(false);
	let addForm = $state<HTMLFormElement>();
	let addIds = $state('[]');
	const onPurchase = $derived(new Set(data.lines.map((l) => l.variantId)));

	/** Shipment transport inputs: saved values unless the user is editing. */
	type ShipMode = 'perkg' | 'fixed';
	const shipSaved = $derived({
		mode: (data.shipment.fixed ? 'fixed' : 'perkg') as ShipMode,
		kg: data.shipment.billedWeightG !== null ? String(data.shipment.billedWeightG / 1000) : '',
		rate: String(b.ddpRatePerKg / 100),
		bill:
			data.shipment.fixed && data.shipment.ddpTotal !== null
				? String(data.shipment.ddpTotal / 100)
				: '',
		split: data.shipment.splitChosen,
		china: b.chinaShipMinor ? String(b.chinaShipMinor / 100) : ''
	});
	let shipEdit = $state<{
		mode: ShipMode;
		kg: string;
		rate: string;
		bill: string;
		split: 'weight' | 'value';
		china: string;
	} | null>(null);
	const ship = $derived(shipEdit ?? shipSaved);
	const num = (x: string) => (x.trim() === '' ? null : Number(x.replace(/,/g, '')));
	/** Per kg: live bill total while typing (paisa). */
	/** What the transport card shows, live from the inputs (saved or being typed). */
	const live = $derived.by(() => {
		const allWeighed = data.lines.length > 0 && data.shipment.itemsWithoutWeight === 0;
		const wantValue = ship.mode === 'fixed' && ship.split === 'value';
		let total: number | null;
		let overhead: number | null = null;
		if (ship.mode === 'fixed') total = Math.round((num(ship.bill) ?? 0) * 100);
		else {
			const kg = num(ship.kg);
			const rate = num(ship.rate) ?? 0;
			total = rate === 0 ? 0 : kg === null ? null : Math.round(kg * rate * 100);
			if (kg !== null && data.totals.weightG > 0) overhead = (kg * 1000) / data.totals.weightG - 1;
		}
		return {
			total: total !== null && Number.isFinite(total) ? total : null,
			split: wantValue || !allWeighed ? 'value' : 'weight',
			fallback: !wantValue && !allWeighed && !!total,
			overhead
		};
	});
	const shipDirty = $derived(
		shipEdit !== null &&
			(shipEdit.mode !== shipSaved.mode ||
				(num(shipEdit.china) ?? 0) !== (num(shipSaved.china) ?? 0) ||
				(shipEdit.mode === 'fixed'
					? num(shipEdit.bill) !== num(shipSaved.bill) || shipEdit.split !== shipSaved.split
					: num(shipEdit.kg) !== num(shipSaved.kg) || num(shipEdit.rate) !== num(shipSaved.rate)))
	);
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
		if (next.qty === o.qty && next.price === o.price && next.weight === o.weight)
			delete edits[l.id];
		else edits[l.id] = next;
	}

	const STATUS = {
		draft: { tone: 'muted', label: 'draft' },
		paid: { tone: 'info', label: 'purchased · incoming' },
		landing: { tone: 'warning', label: 'adding to stock…' },
		landed: { tone: 'success', label: 'arrived' }
	} as const;

	const act = (name: string, after?: () => void) => () => {
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

	/** "Mark arrived" review: what goes into Shopify, confirmed by typing the unit count. */
	let arriveOpen = $state(false);
	let arriveTyped = $state('');
	let arriveConfirmed = false;
	let arriveForm = $state<HTMLFormElement>();
	let arriveDate = $state(today);
	const arrivePlan = $derived(
		data.lines.map((l) => {
			const have = Math.max(0, l.variant?.onHand ?? 0);
			const old = l.variant && l.variant.avgCost > 0 ? l.variant.avgCost : null;
			const newAvg = Math.round(
				(have * (old ?? l.landed) + l.qty * l.landed) / (have + l.qty || 1)
			);
			const change = old ? (newAvg - old) / old : null;
			const weightFrom =
				l.unitWeightG > 0 && l.variant && l.variant.weightG !== l.unitWeightG
					? (l.variant.weightG ?? 0)
					: null;
			return { l, have, old, newAvg, big: change !== null && Math.abs(change) > 0.3, weightFrom };
		})
	);
	const weightUpdates = $derived(arrivePlan.filter((p) => p.weightFrom !== null).length);
	const arriveOk = $derived(arriveTyped.trim() === String(data.totals.units));
	/** Purchase details: shown as text, a form only after Edit. */
	let editingHeader = $state(false);
	/** Items total in the supplier's currency (fen / paisa). */
	const itemsForeign = $derived(
		data.lines.reduce((t, l) => t + l.unitPriceForeignMinor * l.qty, 0)
	);
	/** Items table: Enter → same column, next row (Shift+Enter → previous row). */
	function nextRow(ev: KeyboardEvent) {
		if (ev.key !== 'Enter') return;
		ev.preventDefault();
		const el = ev.currentTarget as HTMLInputElement;
		const col = el.dataset.col;
		const all = [
			...(el.closest('table')?.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]`) ?? [])
		];
		const next = all[all.indexOf(el) + (ev.shiftKey ? -1 : 1)];
		if (next) {
			next.focus();
			next.select();
		}
	}
	/**
	 * Unsaved item or transport changes: closing/reloading the tab asks first (browser prompt),
	 * and leaving to another page in the panel asks with our own dialog.
	 */
	const unsaved = $derived(!!dirty || shipDirty);
	let leaving = false;
	beforeNavigate(({ cancel, to, type }) => {
		if (!unsaved || leaving) return;
		cancel(); // on tab close / reload this shows the browser's own "Leave site?" prompt
		if (type === 'leave' || !to) return;
		ask({
			title: 'Leave without saving?',
			description: 'Your item or transport changes on this purchase are not saved yet.',
			confirmLabel: 'Leave',
			destructive: true
		}).then((ok) => {
			if (!ok) return;
			leaving = true;
			goto(to.url);
		});
	});
	/** Serial numbers before the items (remembered on this device). */
	let showSerial = $state(
		(() => {
			try {
				return localStorage.getItem('purchase-serial') === '1';
			} catch {
				return false;
			}
		})()
	);
	function toggleSerial() {
		showSerial = !showSerial;
		try {
			localStorage.setItem('purchase-serial', showSerial ? '1' : '0');
		} catch {
			/* private mode: just this visit */
		}
	}
	const productCount = $derived(
		new Set(data.lines.map((l) => l.variant?.productId ?? l.variantId)).size
	);
</script>

<div class="grid gap-6 pb-20">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<a
				href="/purchases"
				class="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
				><ArrowLeft class="size-3.5" /> Purchases</a
			>
			<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
				{b.ref}
				<StatusBadge tone={STATUS[b.status].tone} label={STATUS[b.status].label} />
				{#if data.shipment.ddpPending && !locked}<StatusBadge
						tone="warning"
						label="Transport pending"
					/>{/if}
			</h1>
			<p class="text-sm text-muted-foreground">
				{b.supplier ?? 'No supplier'} ·
				{isRmb ? `¥1 = Rs ${b.fxRateX10000 / 10_000}` : 'Pakistani supplier (Rs)'} · Transport {data
					.shipment.fixed
					? `${formatRs(data.shipment.ddpTotal ?? 0)} bill`
					: `${formatRs(b.ddpRatePerKg)}/kg`}
				{#if b.paidOn}· purchased {b.paidOn}{/if}
				{#if b.landedOn}· arrived {b.landedOn}{/if}
			</p>
		</div>
		{#if retrying}
			<form
				method="POST"
				action={formAction('land')}
				use:enhance={act('land')}
				class="flex items-end gap-2"
			>
				<input type="hidden" name="date" value={today} />
				<Button type="submit" disabled={!!busy}
					>{busy === 'land' ? 'Retrying…' : 'Retry adding to stock'}</Button
				>
			</form>
		{/if}
		{#if !locked}
			<div class="flex flex-wrap items-end gap-2">
				{#if b.status === 'draft'}
					<form
						method="POST"
						action={formAction('paid')}
						use:enhance={act('paid')}
						class="flex items-end gap-2"
					>
						<Input
							type="date"
							name="date"
							value={today}
							class="h-9 w-40"
							aria-label="Purchased on"
						/>
						<Button type="submit" disabled={!!busy || !data.lines.length}
							>{busy === 'paid' ? 'Saving…' : 'Mark purchased'}</Button
						>
					</form>
				{:else}
					<form
						method="POST"
						action={formAction('draft')}
						use:enhance={act('draft')}
						class="flex items-end"
					>
						<Button type="submit" variant="ghost" disabled={!!busy}>Back to draft</Button>
					</form>
					<form
						method="POST"
						action={formAction('land')}
						class="flex items-end gap-2"
						bind:this={arriveForm}
						use:enhance={async ({ cancel }) => {
							if (dirty) {
								cancel();
								await notice({
									title: 'Unsaved item changes',
									description: 'Save or discard your item changes first.'
								});
								return;
							}
							if (!arriveConfirmed) {
								cancel();
								arriveTyped = '';
								arriveOpen = true;
								return;
							}
							arriveConfirmed = false;
							arriveOpen = false;
							return act('land')();
						}}
					>
						<Input
							type="date"
							name="date"
							bind:value={arriveDate}
							class="h-9 w-40"
							aria-label="Arrived on"
						/>
						<Button
							type="submit"
							disabled={!!busy || !data.lines.length || !data.shipment.transportSet}
							title={!data.shipment.transportSet
								? 'Enter the transport first (per kg or fixed bill)'
								: undefined}
						>
							{busy === 'land' ? 'Adding to stock…' : 'Mark arrived — add to stock'}
						</Button>
					</form>
				{/if}
			</div>
		{/if}
	</div>

	<Card.Root size="sm">
		<Card.Content>
			{#if !editingHeader}
				<div class="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
					{#each [['Name', b.ref], ['Supplier', b.supplier], ...(isRmb ? [['Rs per 1 yuan', String(b.fxRateX10000 / 10_000)]] : []), ['Notes', b.notes]] as [label, value] (label)}
						<div class={['grid gap-0.5', label === 'Notes' && 'min-w-0 flex-1']}>
							<span class="text-xs text-muted-foreground">{label}</span>
							<span class={['font-medium', !value && 'text-muted-foreground']}>{value || '—'}</span>
						</div>
					{/each}
					{#if !locked}
						<Button variant="ghost" size="sm" class="ml-auto" onclick={() => (editingHeader = true)}
							><Pencil /> Edit</Button
						>
					{/if}
				</div>
			{:else}
				<form
					method="POST"
					action={formAction('header')}
					use:enhance={act('header', () => (editingHeader = false))}
					class="flex flex-wrap items-end gap-3"
				>
					<fieldset disabled={locked} class="contents">
						<div class="grid gap-1.5">
							<Label for="ref">Name</Label><Input id="ref" name="ref" value={b.ref} class="w-48" />
						</div>
						<div class="grid gap-1.5">
							<Label for="supplier">Supplier</Label><Input
								id="supplier"
								name="supplier"
								value={b.supplier ?? ''}
								class="w-44"
							/>
						</div>
						{#if isRmb}
							<div class="grid gap-1.5">
								<Label for="fx">Rs per 1 yuan</Label><Input
									id="fx"
									name="fx"
									inputmode="decimal"
									value={b.fxRateX10000 / 10_000}
									class="w-28"
								/>
							</div>
						{/if}
						<div class="grid min-w-48 flex-1 gap-1.5">
							<Label for="notes">Notes</Label><Input
								id="notes"
								name="notes"
								value={b.notes ?? ''}
							/>
						</div>
						{#if !locked}
							<div class="flex gap-2">
								<Button type="button" variant="ghost" onclick={() => (editingHeader = false)}
									>Cancel</Button
								>
								<Button type="submit" disabled={!!busy}>Save</Button>
							</div>
						{/if}
					</fieldset>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
			<div class="grid gap-1">
				<div class="flex items-center gap-2">
					<Card.Title>Items</Card.Title>
					<Button
						size="xs"
						variant={showSerial ? 'secondary' : 'ghost'}
						aria-pressed={showSerial}
						title={showSerial ? 'Hide serial numbers' : 'Show serial numbers'}
						onclick={toggleSerial}>#</Button
					>
				</div>
				<Card.Description>
					{#if data.lines.length}
						{productCount}
						{productCount === 1 ? 'product' : 'products'} ·
						{data.lines.length}
						{data.lines.length === 1 ? 'variant' : 'variants'} ·
						{data.totals.units.toLocaleString('en-PK')} units ·
						{isRmb
							? `¥${(itemsForeign / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
							: formatRs(data.totals.goods)} items
						{#if isRmb && b.chinaShipMinor}
							· ¥{(b.chinaShipMinor / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 })} shipping
						{/if}
					{:else}
						No items yet — add products to start.
					{/if}
				</Card.Description>
			</div>
			{#if !locked}
				<Button onclick={() => (pickerOpen = true)}><Plus /> Add products</Button>
				<form
					method="POST"
					action={formAction('addMany')}
					bind:this={addForm}
					use:enhance={act('addMany', () => (pickerOpen = false))}
					class="hidden"
				>
					<input type="hidden" name="ids" value={addIds} />
				</form>
			{/if}
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root sticky>
				<Table.Header>
					<Table.Row>
						{#if showSerial}<Table.Head class="w-10 pr-0 pl-6 text-right">#</Table.Head>{/if}
						<Table.Head class={showSerial ? 'pl-3' : 'pl-6'}>Product</Table.Head>
						<Table.Head class="text-right">Qty</Table.Head>
						<Table.Head class="text-right">Price ({sym})</Table.Head>
						<Table.Head class="text-right">Weight (g)</Table.Head>
						<Table.Head class="text-right">Goods</Table.Head>
						<Table.Head class="text-right">Transport</Table.Head>
						<Table.Head class="text-right">Landed / pc</Table.Head>
						<Table.Head class="text-right">{locked ? 'Cost before' : 'Current cost'}</Table.Head>
						<Table.Head class="pr-6 text-right">Line total</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.lines as l, n (l.id)}
						{@const e = cur(l)}
						<Table.Row class={edits[l.id] ? 'bg-warning-soft/40' : ''}>
							{#if showSerial}<Table.Cell
									class="num w-10 pr-0 pl-6 text-right text-muted-foreground">{n + 1}</Table.Cell
								>{/if}
							<Table.Cell class={['max-w-64', showSerial ? 'pl-3' : 'pl-6']}>
								<div class="flex items-center gap-3">
									<Thumb
										src={l.variant?.imageUrl}
										alt={`${l.variant?.productTitle ?? ''}${l.variant?.variantTitle ? ` · ${l.variant.variantTitle}` : ''}`}
										caption="Qty {l.qty}"
									/>
									<div class="min-w-0">
										<div class="truncate font-medium">
											{l.variant?.productTitle ?? 'Deleted product'}
										</div>
										<div class="truncate text-xs text-muted-foreground">
											{l.variant?.variantTitle ?? ''}{l.variant?.variantTitle && l.variant?.sku
												? ' · '
												: ''}{l.variant?.sku ?? ''}
										</div>
									</div>
								</div>
							</Table.Cell>
							{#if locked}
								<Table.Cell class="num text-right">{l.qty}</Table.Cell>
								<Table.Cell class="num text-right"
									>{(l.unitPriceForeignMinor / 100).toLocaleString('en-PK')}</Table.Cell
								>
								<Table.Cell class="num text-right">{l.unitWeightG}</Table.Cell>
							{:else}
								<Table.Cell class="text-right">
									<Input
										value={e.qty}
										oninput={(ev) => {
											// Whole pieces only: drop anything that isn't a digit.
											const clean = ev.currentTarget.value.replace(/[^0-9]/g, '');
											if (clean !== ev.currentTarget.value) ev.currentTarget.value = clean;
											set(l, { qty: clean });
										}}
										inputmode="numeric"
										class="ml-auto h-8 w-16 text-right"
										aria-label="Quantity"
										data-col="qty"
										onkeydown={nextRow}
									/>
								</Table.Cell>
								<Table.Cell class="text-right">
									<Input
										value={e.price}
										oninput={(ev) => set(l, { price: ev.currentTarget.value })}
										inputmode="decimal"
										class="ml-auto h-8 w-20 text-right"
										aria-label="Price"
										data-col="price"
										onkeydown={nextRow}
									/>
								</Table.Cell>
								<Table.Cell class="text-right">
									<Input
										value={e.weight}
										oninput={(ev) => set(l, { weight: ev.currentTarget.value })}
										inputmode="decimal"
										class={['ml-auto h-8 w-20 text-right', !l.unitWeightG && 'border-danger']}
										aria-label="Weight in grams"
										data-col="weight"
										onkeydown={nextRow}
									/>
								</Table.Cell>
							{/if}
							<Table.Cell class="text-right"><Money paisa={l.goods} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={l.ddp} muted /></Table.Cell>
							<Table.Cell class="text-right font-medium"><Money paisa={l.landed} /></Table.Cell>
							<Table.Cell class="text-right text-muted-foreground">
								{#if !locked && l.variant}<Money paisa={l.variant.avgCost} muted />{:else}—{/if}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right">
								<div class="flex items-center justify-end gap-1">
									<Money paisa={l.landed * l.qty} />
									{#if !locked}
										<form
											method="POST"
											action={formAction('remove')}
											use:enhance={async (input) => {
												const ok = await ask({
													title: 'Remove this item?',
													description: `${l.variant?.productTitle ?? 'Item'}${l.variant?.variantTitle ? ` — ${l.variant.variantTitle}` : ''} · ${l.qty} pcs`,
													confirmLabel: 'Remove',
													destructive: true
												});
												if (!ok) return input.cancel();
												return act('remove')();
											}}
										>
											<input type="hidden" name="itemId" value={l.id} />
											<Button type="submit" size="icon-sm" variant="ghost" aria-label="Remove"
												><Trash /></Button
											>
										</form>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell
								colspan={showSerial ? 11 : 10}
								class="py-10 text-center text-muted-foreground">No items yet.</Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root class={!data.shipment.transportSet && !locked ? 'border-warning/40' : ''}>
		<Card.Header>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<Card.Title>Transport</Card.Title>
				{#if !locked}
					{#if shipDirty}
						<StatusBadge tone="warning" label="Not applied yet" />
					{:else if data.shipment.ddpPending}
						<StatusBadge tone="warning" label="Pending — enter box weight" />
					{:else if !data.shipment.transportSet}
						<StatusBadge tone="warning" label="Required before arrival" />
					{:else}
						<span class="flex items-center gap-1.5 text-sm text-success"
							><CircleCheck class="size-4" /> Applied to items</span
						>
					{/if}
				{/if}
			</div>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action={formAction('shipment')}
				use:enhance={act('shipment', () => (shipEdit = null))}
				class="grid gap-5"
			>
				<fieldset disabled={locked} class="contents">
					<input type="hidden" name="mode" value={ship.mode} />
					<input type="hidden" name="split" value={ship.split} />

					{#if isRmb}
						<div class="grid gap-1.5">
							<Label for="china"
								>China shipping (¥) <span class="font-normal text-muted-foreground"
									>— supplier → forwarder, optional</span
								></Label
							>
							<div class="flex items-center gap-3">
								<Input
									id="china"
									name="china"
									inputmode="decimal"
									class="w-32"
									value={ship.china}
									oninput={(ev) => (shipEdit = { ...ship, china: ev.currentTarget.value })}
									placeholder="e.g. 25"
								/>
								{#if num(ship.china)}
									<span class="num text-sm text-muted-foreground"
										>= {formatRs(Math.round(((num(ship.china) ?? 0) * b.fxRateX10000) / 100))}</span
									>
								{/if}
							</div>
						</div>
					{:else}
						<input type="hidden" name="china" value="" />
					{/if}

					<div class="grid gap-1.5">
						<span class="text-sm font-medium">How was transport charged?</span>
						<div class="flex flex-wrap items-center gap-3">
							{@render segmented(
								[
									['perkg', 'Per kg'],
									['fixed', 'Fixed bill']
								],
								ship.mode,
								(m) => (shipEdit = { ...ship, mode: m as ShipMode })
							)}
							<span class="text-xs text-muted-foreground">
								{ship.mode === 'fixed'
									? 'e.g. local carriage — one amount for the whole purchase'
									: 'billed box weight × rate, shared by item weight'}
							</span>
						</div>
					</div>

					<div class="flex flex-wrap items-end gap-x-4 gap-y-4">
						{#if ship.mode === 'fixed'}
							<div class="grid gap-1.5">
								<Label for="bill">Bill amount (Rs)</Label>
								<Input
									id="bill"
									name="bill"
									inputmode="decimal"
									class="w-36"
									value={ship.bill}
									oninput={(ev) => (shipEdit = { ...ship, bill: ev.currentTarget.value })}
									placeholder="e.g. 1500"
								/>
							</div>
							<div class="grid gap-1.5">
								<span class="text-sm font-medium">Share it by</span>
								{@render segmented(
									[
										['weight', 'Weight'],
										['value', 'Price']
									],
									ship.split,
									(m) => (shipEdit = { ...ship, split: m as 'weight' | 'value' })
								)}
							</div>
							<span class="pb-2 text-xs text-muted-foreground">
								{ship.split === 'value'
									? 'costlier items carry more of the bill'
									: 'heavier items carry more of the bill'}
							</span>
						{:else}
							<div class="grid gap-1.5">
								<Label for="billedKg">Billed box weight (kg)</Label>
								<Input
									id="billedKg"
									name="billedKg"
									inputmode="decimal"
									class="w-36"
									value={ship.kg}
									oninput={(ev) => (shipEdit = { ...ship, kg: ev.currentTarget.value })}
									placeholder="when boxes arrive"
								/>
							</div>
							<span class="pb-2 text-muted-foreground">×</span>
							<div class="grid gap-1.5">
								<Label for="ddp">Rate per kg (Rs)</Label>
								<Input
									id="ddp"
									name="ddp"
									inputmode="decimal"
									class="w-32"
									value={ship.rate}
									oninput={(ev) => (shipEdit = { ...ship, rate: ev.currentTarget.value })}
								/>
							</div>
						{/if}
					</div>

					<div
						class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm"
					>
						<div class="grid gap-0.5">
							<div>
								{#if live.total === null}
									<span class="text-warning"
										>~{formatRs(data.totals.ddp - data.totals.china)} estimated from item weights — enter
										the billed box weight when the boxes arrive</span
									>
								{:else if live.total === 0}
									No transport on this purchase.
								{:else}
									<b class="num text-base">{formatRs(live.total)}</b> shared across the items by
									<b>{live.split === 'value' ? 'price' : 'weight'}</b>
								{/if}
							</div>
							{#if isRmb && num(ship.china)}
								<div>
									+ <b class="num">¥{num(ship.china)}</b> China shipping
									<span class="text-muted-foreground"
										>(= {formatRs(Math.round(((num(ship.china) ?? 0) * b.fxRateX10000) / 100))}),
										shared by {data.shipment.itemsWithoutWeight ? 'price' : 'weight'}</span
									>
								</div>
							{/if}
							{#if live.fallback}
								<div class="text-xs text-warning">
									{data.shipment.itemsWithoutWeight} items have no weight, so it's shared by price.
								</div>
							{/if}
							{#if live.overhead !== null}
								<div
									class={['text-xs', live.overhead < 0 ? 'text-danger' : 'text-muted-foreground']}
								>
									{live.overhead < 0
										? "Billed weight is less than the items' weights — check the item weights."
										: `Box is ${(live.overhead * 100).toFixed(0)}% heavier than the items (cartons, packing).`}
								</div>
							{/if}
						</div>
						{#if !locked && shipDirty}
							<div class="flex items-center gap-2">
								<Button type="button" variant="ghost" onclick={() => (shipEdit = null)}>Undo</Button
								>
								<Button type="submit" disabled={!!busy}
									>{busy === 'shipment' ? 'Applying…' : 'Save & apply'}</Button
								>
							</div>
						{/if}
					</div>
				</fieldset>
			</form>
		</Card.Content>
	</Card.Root>

	<Dialog.Root bind:open={arriveOpen}>
		<Dialog.Content class="sm:max-w-xl">
			<Dialog.Header>
				<Dialog.Title>Mark “{b.ref}” arrived?</Dialog.Title>
				<Dialog.Description>
					Adds the stock to Shopify and updates costs in Shopify. <span
						class="font-medium text-warning">This can't be undone from here.</span
					>
				</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-3 text-sm">
				<div
					class="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 sm:grid-cols-4"
				>
					<div>
						<div class="text-xs text-muted-foreground">Arrived on</div>
						<div class="font-medium">{arriveDate}</div>
					</div>
					<div>
						<div class="text-xs text-muted-foreground">Units</div>
						<div class="num font-medium">
							{data.totals.units}
							<span class="text-xs font-normal text-muted-foreground"
								>· {productCount} {productCount === 1 ? 'product' : 'products'} · {data.lines.length} variants</span
							>
						</div>
					</div>
					<div>
						<div class="text-xs text-muted-foreground">Transport</div>
						<div class="num font-medium">
							{formatRs(data.totals.ddp)}
							<span class="text-xs font-normal text-muted-foreground"
								>{data.shipment.fixed ? 'fixed bill' : 'per kg'}</span
							>
						</div>
					</div>
					<div>
						<div class="text-xs text-muted-foreground">Landed total</div>
						<div class="num font-medium">{formatRs(data.totals.landed)}</div>
					</div>
				</div>

				<div class="max-h-64 overflow-auto rounded-lg border">
					<table class="w-full text-sm">
						<thead class="sticky top-0 bg-background text-xs text-muted-foreground">
							<tr>
								<th class="px-3 py-1.5 text-left font-normal">Product</th>
								<th class="px-2 py-1.5 text-right font-normal">Stock</th>
								<th class="px-3 py-1.5 text-right font-normal">Cost</th>
							</tr>
						</thead>
						<tbody>
							{#each arrivePlan as p (p.l.id)}
								<tr class={['border-t', p.big && 'bg-warning-soft/50']}>
									<td class="max-w-64 px-3 py-1.5">
										<div class="flex items-center gap-2">
											<Thumb
												src={p.l.variant?.imageUrl ?? null}
												alt={p.l.variant?.productTitle ?? ''}
												size={32}
											/>
											<div class="min-w-0">
												<div class="truncate">{p.l.variant?.productTitle ?? '—'}</div>
												{#if p.l.variant?.variantTitle}<div
														class="truncate text-xs text-muted-foreground"
													>
														{p.l.variant.variantTitle}
													</div>{/if}
												{#if p.weightFrom !== null}<div class="text-xs text-info">
														Weight {p.weightFrom || '—'} g → {p.l.unitWeightG} g in Shopify
													</div>{/if}
											</div>
										</div>
									</td>
									<td class="num px-2 py-1.5 text-right whitespace-nowrap"
										>{p.have} <span class="text-success">+{p.l.qty}</span></td
									>
									<td class="num px-3 py-1.5 text-right whitespace-nowrap">
										{p.old ? formatRs(p.old) : 'none'} → <b>{formatRs(p.newAvg)}</b>
										{#if p.big}<div class="text-xs text-warning">
												big change — check price/weight
											</div>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if weightUpdates}
					<p class="text-xs text-info">
						{weightUpdates}
						{weightUpdates === 1 ? 'product weight' : 'product weights'} will be updated in Shopify to
						the weights on this purchase.
					</p>
				{/if}
				<p class="text-xs text-muted-foreground">
					New cost = average of the stock you have and this purchase (approximate until it's saved).
				</p>

				<div class="grid gap-1.5">
					<Label for="arriveCheck">Type the total units ({data.totals.units}) to confirm</Label>
					<Input
						id="arriveCheck"
						bind:value={arriveTyped}
						inputmode="numeric"
						autocomplete="off"
						class="w-40"
						onkeydown={(ev) => {
							if (ev.key === 'Enter' && arriveOk) {
								ev.preventDefault();
								arriveConfirmed = true;
								arriveForm?.requestSubmit();
							}
						}}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (arriveOpen = false)}>Cancel</Button>
				<Button
					disabled={!arriveOk || !!busy}
					onclick={() => {
						arriveConfirmed = true;
						arriveForm?.requestSubmit();
					}}>Add {data.totals.units} units to stock</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<ProductPickerDialog
		bind:open={pickerOpen}
		options={data.options}
		existing={onPurchase}
		busy={busy === 'addMany'}
		onadd={async (ids) => {
			addIds = JSON.stringify(ids);
			await tick();
			addForm?.requestSubmit();
		}}
	/>

	{#snippet segmented(options: [string, string][], value: string, pick: (v: string) => void)}
		<div class="flex h-9 items-center rounded-md border p-0.5">
			{#each options as [v, label] (v)}
				<button
					type="button"
					class={[
						'h-full rounded px-3 text-sm',
						value === v ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent'
					]}
					aria-pressed={value === v}
					onclick={() => pick(v)}>{label}</button
				>
			{/each}
		</div>
	{/snippet}

	{#if !locked}
		<form
			method="POST"
			action={formAction('delete')}
			class="flex justify-end"
			use:enhance={async ({ cancel }) => {
				const ok = await ask({
					title: `Delete purchase “${b.ref}”?`,
					description: `Its ${data.lines.length} items are removed too.`,
					confirmLabel: 'Delete',
					destructive: true
				});
				if (!ok) return cancel();
			}}
		>
			<Button type="submit" variant="ghost" size="sm" class="text-danger">Delete purchase</Button>
		</form>
	{/if}
</div>

{#if dirty}
	<form
		method="POST"
		action={formAction('items')}
		use:enhance={act('items', () => (edits = {}))}
		class="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur md:left-(--sidebar-width)"
	>
		<input
			type="hidden"
			name="rows"
			value={JSON.stringify(Object.entries(edits).map(([id, x]) => ({ id, ...x })))}
		/>
		<span class="text-sm text-muted-foreground">{dirty} unsaved line{dirty === 1 ? '' : 's'}</span>
		<Button type="button" variant="ghost" onclick={() => (edits = {})}>Discard</Button>
		<Button type="submit" disabled={!!busy}>{busy === 'items' ? 'Saving…' : 'Save items'}</Button>
	</form>
{/if}
