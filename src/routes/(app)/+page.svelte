<script lang="ts">
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
	const maxAbs = $derived(Math.max(1, ...data.trend.map((t) => Math.abs(t.netProfit))));
	const short = (m: string) => {
		const [y, mm] = m.split('-').map(Number);
		return new Date(Date.UTC(y, mm - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
	};
</script>

<div class="grid gap-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
		<p class="text-sm text-muted-foreground">
			{monthLabel(c.month)} · <a href="/reports" class="underline">full income statement</a>
		</p>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label={c.netProfit >= 0 ? 'Net profit' : 'Net loss'} hint="{formatPct(c.kpi.netMargin)} of net sales{c.status === 'provisional' ? ' · provisional' : ''}">
			<span class={c.netProfit < 0 ? 'text-danger' : 'text-success'}>{formatRs(c.netProfit)}</span>
		</Stat>
		<Stat label="Net sales" hint="{c.kpi.orders} delivered orders">{formatRs(c.sales.net)}</Stat>
		<Stat label="Courier owes you" hint="{data.owed.parcels} delivered parcels not yet on a statement">
			{formatRs(Number(data.owed.amount))}
		</Stat>
		<Stat label="Stock value (at cost)" hint={data.stock.missing ? `${data.stock.missing} in-stock variants have no cost` : undefined}>
			{formatRs(Number(data.stock.value))}
		</Stat>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Month by month</Card.Title>
			<Card.Description>Net profit, by delivery month.</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex h-40 items-stretch gap-2" role="img" aria-label="Net profit by month">
				{#each data.trend as t (t.month)}
					<div class="flex flex-1 flex-col items-center gap-1" title="{monthLabel(t.month)}: {formatRs(t.netProfit)}">
						<div class="flex w-full flex-1 flex-col justify-end">
							{#if t.netProfit >= 0}
								<div class="mx-auto w-full max-w-10 rounded-t bg-success" style:height="{(t.netProfit / maxAbs) * 50}%"></div>
							{/if}
						</div>
						<div class="h-px w-full bg-border"></div>
						<div class="flex w-full flex-1 flex-col justify-start">
							{#if t.netProfit < 0}
								<div class="mx-auto w-full max-w-10 rounded-b bg-danger" style:height="{(-t.netProfit / maxAbs) * 50}%"></div>
							{/if}
						</div>
						<span class="text-xs text-muted-foreground">{short(t.month)}</span>
					</div>
				{/each}
			</div>
		</Card.Content>
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
						<Table.Row>
							<Table.Cell class="pl-6">
								<a href="/reports?m={t.month}" class="hover:underline">{monthLabel(t.month)}</a>
								{#if t.status !== 'final'}<StatusBadge status={t.status} />{/if}
							</Table.Cell>
							<Table.Cell class="num text-right">{t.orders}</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={t.netSales} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={t.grossProfit} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-t.courier} muted /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-t.expenses} muted /></Table.Cell>
							<Table.Cell class="pr-6 text-right font-medium"><Money paisa={t.netProfit} colored /></Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
