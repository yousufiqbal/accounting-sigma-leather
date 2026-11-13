<script lang="ts">
	import { goto } from '$app/navigation';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import { monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const c = $derived(data.current);

	const DEX_STALE_DAYS = 7;
	const dexDays = $derived(
		data.sync.lastDex ? Math.floor((Date.now() - Date.parse(data.sync.lastDex)) / 86_400_000) : null
	);
	/** Things only the owner can fix, each linking to where it's done. */
	const todo = $derived(
		[
			data.todo.customNoCost && {
				text: `${data.todo.customNoCost} custom item${data.todo.customNoCost === 1 ? ' on a delivered order has' : 's on delivered orders have'} no cost`,
				href: '/orders/no-cost'
			},
			data.stock.missing && {
				text: `${data.stock.missing} in-stock product${data.stock.missing === 1 ? ' has' : 's have'} no cost`,
				href: '/inventory/opening'
			},
			data.attention.inventory && {
				text: `${data.attention.inventory} stock change${data.attention.inventory === 1 ? '' : 's'} made in Shopify to review`,
				href: '/inventory'
			},
			data.attention.couriers && {
				text: `${data.attention.couriers} parcel${data.attention.couriers === 1 ? ' is' : 's are'} not linked to an order or conflicting`,
				href: '/couriers?view=attention'
			},
			data.todo.noCourierData && {
				text: `${data.todo.noCourierData} shipped order${data.todo.noCourierData === 1 ? '' : 's'} with no courier data`,
				href: '/orders?view=nocourier'
			},
			(dexDays === null || dexDays >= DEX_STALE_DAYS) && {
				text:
					dexDays === null
						? 'No DEX statement imported yet'
						: `DEX statement last imported ${dexDays} days ago`,
				href: '/couriers'
			},
			data.todo.noExpenses.length && {
				text: `No expenses entered for ${data.todo.noExpenses.map(monthLabel).join(', ')}`,
				href: `/expenses?m=${data.todo.noExpenses[0]}`
			}
		].filter(Boolean) as { text: string; href: string }[]
	);
</script>

<div class="grid gap-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
		<p class="text-sm text-muted-foreground">
			{monthLabel(c.month)} · <a href="/reports" class="underline">full income statement</a>
		</p>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat
			label={c.netProfit >= 0 ? 'Net profit' : 'Net loss'}
			hint="{formatPct(c.kpi.netMargin)} of net sales{c.status === 'provisional'
				? ' · provisional'
				: ''}"
		>
			<span class={c.netProfit < 0 ? 'text-danger' : 'text-success'}>{formatRs(c.netProfit)}</span>
		</Stat>
		<Stat label="Net sales" hint="{c.kpi.orders} delivered orders">{formatRs(c.sales.net)}</Stat>
		<Stat
			label="Courier owes you"
			hint="{data.owed.parcels} delivered parcels not yet on a statement"
		>
			{formatRs(Number(data.owed.amount))}
		</Stat>
		<Stat
			label="Stock value (at cost)"
			hint={data.stock.missing ? `${data.stock.missing} in-stock variants have no cost` : undefined}
		>
			{formatRs(Number(data.stock.value))}
		</Stat>
	</div>

	{#if todo.length}
		<Card.Root>
			<Card.Header>
				<Card.Title>To do</Card.Title>
				<Card.Description>Things that keep the numbers right.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-1 px-3">
				{#each todo as t (t.href)}
					<a
						href={t.href}
						class="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
					>
						<CircleAlert class="size-4 shrink-0 text-warning" />
						<span class="flex-1">{t.text}</span>
						<ChevronRight class="size-4 text-muted-foreground" />
					</a>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Month by month</Card.Title>
			<Card.Description>Every month since the first sale, by delivery month.</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Month</Table.Head>
						<Table.Head class="text-right">Orders</Table.Head>
						<Table.Head class="text-right">Net sales</Table.Head>
						<Table.Head class="text-right">Gross profit</Table.Head>
						<Table.Head class="text-right">Courier</Table.Head>
						<Table.Head class="text-right">Expenses</Table.Head>
						<Table.Head class="pr-6 text-right">Net profit</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each [...data.trend].reverse() as t (t.month)}
						<Table.Row
							class={[
								'cursor-pointer hover:bg-muted/40',
								t.month === data.current.month && 'bg-muted/60'
							]}
							onclick={() => goto(`/reports?m=${t.month}`)}
						>
							<Table.Cell class="pl-6">
								<a href="/reports?m={t.month}" class="hover:underline">{monthLabel(t.month)}</a>
								{#if t.status !== 'final'}<StatusBadge status={t.status} />{/if}
							</Table.Cell>
							<Table.Cell class="num text-right">{t.orders}</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={t.netSales} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={t.grossProfit} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-t.courier} muted /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-t.expenses} muted /></Table.Cell>
							<Table.Cell class="pr-6 text-right font-medium"
								><Money paisa={t.netProfit} colored /></Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
