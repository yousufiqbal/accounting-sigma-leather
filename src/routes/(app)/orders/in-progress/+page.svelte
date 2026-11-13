<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Info from '@lucide/svelte/icons/info';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = $derived(data.totals);

	const COURIER: Record<string, string> = { postex: 'PostEx', dex: 'DEX', manual: 'Manual' };
	const STATE = {
		not_shipped: { tone: 'muted', label: 'not shipped' },
		in_transit: { tone: 'info', label: 'in transit' },
		shipped: { tone: 'warning', label: 'shipped · no courier data' }
	} as const;
	const pct = (r: number, d = 0) => (Number.isFinite(r) ? `${(r * 100).toFixed(d)}%` : '—');
	const daysAgo = (iso: string) => {
		const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
		return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
	};
</script>

<div class="grid gap-6">
	<div class="grid gap-3">
		<a
			href="/orders"
			class="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft class="size-4" /> Orders
		</a>
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">In progress</h1>
			<p class="text-sm text-muted-foreground">
				Orders not delivered or returned yet, with expected profit. Estimates only — not counted in
				any report until delivered.
			</p>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Open orders" hint="{t.notShipped} not shipped yet">{t.count}</Stat>
		<Stat label="Order value">{formatRs(t.sales)}</Stat>
		<Stat label="Expected profit (est.)" hint="If every order is delivered">
			{formatRs(t.profit)}
			<span class="text-sm font-normal text-muted-foreground">{pct(t.profit / t.sales)}</span>
		</Stat>
		<Stat
			label="After usual returns (est.)"
			hint="{pct(data.rates.returnRate, 1)} of recent parcels came back"
		>
			{formatRs(t.afterReturns)}
		</Stat>
	</div>

	<div class="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
		<Info class="mt-0.5 size-4 shrink-0" />
		<span>
			Courier fee: the parcel's own fee when PostEx has sent it, otherwise the usual
			{formatRs(data.rates.usualFee)}; none for advance orders sent without tracking. Courier tax:
			the usual {pct(data.rates.taxRate, 1)} of cash to collect.
			{#if t.unitsNoCost}<span class="text-warning"
					>{t.unitsNoCost} unit{t.unitsNoCost === 1 ? ' has' : 's have'} no cost — profit is overstated.</span
				>{/if}
		</span>
	</div>

	<Card.Root>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Order</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Sales</Table.Head>
						<Table.Head class="text-right">Product cost</Table.Head>
						<Table.Head class="text-right">Courier fee</Table.Head>
						<Table.Head class="text-right">Courier tax</Table.Head>
						<Table.Head class="text-right">Expected profit</Table.Head>
						<Table.Head class="pr-6 text-right">Margin</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.orders as o (o.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<a href="/orders/{o.name}" class="font-medium hover:underline">#{o.name}</a>
								<div class="text-xs text-muted-foreground">
									{o.isPrepaid ? 'Advance' : 'COD'} · {daysAgo(o.createdAt)}
								</div>
							</Table.Cell>
							<Table.Cell>
								<StatusBadge tone={STATE[o.state].tone} label={STATE[o.state].label} />
								{#each o.parcels as p (p.trackingNo)}
									<div class="mt-0.5 text-xs text-muted-foreground">
										{COURIER[p.courier] ?? p.courier}{p.label ? ` · ${p.label}` : ''}
									</div>
								{/each}
							</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={o.sales} /></Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={-o.cogs} muted />
								{#if o.unitsNoCost}<div class="text-xs text-warning">
										{o.unitsNoCost} no cost
									</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={-o.courier} muted />
								{#if !o.courierKnown && o.courier}<div class="text-xs text-muted-foreground">
										usual
									</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-o.tax} muted /></Table.Cell>
							<Table.Cell class={['text-right font-medium', o.profit < 0 && 'text-danger']}>
								{formatRs(o.profit)}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right text-sm text-muted-foreground"
								>{pct(o.margin)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
								Nothing in progress — every order is delivered or returned.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
