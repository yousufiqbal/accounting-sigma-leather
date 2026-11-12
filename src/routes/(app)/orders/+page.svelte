<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import { monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let syncing = $state<string | null>(null);
	let saving = $state(false);
	let target = $state<(typeof data.orders)[number] | null>(null);
	let open = $state(false);
	let manualStatus = $state<'delivered' | 'returned'>('delivered');

	const COURIER_LABEL: Record<string, string> = { postex: 'PostEx', dex: 'DEX', manual: 'Manual' };
	const COURIER_TAGS = /leopards|karachi logistics|^kl$|pickup|daraz|dex|postex|tcs|m&p|trax/i;

	function href(changes: Record<string, string | number | null>) {
		const p = new URLSearchParams(page.url.searchParams.toString());
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '') p.delete(k);
			else p.set(k, String(v));
		}
		if (!('page' in changes)) p.delete('page');
		return `?${p}`;
	}

	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString('en-GB', {
					day: '2-digit',
					month: 'short',
					timeZone: 'Asia/Karachi'
				})
			: '—';
	const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

	function openManual(order: (typeof data.orders)[number]) {
		target = order;
		manualStatus = 'delivered';
		open = true;
	}

	const views = $derived([
		{ id: 'month', label: `Placed in ${monthLabel(data.month)}` },
		{ id: 'nocourier', label: `Shipped, no courier data (${data.noCourierCount})` },
		{ id: 'all', label: 'All' }
	]);
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Orders</h1>
			<p class="text-sm text-muted-foreground">
				{#if data.lastSync}
					Shopify last synced {new Date(data.lastSync.at).toLocaleString('en-GB', {
						timeZone: 'Asia/Karachi'
					})}
					{#if data.lastSync.ok === false}<span class="text-danger"> · failed</span>{/if}
				{:else}Shopify never synced — run Full sync once.{/if}
			</p>
		</div>
		<form
			method="POST"
			action="?/sync"
			class="flex gap-2"
			use:enhance={({ formData }) => {
				syncing = String(formData.get('mode'));
				return async ({ update }) => {
					await update({ reset: false });
					syncing = null;
				};
			}}
		>
			<Button type="submit" name="mode" value="recent" disabled={!!syncing}>
				<RefreshCw class={syncing === 'recent' ? 'animate-spin' : ''} />
				{syncing === 'recent' ? 'Syncing…' : 'Sync Shopify'}
			</Button>
			<Button type="submit" name="mode" value="full" variant="outline" disabled={!!syncing}>
				{syncing === 'full' ? 'Syncing everything…' : 'Full sync (orders + products)'}
			</Button>
		</form>
	</div>

	{#if form && 'error' in form && form.error}
		<div
			class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
			role="alert"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0" />{form.error}
		</div>
	{/if}
	{#if form && 'synced' in form && form.synced}
		<div
			class="rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success"
			role="status"
		>
			Shopify sync done: {form.synced.orders} orders{form.synced.variants !== null
				? ` · ${form.synced.variants} product variants`
				: ''} ·
			{form.synced.parcelsLinked} parcels linked to orders{form.synced.parcelsExcluded
				? ` · ${form.synced.parcelsExcluded} pre-Shopify parcels excluded`
				: ''}
		</div>
	{/if}
	{#if form && 'saved' in form && form.saved}
		<div
			class="rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success"
			role="status"
		>
			{form.saved}
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Orders placed ({monthLabel(data.month)})">{data.summary.orders ?? 0}</Stat>
		<Stat label="Cancelled">{data.summary.cancelled ?? 0}</Stat>
		<Stat label="Prepaid (advance)">{data.summary.prepaid ?? 0}</Stat>
		<Stat
			label="Order value (not cancelled)"
			hint="Booked, not yet revenue — revenue counts on delivery"
		>
			{formatRs(Number(data.summary.booked ?? 0))}
		</Stat>
	</div>

	<Card.Root>
		<Card.Header class="gap-3" data-sveltekit-noscroll>
			<div class="flex flex-wrap items-center gap-1">
				{#each views as v (v.id)}
					<Button
						href={href({ view: v.id })}
						size="sm"
						variant={data.view === v.id ? 'secondary' : 'ghost'}>{v.label}</Button
					>
				{/each}
				<form method="GET" class="ml-auto" data-sveltekit-keepfocus>
					{#each [...page.url.searchParams].filter(([k]) => k !== 'q' && k !== 'page') as [k, v] (k)}
						<input type="hidden" name={k} value={v} />
					{/each}
					<Input name="q" value={data.q} placeholder="Order #" class="h-8 w-36" />
				</form>
			</div>
			{#if data.view === 'nocourier'}
				<Card.Description>
					Fulfilled in Shopify but no PostEx/DEX parcel found — e.g. TCS, Leopards, pickup, own
					rider. Record what happened so revenue is counted.
				</Card.Description>
				{#if data.assume && data.assume.prepaid + data.assume.leopards + data.assume.direct > 0}
					<form
						method="POST"
						action="?/assume"
						use:enhance
						class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm"
					>
						<span class="text-warning">
							Ready to apply the standard rule to orders fulfilled 14+ days ago:
							<b>{data.assume.prepaid}</b> prepaid → delivered on fulfilment date (TCS/other) ·
							<b>{data.assume.leopards}</b> COD before 15 Feb → delivered by Leopards ·
							<b>{data.assume.direct}</b> later orders → collected at shop or sent by TCS (full amount received). Courier fee is estimated.
						</span>
						<Button type="submit" size="sm">Apply</Button>
					</form>
				{/if}
			{/if}
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Order</Table.Head>
						<Table.Head>Placed</Table.Head>
						<Table.Head>Payment</Table.Head>
						<Table.Head class="text-right">Items</Table.Head>
						<Table.Head class="text-right">Discounts</Table.Head>
						<Table.Head class="text-right">Shipping</Table.Head>
						<Table.Head class="text-right">Total</Table.Head>
						<Table.Head class="pr-6">Delivery</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.orders as ord (ord.id)}
						<Table.Row class={ord.cancelledAt ? 'opacity-50' : ''}>
							<Table.Cell class="pl-6">
								<div class="font-medium">#{ord.name}</div>
								<div class="flex flex-wrap gap-1">
									{#each ord.tags.filter((t) => COURIER_TAGS.test(t)) as t (t)}
										<StatusBadge tone="muted" label={t} />
									{/each}
								</div>
							</Table.Cell>
							<Table.Cell class="text-sm">{fmtDate(ord.createdAt)}</Table.Cell>
							<Table.Cell>
								{#if ord.cancelledAt}
									<StatusBadge status="cancelled" />
								{:else if ord.isPrepaid}
									<StatusBadge
										tone="success"
										label={ord.outstanding > 0 ? 'part advance' : 'advance'}
									/>
								{:else}
									<StatusBadge tone="muted" label="COD" />
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={ord.grossSales} /></Table.Cell>
							<Table.Cell class="text-right">
								{#if ord.totalDiscounts}
									<Money paisa={-ord.totalDiscounts} />
									{#if ord.prepaidDiscount}<div class="text-xs text-muted-foreground">
											5% advance
										</div>{/if}
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={ord.shippingCharged} muted /></Table.Cell
							>
							<Table.Cell class="text-right font-medium"><Money paisa={ord.total} /></Table.Cell>
							<Table.Cell class="pr-6">
								{#each ord.parcels as p (p.trackingNo)}
									<div class="flex items-center gap-1.5 text-xs">
										<StatusBadge status={p.status} />
										<span
											>{COURIER_LABEL[p.courier]}{p.courier === 'manual' && p.label
												? ` · ${p.label}`
												: ''}</span
										>
										{#if p.finalAt}<span class="text-muted-foreground">{fmtDate(p.finalAt)}</span
											>{/if}
									</div>
								{:else}
									{#if !ord.cancelledAt}
										<Button size="xs" variant="outline" onclick={() => openManual(ord)}
											>Record delivery</Button
										>
									{/if}
								{/each}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
								No orders here. Run “Full sync” once to pull your Shopify history.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		{#if data.pageCount > 1}
			<Card.Footer class="flex items-center justify-between text-sm text-muted-foreground">
				<span>{data.totalRows} orders · page {data.page} of {data.pageCount}</span>
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

<Sheet.Root bind:open>
	<Sheet.Content side="right">
		<Sheet.Header>
			<Sheet.Title>Record delivery · #{target?.name}</Sheet.Title>
			<Sheet.Description
				>For orders sent without PostEx/DEX (Leopards, pickup, own rider…).</Sheet.Description
			>
		</Sheet.Header>
		{#if target}
			<form
				method="POST"
				action="?/manualDelivery"
				class="grid gap-4 px-4"
				use:enhance={() => {
					saving = true;
					return async ({ update, result }) => {
						await update();
						saving = false;
						if (result.type === 'success') open = false;
					};
				}}
			>
				<input type="hidden" name="orderId" value={target.id} />
				<div class="grid gap-2">
					<Label>Outcome</Label>
					<div class="flex gap-2">
						{#each ['delivered', 'returned'] as s (s)}
							<label
								class={[
									'flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm',
									manualStatus === s && 'border-primary bg-accent'
								]}
							>
								<input
									type="radio"
									name="status"
									value={s}
									bind:group={manualStatus}
									class="sr-only"
								/>
								{s === 'delivered' ? 'Delivered' : 'Returned'}
							</label>
						{/each}
					</div>
				</div>
				<div class="grid gap-2">
					<Label for="how">Sent by</Label>
					<Input
						id="how"
						name="how"
						placeholder="Leopards / Pickup / Rider"
						value={target.tags.find((t) => COURIER_TAGS.test(t)) ?? ''}
					/>
				</div>
				<div class="grid gap-2">
					<Label for="date">{manualStatus === 'delivered' ? 'Delivered on' : 'Returned on'}</Label>
					<Input id="date" name="date" type="date" value={today} required />
				</div>
				{#if manualStatus === 'delivered'}
					<div class="grid gap-2">
						<Label for="cash">Cash collected (Rs)</Label>
						<Input
							id="cash"
							name="cash"
							inputmode="decimal"
							value={String(target.outstanding / 100)}
						/>
						<p class="text-xs text-muted-foreground">0 if the customer paid in advance.</p>
					</div>
				{/if}
				<div class="grid gap-2">
					<Label for="fee">Courier charge (Rs)</Label>
					<Input id="fee" name="fee" inputmode="decimal" value="0" />
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="received" class="size-4" checked />
					Money already received (no courier payment pending)
				</label>
				<Sheet.Footer class="px-0">
					<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
				</Sheet.Footer>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>
