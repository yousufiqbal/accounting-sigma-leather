<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import Info from '@lucide/svelte/icons/info';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import { monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const p = $derived(data.pnl);
	let showAll = $state(false);
	const products = $derived(showAll ? p.products : p.products.slice(0, 15));

	type Line = { label: string; value: number; kind?: 'sub' | 'total' | 'grand'; hint?: string; indent?: boolean };
	const lines = $derived<Line[]>([
		{ label: 'Gross sales', value: p.sales.gross, hint: `${p.kpi.orders} delivered orders` },
		{ label: 'Advance-payment discount (5%)', value: -p.sales.prepaidDisc, indent: true },
		{ label: 'Other discounts', value: -p.sales.otherDisc, indent: true },
		{ label: 'Shipping charged to customers', value: p.sales.shipping, indent: true },
		...(p.sales.adjust ? [{ label: 'Other order adjustments', value: p.sales.adjust, indent: true }] : []),
		{ label: 'Net sales', value: p.sales.net, kind: 'sub' },
		{
			label: 'Cost of goods sold',
			value: -p.cogs.total,
			hint: p.cogs.unitsNoCost ? `${p.cogs.unitsNoCost} units have no cost yet` : p.cogs.estimated ? 'partly estimated' : undefined
		},
		{ label: 'Gross profit', value: p.grossProfit, kind: 'total', hint: formatPct(p.kpi.grossMargin) },
		{ label: 'Delivery fees (incl. tax)', value: -p.courier.delivery, indent: true, hint: `${p.courier.delivered} parcels` },
		{ label: 'Return fees (incl. tax)', value: -p.courier.returns, indent: true, hint: `${p.courier.returned} parcels` },
		{ label: 'Courier withholding (ITWH + STWH)', value: -p.courier.withholding, indent: true },
		...(p.courier.other ? [{ label: 'Other courier charges', value: -p.courier.other, indent: true }] : []),
		{ label: 'Courier costs', value: -p.courier.total, kind: 'sub' },
		...p.expenses.marketing.map((e) => ({ label: e.category, value: -e.amount, indent: true })),
		{ label: 'Marketing', value: -p.expenses.marketingTotal, kind: 'sub' },
		...p.expenses.operating.map((e) => ({ label: e.category, value: -e.amount, indent: true })),
		{ label: 'Operating expenses', value: -p.expenses.operatingTotal, kind: 'sub' },
		...(p.writeOffs.amount
			? [{ label: p.writeOffs.amount > 0 ? 'Inventory write-offs' : 'Inventory gains (recount)', value: -p.writeOffs.amount, kind: 'sub' as const }]
			: []),
		{ label: p.netProfit >= 0 ? 'Net profit' : 'Net loss', value: p.netProfit, kind: 'grand', hint: formatPct(p.kpi.netMargin) }
	]);

	const STATUS = {
		provisional: { tone: 'warning', label: 'provisional' },
		final: { tone: 'success', label: 'final' },
		locked: { tone: 'muted', label: 'locked' }
	} as const;
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
				Income statement · {monthLabel(p.month)}
				<StatusBadge tone={STATUS[p.status].tone} label={STATUS[p.status].label} />
			</h1>
			<p class="text-sm text-muted-foreground">Sales count in the month the parcel was delivered.</p>
		</div>
		<form method="POST" action={formAction(p.status === 'locked' ? 'unlock' : 'lock')} use:enhance>
			<input type="hidden" name="month" value={p.month} />
			{#if p.status === 'locked'}
				<Button type="submit" variant="outline"><LockOpen /> Unlock month</Button>
			{:else}
				<Button type="submit" variant="outline"><Lock /> Lock month</Button>
			{/if}
		</form>
	</div>


	{#if p.status === 'provisional'}
		<div class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
			<Info class="mt-0.5 size-4 shrink-0" />
			<span>
				Some numbers are estimates:
				{#if p.courier.estimated}{p.courier.estimated} parcels with estimated courier fees/tax (statement not in yet).{/if}
				{#if p.cogs.estimated}Product costs partly estimated ({formatRs(p.cogs.estimated)}).{/if}
				{#if p.cogs.unitsNoCost}<a href="/inventory" class="underline">{p.cogs.unitsNoCost} units sold have no cost</a> — profit is overstated.{/if}
			</span>
		</div>
	{/if}
	{#if p.writeOffs.pending}
		<div class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
			<Info class="mt-0.5 size-4 shrink-0" />
			<span>
				{p.writeOffs.pending} stock changes made in Shopify this month have no reason yet.
				<a href="/inventory" class="underline">Review them</a> — damaged/missing items reduce profit.
			</span>
		</div>
	{/if}
	{#if p.courier.unmatchedDelivered}
		<div class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
			<Info class="mt-0.5 size-4 shrink-0" />
			<span>
				{p.courier.unmatchedDelivered} delivered parcels ({formatRs(p.courier.unmatchedCod)} COD) are not linked to an order, so their sale is not counted.
				<a href="/couriers" class="underline">Link them</a>.
			</span>
		</div>
	{/if}

	{#if p.shortCollected.length}
		<div class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
			<Info class="mt-0.5 size-4 shrink-0" />
			<span>
				Unpaid in Shopify, but the courier collected less — check if money came another way (bank transfer) or it was sent free:
				{#each p.shortCollected as o, i (o.name)}{i ? ', ' : ' '}<a href="/orders?view=all&q={o.name}" class="underline">#{o.name}</a>
					(due {formatRs(o.outstanding)}, collected {formatRs(o.cod)}){/each}.
				These are counted as sales at the Shopify total.
			</span>
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Net sales">{formatRs(p.sales.net)}</Stat>
		<Stat label="Gross margin">{formatPct(p.kpi.grossMargin)}</Stat>
		<Stat label={p.netProfit >= 0 ? 'Net profit' : 'Net loss'}>
			<span class={p.netProfit < 0 ? 'text-danger' : 'text-success'}>{formatRs(p.netProfit)}</span>
		</Stat>
		<Stat label="Net margin">{formatPct(p.kpi.netMargin)}</Stat>
		<Stat label="Delivered orders">{p.kpi.orders}</Stat>
		<Stat label="Average order">{formatRs(p.kpi.aov)}</Stat>
		<Stat label="Return rate" hint="{p.courier.returned} returned of {p.courier.delivered + p.courier.returned}">
			{formatPct(p.kpi.returnRate)}
		</Stat>
		<Stat label="Courier cost per order">{formatRs(p.kpi.courierPerOrder)}</Stat>
	</div>

	<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
		<Card.Root>
			<Card.Header><Card.Title>Profit & loss</Card.Title></Card.Header>
			<Card.Content class="px-0">
				<Table.Root>
					<Table.Body>
						{#each lines as l, i (i)}
							<Table.Row
								class={[
									l.kind === 'sub' && 'font-medium',
									l.kind === 'total' && 'bg-muted/50 font-semibold',
									l.kind === 'grand' && 'bg-muted text-base font-semibold'
								]}
							>
								<Table.Cell class={['pl-6', l.indent && 'pl-10 text-muted-foreground']}>
									{l.label}
									{#if l.hint}<span class="ml-1 text-xs font-normal text-muted-foreground">· {l.hint}</span>{/if}
								</Table.Cell>
								<Table.Cell class="pr-6 text-right"><Money paisa={l.value} muted /></Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Profit by product</Card.Title>
				<Card.Description>Item sales after discounts, before shipping and courier costs.</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">Product</Table.Head>
							<Table.Head class="text-right">Units</Table.Head>
							<Table.Head class="text-right">Sales</Table.Head>
							<Table.Head class="text-right">Cost</Table.Head>
							<Table.Head class="pr-6 text-right">Profit</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each products as r (r.productKey)}
							<Table.Row>
								<Table.Cell class="max-w-64 truncate pl-6" title={r.product}>
									{r.product}
									{#if r.unitsNoCost}<StatusBadge tone="danger" label="no cost" />{/if}
								</Table.Cell>
								<Table.Cell class="num text-right">{r.units}</Table.Cell>
								<Table.Cell class="text-right"><Money paisa={r.sales} /></Table.Cell>
								<Table.Cell class="text-right"><Money paisa={r.cogs} muted /></Table.Cell>
								<Table.Cell class="pr-6 text-right">
									<Money paisa={r.profit} />
									<div class="text-xs text-muted-foreground">{r.sales ? formatPct(r.profit / r.sales, 0) : ''}</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={5} class="py-10 text-center text-muted-foreground">No deliveries this month.</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
			{#if p.products.length > 15}
				<Card.Footer>
					<Button variant="ghost" size="sm" onclick={() => (showAll = !showAll)}>
						{showAll ? 'Show top 15' : `Show all ${p.products.length}`}
					</Button>
				</Card.Footer>
			{/if}
		</Card.Root>
	</div>
</div>
