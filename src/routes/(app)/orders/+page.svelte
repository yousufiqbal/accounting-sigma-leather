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
	import RecordDelivery from '#lib/components/app/record-delivery.svelte';
	import { formatRs } from '#lib/money.js';
	import { currentMonth, monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const COURIER_LABEL: Record<string, string> = { postex: 'PostEx', dex: 'DEX', manual: 'Manual' };

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

	let recorder = $state<RecordDelivery>();

	const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');
	const STATE = {
		delivered: { tone: 'success', label: 'delivered' },
		returned: { tone: 'danger', label: 'returned' },
		in_transit: { tone: 'info', label: 'in transit' },
		shipped: { tone: 'warning', label: 'shipped · no courier data' },
		not_shipped: { tone: 'muted', label: 'not shipped' },
		cancelled: { tone: 'muted', label: 'cancelled' }
	} as const;
	const SORT_LABEL = {
		recent: 'Delivery date',
		order: 'Order # ↓',
		order_asc: 'Order # ↑',
		low: 'Lowest profit',
		high: 'Highest profit'
	} as const;
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Orders</h1>
			<p class="text-sm text-muted-foreground">
				Profit per order, by the month it was delivered or returned.
			</p>
		</div>
		<form method="GET" data-sveltekit-keepfocus>
			{#each [...page.url.searchParams].filter(([k]) => k === 'm') as [k, v] (k)}
				<input type="hidden" name={k} value={v} />
			{/each}
			<Input
				name="q"
				value={data.q}
				placeholder="Find order # (any month)"
				class="h-9 w-56"
				type="search"
			/>
		</form>
	</div>

	{#if data.mode === 'profit' && data.noCourierCount}
		<a
			href={href({ view: 'nocourier', sort: null })}
			class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning hover:underline"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0" />
			{data.noCourierCount} shipped order{data.noCourierCount === 1 ? ' has' : 's have'} no courier data
			yet — review
		</a>
	{/if}

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
	{/if}

	<Card.Root>
		<Card.Header class="gap-3" data-sveltekit-noscroll>
			{#if data.mode === 'profit'}
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
			{:else}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<Card.Title class="text-base">
						{data.mode === 'search' ? `Orders matching #${data.q}` : 'Shipped, no courier data yet'}
					</Card.Title>
					<Button href={href({ q: null, view: null })} size="sm" variant="ghost"
						>← Back to {monthLabel(data.month)} profit</Button
					>
				</div>
				{#if data.mode === 'nocourier'}
					<Card.Description>
						Shipped with a tracking number, but no PostEx/DEX data yet. Tracked orders are assumed
						delivered after 14 days if no courier data arrives — or record the delivery yourself.
					</Card.Description>
				{/if}
			{/if}
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			{#if data.mode === 'profit'}
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
									<a href="/orders/{r.name}" class="font-medium hover:underline">#{r.name}</a>
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
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">Total</Table.Head>
							<Table.Head class="text-right">Profit</Table.Head>
							<Table.Head class="pr-6">Delivery</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.orders as ord (ord.id)}
							<Table.Row class={ord.state === 'cancelled' ? 'opacity-60' : ''}>
								<Table.Cell class="pl-6">
									<a href="/orders/{ord.name}" class="font-medium hover:underline">#{ord.name}</a>
									<div class="text-xs text-muted-foreground">
										{ord.isPrepaid ? (ord.outstanding > 0 ? 'Part advance' : 'Advance') : 'COD'}
									</div>
								</Table.Cell>
								<Table.Cell class="text-sm">{fmtDate(ord.createdAt)}</Table.Cell>
								<Table.Cell>
									<StatusBadge tone={STATE[ord.state].tone} label={STATE[ord.state].label} />
									{#if ord.profit}<div class="mt-0.5 text-xs text-muted-foreground">
											counts in {monthLabel(currentMonth(new Date(ord.profit.at)))}
										</div>{/if}
								</Table.Cell>
								<Table.Cell class="text-right"><Money paisa={ord.total} /></Table.Cell>
								<Table.Cell class="text-right">
									{#if ord.profit}
										<span class={['font-medium', ord.profit.profit < 0 && 'text-danger']}
											>{formatRs(ord.profit.profit)}</span
										>
										<div class="text-xs text-muted-foreground">{pct(ord.profit.margin)}</div>
									{:else}<span class="text-muted-foreground">—</span>{/if}
								</Table.Cell>
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
										{#if ord.state === 'shipped'}
											<Button size="xs" variant="outline" onclick={() => recorder?.show(ord)}
												>Record delivery</Button
											>
										{:else}<span class="text-muted-foreground">—</span>{/if}
									{/each}
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="py-10 text-center text-muted-foreground">
									{data.mode === 'search' ? `No order matching #${data.q}.` : 'Nothing waiting.'}
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

<RecordDelivery bind:this={recorder} />
