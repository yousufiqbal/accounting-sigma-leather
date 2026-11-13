<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Upload from '@lucide/svelte/icons/upload';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { formatPct, formatRs } from '#lib/money.js';
	import { monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let uploading = $state(false);

	const COURIER_LABEL: Record<string, string> = {
		postex: 'PostEx',
		dex: 'DEX',
		manual: 'No courier / assumed'
	};

	/** Link to this page with some params changed (keeps month). */
	function href(changes: Record<string, string | number | null>) {
		const p = new URLSearchParams(page.url.searchParams.toString());
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '') p.delete(k);
			else p.set(k, String(v));
		}
		if (!('page' in changes)) p.delete('page');
		return `?${p}`;
	}

	const totals = $derived.by(() => {
		const t = {
			delivered: 0,
			returned: 0,
			cod: 0,
			deliveryFees: 0,
			returnFees: 0,
			taxes: 0,
			taxesEstimated: 0,
			net: 0
		};
		for (const r of data.monthRows)
			for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(r[k] ?? 0);
		return t;
	});
	const inTransit = $derived(data.statusRows.reduce((a, r) => a + Number(r.inTransit), 0));
	const unsettled = $derived(data.statusRows.reduce((a, r) => a + Number(r.unsettled), 0));
	const unsettledCount = $derived(
		data.statusRows.reduce((a, r) => a + Number(r.unsettledCount), 0)
	);
	const limitByCourier = $derived(new Map(data.thresholds.map((t) => [t.courier, t.limit])));

	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString('en-GB', {
					day: '2-digit',
					month: 'short',
					timeZone: 'Asia/Karachi'
				})
			: '—';

	const views = $derived([
		{ id: 'month', label: monthLabel(data.month) },
		{ id: 'transit', label: `In transit (${inTransit})` },
		{ id: 'attention', label: `Needs attention (${data.attentionCount})` },
		{ id: 'all', label: 'All' }
	]);

	const metricRows: {
		label: string;
		key: keyof typeof totals;
		money?: boolean;
		negative?: boolean;
	}[] = [
		{ label: 'Delivered parcels', key: 'delivered' },
		{ label: 'Returned parcels', key: 'returned' },
		{ label: 'COD collected', key: 'cod', money: true },
		{ label: 'Delivery fees + tax', key: 'deliveryFees', money: true, negative: true },
		{ label: 'Return fees + tax', key: 'returnFees', money: true, negative: true },
		{ label: 'Withholding (ITWH + STWH)', key: 'taxes', money: true, negative: true },
		{ label: 'Net from courier', key: 'net', money: true }
	];
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Couriers</h1>
			<p class="text-sm text-muted-foreground">
				{#if data.lastSync}
					PostEx last synced {new Date(data.lastSync.at).toLocaleString('en-GB', {
						timeZone: 'Asia/Karachi'
					})}
					{#if data.lastSync.ok === false}<span class="text-danger"> · failed</span>{/if}
				{:else}
					PostEx never synced
				{/if}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<form
				method="POST"
				action={formAction('upload')}
				enctype="multipart/form-data"
				use:enhance={() => {
					uploading = true;
					return async ({ update }) => {
						await update();
						uploading = false;
					};
				}}
				class="flex items-center gap-2"
			>
				<!-- The button is the file picker: choosing a file uploads it straight away. -->
				<label
					class={[
						'inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-muted',
						uploading && 'pointer-events-none opacity-60'
					]}
					title="DEX .xlsx statement or PostEx .csv export"
				>
					<Upload class="size-4" />
					{uploading ? 'Reading…' : 'Import file'}
					<input
						type="file"
						name="file"
						accept=".xlsx,.csv"
						class="sr-only"
						onchange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()}
					/>
				</label>
			</form>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="Delivered ({monthLabel(data.month)})">{totals.delivered}</Stat>
		<Stat label="Return rate" hint="{totals.returned} returned">
			{formatPct(totals.returned / (totals.delivered + totals.returned || 1))}
		</Stat>
		<Stat label="In transit now">{inTransit}</Stat>
		<Stat label="Couriers owe you" hint="{unsettledCount} parcels not yet in a payment"
			>{formatRs(unsettled)}</Stat
		>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>{monthLabel(data.month)} by courier</Card.Title>
			<Card.Description>
				Parcels whose final status (delivered / returned) falls in this month.
				{#if totals.taxesEstimated}
					<StatusBadge status="estimated" label="taxes estimated on {totals.taxesEstimated}" />
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head></Table.Head>
						{#each data.monthRows as r (r.courier)}
							<Table.Head class="text-right">{COURIER_LABEL[r.courier]}</Table.Head>
						{/each}
						<Table.Head class="text-right">Total</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each metricRows as m (m.key)}
						<Table.Row class={m.key === 'net' ? 'font-semibold' : ''}>
							<Table.Cell>{m.label}</Table.Cell>
							{#each data.monthRows as r (r.courier)}
								<Table.Cell class="text-right">
									{#if m.money}<Money
											paisa={(m.negative ? -1 : 1) * Number(r[m.key])}
										/>{:else}<span class="num">{r[m.key]}</span>{/if}
								</Table.Cell>
							{/each}
							<Table.Cell class="text-right">
								{#if m.money}<Money paisa={(m.negative ? -1 : 1) * totals[m.key]} />{:else}<span
										class="num">{totals[m.key]}</span
									>{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="text-muted-foreground">No data for this month yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

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
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#each ['all', 'postex', 'dex'] as c (c)}
					<Button
						href={href({ courier: c === 'all' ? null : c })}
						size="xs"
						variant={data.courier === c ? 'secondary' : 'ghost'}
					>
						{c === 'all' ? 'All couriers' : COURIER_LABEL[c]}
					</Button>
				{/each}
				<Button
					href={href({ assumed: data.showAssumed ? null : '1' })}
					size="xs"
					variant={data.showAssumed ? 'secondary' : 'ghost'}
					title="Orders counted as delivered without courier data (pickup, untracked, 14-day rule)"
				>
					{data.showAssumed ? '✓ Showing assumed' : 'Show assumed'}
				</Button>
				<form method="GET" class="flex w-full gap-2 sm:ml-auto sm:w-auto" data-sveltekit-keepfocus>
					{#each [...page.url.searchParams].filter(([k]) => k !== 'q' && k !== 'page') as [k, v] (k)}
						<input type="hidden" name={k} value={v} />
					{/each}
					<Input
						name="q"
						value={data.q}
						placeholder="Tracking or order #"
						class="h-8 w-full sm:w-48"
					/>
				</form>
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Order</Table.Head>
						<Table.Head>Tracking</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Final</Table.Head>
						<Table.Head class="text-right">COD</Table.Head>
						<Table.Head class="text-right">Fees</Table.Head>
						<Table.Head class="text-right">Tax</Table.Head>
						<Table.Head class="text-right">Net</Table.Head>
						<Table.Head class="pr-6">Payment</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.parcels as p (p.id)}
						{@const outlier = p.rawFee > (limitByCourier.get(p.courier) ?? Infinity)}
						<Table.Row>
							<Table.Cell class="pl-6">
								{#if p.orderName}
									{#if p.orderId}<a href="/orders/{p.orderName}" class="font-medium hover:underline"
											>#{p.orderName}</a
										>{:else}<span class="font-medium">#{p.orderName}</span>{/if}
									{#if p.extraParcel}<StatusBadge tone="muted" label="extra parcel" />{/if}
								{:else}
									<StatusBadge
										status={p.matchStatus === 'excluded' ? 'excluded' : 'unmatched'}
										label={`${p.orderRefRaw ?? 'no order'}${p.matchStatus === 'excluded' ? ' · excluded' : ''}`}
									/>
								{/if}
								{#if p.matchStatus === 'unmatched' && p.status !== 'cancelled'}
									<form
										method="POST"
										action={formAction('link')}
										use:enhance
										class="mt-1 flex items-center gap-1"
									>
										<input type="hidden" name="shipmentId" value={p.id} />
										<Input
											name="orderName"
											placeholder="#order"
											class="h-7 w-20 text-xs"
											required
										/>
										<Button type="submit" size="xs" variant="outline">Link</Button>
										<Button
											type="submit"
											size="xs"
											variant="ghost"
											formaction={formAction('exclude')}
											formnovalidate>Exclude</Button
										>
									</form>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="grid">
									<span class="num text-xs">{p.trackingNo}</span>
									<span class="text-xs text-muted-foreground"
										>{COURIER_LABEL[p.courier]}{p.weightKg ? ` · ${p.weightKg} kg` : ''}</span
									>
								</div>
							</Table.Cell>
							<Table.Cell>
								<StatusBadge status={p.status} />
								{#if p.conflictNote}
									<div class="mt-1 max-w-64 text-xs text-danger">{p.conflictNote}</div>
									<form method="POST" action={formAction('resolve')} use:enhance>
										<input type="hidden" name="shipmentId" value={p.id} />
										<Button type="submit" size="xs" variant="ghost">Mark reviewed</Button>
									</form>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-sm">{fmtDate(p.finalAt)}</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={p.cod} muted /></Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={-p.fee} decimals />
								{#if outlier}<div>
										<StatusBadge status="conflict" label="unusually high" />
									</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Money paisa={-p.taxes} decimals />
								{#if p.taxesEstimated}<div><StatusBadge status="estimated" /></div>{/if}
							</Table.Cell>
							<Table.Cell class="text-right font-medium"
								><Money paisa={p.netPayable} decimals /></Table.Cell
							>
							<Table.Cell class="pr-6 text-xs text-muted-foreground"
								>{p.statementNumber ?? '—'}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={9} class="py-10 text-center text-muted-foreground">
								No parcels here. Sync PostEx or import a DEX statement.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
		{#if data.pageCount > 1}
			<Card.Footer class="flex items-center justify-between text-sm text-muted-foreground">
				<span>{data.totalRows} parcels · page {data.page} of {data.pageCount}</span>
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
