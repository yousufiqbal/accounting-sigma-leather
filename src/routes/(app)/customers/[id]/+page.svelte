<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import { currentMonth, monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const c = $derived(data.customer);
	const s = $derived(data.summary);

	const STATE = {
		delivered: { tone: 'success', label: 'delivered' },
		returned: { tone: 'danger', label: 'returned' },
		open: { tone: 'info', label: 'in progress' },
		cancelled: { tone: 'muted', label: 'cancelled' }
	} as const;
	const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');
	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'Asia/Karachi'
				})
			: '—';
</script>

<div class="grid gap-6">
	<div class="grid gap-3">
		<a
			href="/customers"
			class="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft class="size-4" /> Customers
		</a>
		<div>
			<h1 class="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
				{c.name || 'No name'}
				{#if s.risky}<StatusBadge tone="danger" label="risky · {s.returned} returns" />{/if}
			</h1>
			<p class="text-sm text-muted-foreground">
				{[c.phone, c.city].filter(Boolean).join(' · ')}
				{#if s.firstOrder}· customer since {fmtDate(s.firstOrder)}{/if}
			</p>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat
			label="Orders"
			hint="{s.delivered} delivered · {s.returned} returned{s.open
				? ` · ${s.open} open`
				: ''}{s.cancelled ? ` · ${s.cancelled} cancelled` : ''}"
		>
			{s.orders}
		</Stat>
		<Stat label="Sales">{formatRs(s.sales)}</Stat>
		<Stat
			label="Profit"
			hint={s.delivered
				? `Avg ${formatRs(s.avgProfit)} per delivered order`
				: 'No delivered orders'}
		>
			<span class={s.profit < 0 ? 'text-danger' : ''}>{formatRs(s.profit)}</span>
		</Stat>
		<Stat label="Return rate" hint="{s.advance} paid in advance">
			<span class={s.returned ? 'text-danger' : ''}>{pct(s.returnRate)}</span>
		</Stat>
	</div>

	<Card.Root>
		<Card.Header><Card.Title>Orders</Card.Title></Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root sticky>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Order</Table.Head>
						<Table.Head>Placed</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Sales</Table.Head>
						<Table.Head class="text-right">Profit</Table.Head>
						<Table.Head class="pr-6 text-right">Margin</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.orders as o (o.id)}
						<Table.Row class={o.state === 'cancelled' ? 'opacity-60' : ''}>
							<Table.Cell class="pl-6">
								<a href="/orders/{o.name}" class="font-medium hover:underline">#{o.name}</a>
								<div class="text-xs text-muted-foreground">{o.isPrepaid ? 'Advance' : 'COD'}</div>
							</Table.Cell>
							<Table.Cell class="text-sm">{fmtDate(o.createdAt)}</Table.Cell>
							<Table.Cell>
								<StatusBadge tone={STATE[o.state].tone} label={STATE[o.state].label} />
								{#if o.profit}<div class="mt-0.5 text-xs text-muted-foreground">
										{monthLabel(currentMonth(new Date(o.profit.at)))}
									</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if o.profit}<Money paisa={o.profit.sales} />{:else}<span
										class="text-muted-foreground"><Money paisa={o.total} muted /></span
									>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if o.profit}
									<span class={['font-medium', o.profit.profit < 0 && 'text-danger']}
										>{formatRs(o.profit.profit)}</span
									>
								{:else}<span class="text-muted-foreground">—</span>{/if}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right text-sm text-muted-foreground">
								{o.profit ? pct(o.profit.margin) : '—'}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
