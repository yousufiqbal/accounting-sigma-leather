<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
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

	const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');
	const SORT_LABEL = { recent: 'Recent', low: 'Lowest profit', high: 'Highest profit' } as const;

	const views = $derived([
		{ id: 'profit', label: `Profit · ${monthLabel(data.month)}` },
		{ id: 'month', label: `Placed in ${monthLabel(data.month)}` },
		{ id: 'nocourier', label: `Waiting for courier data (${data.noCourierCount})` },
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
				{:else}Shopify never synced.{/if}
			</p>
		</div>
	</div>

	{#if data.totals}
		{@const t = data.totals}
		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			<Stat label="Delivered orders">{t.orders}</Stat>
			<Stat label="Sales (incl. shipping)">{formatRs(t.sales)}</Stat>
			<Stat
				label="Order profit{t.estimated ? ' (est.)' : ''}"
				hint="Sales − product cost − courier fees − courier tax. Ads, salaries and other expenses are on Reports."
			>
				<span class={t.profit < 0 ? 'text-danger' : ''}>{formatRs(t.profit)}</span>
				<span class="text-sm font-normal text-muted-foreground">{pct(t.profit / t.sales)}</span>
			</Stat>
			<Stat label="Returns ({t.returned})" hint="Courier fees paid on parcels that came back">
				<span class={t.returnLoss < 0 ? 'text-danger' : ''}>{formatRs(t.returnLoss)}</span>
			</Stat>
		</div>
	{:else}
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
	{/if}

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
			{#if data.view === 'profit'}
				<Card.Description>
					Orders delivered or returned in {monthLabel(data.month)}. Profit = sales − product cost −
					courier fees − courier tax.
					{#if data.totals?.losing}<span class="text-danger"
							>{data.totals.losing} delivered order{data.totals.losing === 1 ? '' : 's'} lost money.</span
						>{/if}
				</Card.Description>
				<div class="flex items-center gap-1">
					<span class="mr-1 text-xs text-muted-foreground">Sort</span>
					{#each Object.entries(SORT_LABEL) as [k, label] (k)}
						<Button
							href={href({ sort: k === 'recent' ? null : k })}
							size="xs"
							variant={data.sort === k ? 'secondary' : 'ghost'}>{label}</Button
						>
					{/each}
				</div>
			{:else if data.view === 'nocourier'}
				<Card.Description>
					Shipped with a tracking number, but no PostEx/DEX data yet. Orders shipped without
					tracking count as delivered right away; tracked ones are assumed delivered after 14 days
					if no courier data arrives.
				</Card.Description>
			{/if}
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			{#if data.view === 'profit'}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">Order</Table.Head>
							<Table.Head>Outcome</Table.Head>
							<Table.Head class="text-right">Sales</Table.Head>
							<Table.Head class="text-right">Product cost</Table.Head>
							<Table.Head class="text-right">Courier fees</Table.Head>
							<Table.Head class="text-right">Courier tax</Table.Head>
							<Table.Head class="text-right">Profit</Table.Head>
							<Table.Head class="pr-6 text-right">Margin</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.profits as r (r.id)}
							<Table.Row>
								<Table.Cell class="pl-6">
									<div class="font-medium">#{r.name}</div>
									<div class="text-xs text-muted-foreground">
										{r.isPrepaid ? 'Advance' : 'COD'}{r.courierOnly
											? ' · cancelled in Shopify'
											: ''}
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="flex items-center gap-1.5 text-xs">
										<StatusBadge status={r.outcome} />
										<span class="text-muted-foreground"
											>{r.couriers
												.split(',')
												.map((c) => COURIER_LABEL[c] ?? c)
												.join(' + ')} · {fmtDate(r.at)}</span
										>
									</div>
								</Table.Cell>
								<Table.Cell class="text-right">
									{#if r.outcome === 'delivered'}
										<Money paisa={r.sales} />
										{#if r.shipping}<div class="text-xs text-muted-foreground">
												incl. {formatRs(r.shipping)} shipping
											</div>{/if}
									{:else}<span class="text-muted-foreground">—</span>{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									{#if r.outcome === 'delivered'}
										<Money paisa={-r.cogs} muted />
										{#if r.unitsNoCost}<div class="text-xs text-warning">
												{r.unitsNoCost} unit{r.unitsNoCost === 1 ? '' : 's'} no cost
											</div>{:else if r.cogsEstimated}<div class="text-xs text-muted-foreground">
												est.
											</div>{/if}
									{:else}<span class="text-muted-foreground">—</span>{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									<Money paisa={-r.courier} muted />
									{#if r.courierEstimated}<div class="text-xs text-muted-foreground">est.</div>{/if}
								</Table.Cell>
								<Table.Cell class="text-right"><Money paisa={-r.tax} muted /></Table.Cell>
								<Table.Cell class={['text-right font-medium', r.profit < 0 && 'text-danger']}>
									{formatRs(r.profit)}
								</Table.Cell>
								<Table.Cell class="pr-6 text-right text-sm text-muted-foreground"
									>{pct(r.margin)}</Table.Cell
								>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
									No orders delivered or returned in {monthLabel(data.month)}.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{:else}
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
								<Table.Cell class="text-right"
									><Money paisa={ord.shippingCharged} muted /></Table.Cell
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
										{#if !ord.cancelledAt && (ord.fulfillmentStatus === 'FULFILLED' || ord.fulfillmentStatus === 'PARTIALLY_FULFILLED')}
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
			{/if}
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
				action={formAction('manualDelivery')}
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
