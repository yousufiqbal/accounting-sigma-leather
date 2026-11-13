<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SORT_LABEL = {
		profit: 'Most profit',
		orders: 'Most orders',
		worst: 'Most returns',
		recent: 'Last order'
	} as const;

	function href(changes: Record<string, string | number | null>) {
		const p = new URLSearchParams(page.url.searchParams.toString());
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '') p.delete(k);
			else p.set(k, String(v));
		}
		if (!('page' in changes)) p.delete('page');
		return `?${p}`;
	}
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
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Customers</h1>
			<p class="text-sm text-muted-foreground">
				Profit per Shopify customer, all time. Same order profit as the Orders page.
			</p>
		</div>
		<form method="GET" class="w-full sm:w-auto" data-sveltekit-keepfocus>
			{#each [...page.url.searchParams].filter(([k]) => k !== 'q' && k !== 'page') as [k, v] (k)}
				<input type="hidden" name={k} value={v} />
			{/each}
			<Input
				name="q"
				value={data.q}
				placeholder="Name, phone or city"
				class="h-9 w-full sm:w-56"
				type="search"
			/>
		</form>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Customers">{data.totals.customers}</Stat>
		<Stat label="Repeat buyers" hint="2 or more delivered orders">{data.totals.repeat}</Stat>
		<Stat label="Order profit, all time">{formatRs(data.totals.profit)}</Stat>
		<Stat label="Risky" hint="2 or more returned orders">
			<a href={href({ risky: data.risky ? null : '1' })} class="text-danger hover:underline"
				>{data.totals.risky}</a
			>
		</Stat>
	</div>

	<Card.Root>
		<Card.Header class="gap-3" data-sveltekit-noscroll>
			<div class="flex flex-wrap items-center gap-1">
				<span class="mr-1 text-xs text-muted-foreground">Sort</span>
				{#each Object.entries(SORT_LABEL) as [k, label] (k)}
					<Button
						href={href({ sort: k === 'profit' ? null : k })}
						size="xs"
						variant={data.sort === k ? 'secondary' : 'ghost'}>{label}</Button
					>
				{/each}
				<Button
					href={href({ risky: data.risky ? null : '1' })}
					size="xs"
					variant={data.risky ? 'secondary' : 'ghost'}
					class="ml-auto">{data.risky ? '✓ ' : ''}Risky only</Button
				>
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Customer</Table.Head>
						<Table.Head class="text-right">Orders</Table.Head>
						<Table.Head class="text-right">Delivered</Table.Head>
						<Table.Head class="text-right">Returned</Table.Head>
						<Table.Head class="text-right">Sales</Table.Head>
						<Table.Head class="text-right">Profit</Table.Head>
						<Table.Head class="text-right">Avg / order</Table.Head>
						<Table.Head class="pr-6 text-right">Last order</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.customers as c (c.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<div class="flex items-center gap-2">
									<a href="/customers/{c.id}" class="font-medium hover:underline"
										>{c.name || 'No name'}</a
									>
									{#if c.risky}<StatusBadge tone="danger" label="risky" />{/if}
								</div>
								<div class="text-xs text-muted-foreground">
									{[c.phone, c.city].filter(Boolean).join(' · ')}
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">
								{c.orders}
								{#if c.open}<div class="text-xs text-muted-foreground">{c.open} open</div>{/if}
							</Table.Cell>
							<Table.Cell class="num text-right">{c.delivered}</Table.Cell>
							<Table.Cell class={['num text-right', c.returned && 'text-danger']}>
								{c.returned}
								{#if c.returned}<div class="text-xs">{pct(c.returnRate)}</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">{formatRs(c.sales)}</Table.Cell>
							<Table.Cell class={['text-right font-medium', c.profit < 0 && 'text-danger']}>
								{formatRs(c.profit)}
							</Table.Cell>
							<Table.Cell class="text-right text-sm text-muted-foreground">
								{c.delivered ? formatRs(c.avgProfit) : '—'}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right text-sm">{fmtDate(c.lastOrder)}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
								No customers found.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		{#if data.pageCount > 1}
			<Card.Footer class="flex items-center justify-between text-sm text-muted-foreground">
				<span>{data.totalRows} customers · page {data.page} of {data.pageCount}</span>
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
