<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Info from '@lucide/svelte/icons/info';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import { dateLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = $derived(data.totals);

	const PRESETS = [
		{ id: 'today', label: 'Today' },
		{ id: 'yesterday', label: 'Yesterday' },
		{ id: '3d', label: 'Last 3 days' },
		{ id: '7d', label: 'Last 7 days' },
		{ id: '30d', label: 'Last 30 days' }
	] as const;
	const STATE: Record<
		string,
		{ tone: 'success' | 'danger' | 'info' | 'warning' | 'muted'; label: string }
	> = {
		delivered: { tone: 'success', label: 'delivered' },
		returned: { tone: 'danger', label: 'returned' },
		in_transit: { tone: 'info', label: 'in transit' },
		shipped: { tone: 'warning', label: 'shipped · no courier data' },
		not_shipped: { tone: 'muted', label: 'not shipped' }
	};

	const period = $derived(
		data.from === data.to ? dateLabel(data.from) : `${dateLabel(data.from)} – ${dateLabel(data.to)}`
	);
	const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');
	const fmtTime = (iso: string) =>
		new Date(iso).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Karachi'
		});
</script>

<div class="grid gap-6">
	<div class="grid gap-3">
		<a
			href="/reports"
			class="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft class="size-4" /> Reports
		</a>
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Order profit · {period}</h1>
			<p class="text-sm text-muted-foreground">
				Every order placed in the period. Delivered and returned orders use real figures; orders not
				finished yet are estimated.
			</p>
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-1" data-sveltekit-noscroll>
		{#each PRESETS as x (x.id)}
			<Button href="?p={x.id}" size="sm" variant={data.preset === x.id ? 'secondary' : 'ghost'}
				>{x.label}</Button
			>
		{/each}
		<form method="GET" class="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">
			<input type="hidden" name="p" value="custom" />
			<Input
				type="date"
				name="from"
				value={data.from}
				required
				class="h-8 flex-1 sm:w-36"
				aria-label="From"
			/>
			<span class="text-muted-foreground">–</span>
			<Input
				type="date"
				name="to"
				value={data.to}
				required
				class="h-8 flex-1 sm:w-36"
				aria-label="To"
			/>
			<Button type="submit" size="sm" variant={data.preset === 'custom' ? 'secondary' : 'outline'}
				>Show</Button
			>
		</form>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat
			label="Orders placed"
			hint="{t.done.count} finished · {t.pending.count} not finished{data.cancelled
				? ` · ${data.cancelled} cancelled (not counted)`
				: ''}">{t.orders}</Stat
		>
		<Stat label="Sales">{formatRs(t.sales)}</Stat>
		<Stat
			label="Gross profit{t.pending.count ? ' (part est.)' : ''}"
			hint="{formatPct(t.sales ? t.profit / t.sales : NaN, 0)} of sales · before ads & fixed costs"
		>
			<span class={t.profit < 0 ? 'text-danger' : ''}>{formatRs(t.profit)}</span>
		</Stat>
		<Stat
			label="After usual returns (est.)"
			hint="{formatPct(data.rates.returnRate, 1)} of open parcels usually come back"
		>
			{formatRs(t.done.profit + t.pending.afterReturns)}
		</Stat>
	</div>

	<div class="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
		<div class="flex items-center justify-between gap-3">
			<span class="text-muted-foreground">Finished orders ({t.done.count}) — real</span>
			<span class={['num font-medium', t.done.profit < 0 && 'text-danger']}
				>{formatRs(t.done.profit)}</span
			>
		</div>
		<div class="flex items-center justify-between gap-3">
			<span class="text-muted-foreground">Not finished ({t.pending.count}) — estimated</span>
			<span class="num font-medium">{formatRs(t.pending.profit)}</span>
		</div>
		<div class="flex items-center justify-between gap-3">
			<span class="text-muted-foreground">Product cost</span><Money paisa={-t.cogs} muted />
		</div>
		<div class="flex items-center justify-between gap-3">
			<span class="text-muted-foreground">Courier fees + tax</span><Money
				paisa={-(t.courier + t.tax)}
				muted
			/>
		</div>
	</div>

	{#if t.pending.count || t.costMissing}
		<div class="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
			<Info class="mt-0.5 size-4 shrink-0" />
			<span>
				{#if t.pending.count}Estimates use the parcel's own courier fee when PostEx has sent it,
					otherwise the usual {formatRs(data.rates.usualFee)}, and the usual {formatPct(
						data.rates.taxRate,
						1
					)} courier tax.{/if}
				{#if t.costMissing}<span class="text-warning"
						>{t.costMissing} order{t.costMissing === 1 ? ' has' : 's have'} items with no cost — profit
						is overstated.</span
					>{/if}
			</span>
		</div>
	{/if}

	<Card.Root>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root sticky>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Order</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Sales</Table.Head>
						<Table.Head class="text-right">Product cost</Table.Head>
						<Table.Head class="text-right">Courier fee</Table.Head>
						<Table.Head class="text-right">Courier tax</Table.Head>
						<Table.Head class="text-right">Gross profit</Table.Head>
						<Table.Head class="pr-6 text-right">Margin</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r (r.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<a href="/orders/{r.name}" class="font-medium hover:underline">#{r.name}</a>
								<div class="text-xs text-muted-foreground">
									{fmtTime(r.createdAt)} · {r.isPrepaid ? 'Advance' : 'COD'}{r.customer
										? ` · ${r.customer}`
										: ''}
								</div>
							</Table.Cell>
							<Table.Cell>
								<StatusBadge
									tone={STATE[r.state]?.tone ?? 'muted'}
									label={STATE[r.state]?.label ?? r.state}
								/>
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if r.state === 'returned'}<span class="text-muted-foreground">—</span
									>{:else}<Money paisa={r.sales} />{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={-r.cogs} muted />
								{#if r.costMissing}<div class="text-xs text-warning">no cost</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-r.courier} muted /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={-r.tax} muted /></Table.Cell>
							<Table.Cell class={['text-right font-medium', r.profit < 0 && 'text-danger']}>
								{formatRs(r.profit)}
								{#if r.estimated}<div class="text-xs font-normal text-muted-foreground">
										est.
									</div>{/if}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right text-sm text-muted-foreground">
								{r.sales ? pct(r.profit / r.sales) : '—'}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
								No orders placed {data.preset === 'today' ? 'today yet' : 'in this period'}.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
