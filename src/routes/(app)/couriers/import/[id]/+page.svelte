<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
	let show = $state<'changes' | 'all'>('changes');

	const visible = $derived(
		show === 'all' ? data.rows : data.rows.filter((r) => r.kind !== 'unchanged')
	);
	const MONEY_FIELDS = new Set([
		'cod',
		'fee',
		'feeTax',
		'returnFee',
		'returnFeeTax',
		'otherFees',
		'itwh',
		'stwh',
		'netPayable'
	]);
	const fmt = (field: string, v: unknown) => {
		if (v === null || v === undefined || v === '') return '—';
		if (MONEY_FIELDS.has(field) && typeof v === 'number') return (v / 100).toLocaleString('en-PK');
		if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v))
			return new Date(v).toLocaleString('en-GB', {
				timeZone: 'Asia/Karachi',
				dateStyle: 'short',
				timeStyle: 'short'
			});
		return String(v);
	};
	const blocked = $derived(data.errors.length > 0);
	const nothingToDo = $derived(data.counts.new + data.counts.updated + data.counts.conflict === 0);
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Review import</h1>
			<p class="text-sm text-muted-foreground">
				{data.filename} · {data.courier === 'dex' ? 'DEX statement' : 'PostEx export'} · {data.rows
					.length} parcels in
				{data.statementCount} statement{data.statementCount === 1 ? '' : 's'}
			</p>
		</div>
		<div class="flex gap-2">
			<form method="POST" action={formAction('discard')} use:enhance>
				<Button type="submit" variant="ghost">Discard</Button>
			</form>
			<form
				method="POST"
				action={formAction('commit')}
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await update();
						busy = false;
					};
				}}
			>
				<Button type="submit" disabled={blocked || busy}>
					{busy ? 'Importing…' : nothingToDo ? 'Mark file as imported' : 'Import'}
				</Button>
			</form>
		</div>
	</div>

	{#if form?.error}
		<div
			class="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	{#if data.errors.length}
		<div
			class="grid gap-1 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
			role="alert"
		>
			<div class="flex items-center gap-2 font-medium">
				<TriangleAlert class="size-4" /> Can't import — the file has problems:
			</div>
			<ul class="list-disc pl-6">
				{#each data.errors.slice(0, 20) as e, i (i)}<li>{e}</li>{/each}
			</ul>
			{#if data.errors.length > 20}<div>…and {data.errors.length - 20} more</div>{/if}
		</div>
	{/if}
	{#if data.warnings.length}
		<div
			class="grid gap-1 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
		>
			<ul class="list-disc pl-6">
				{#each data.warnings.slice(0, 10) as w, i (i)}<li>{w}</li>{/each}
			</ul>
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		<Stat label="New parcels">{data.counts.new}</Stat>
		<Stat label="Updated">{data.counts.updated}</Stat>
		<Stat label="Already up to date">{data.counts.unchanged}</Stat>
		<Stat label="Conflicts (not applied)">{data.counts.conflict}</Stat>
	</div>

	<Card.Root>
		<Card.Header class="flex flex-row items-center justify-between">
			<Card.Title>Rows</Card.Title>
			<div class="flex gap-1">
				<Button
					size="sm"
					variant={show === 'changes' ? 'secondary' : 'ghost'}
					onclick={() => (show = 'changes')}>Changes only</Button
				>
				<Button
					size="sm"
					variant={show === 'all' ? 'secondary' : 'ghost'}
					onclick={() => (show = 'all')}>All rows</Button
				>
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Result</Table.Head>
						<Table.Head>Order</Table.Head>
						<Table.Head>Tracking</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">COD</Table.Head>
						<Table.Head class="text-right">Net</Table.Head>
						<Table.Head class="pr-6">What changes</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each visible as r (r.trackingNo)}
						<Table.Row>
							<Table.Cell class="pl-6"><StatusBadge status={r.kind} /></Table.Cell>
							<Table.Cell>
								{#if r.orderName}#{r.orderName}{:else}<StatusBadge
										status="unmatched"
										label={r.orderRefRaw ?? 'no order'}
									/>{/if}
							</Table.Cell>
							<Table.Cell class="num text-xs">{r.trackingNo}</Table.Cell>
							<Table.Cell><StatusBadge status={r.status} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={r.cod} muted /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={r.netPayable} decimals /></Table.Cell>
							<Table.Cell class="pr-6 text-xs">
								{#if r.conflict}
									<span class="text-danger">{r.conflict}</span>
								{:else if r.diff}
									<ul class="grid gap-0.5">
										{#each Object.entries(r.diff) as [field, [from, to]] (field)}
											<li>
												<span class="text-muted-foreground">{field}:</span>
												{fmt(field, from)} → <span class="font-medium">{fmt(field, to)}</span>
											</li>
										{/each}
									</ul>
								{:else if r.kind === 'new'}
									<span class="text-muted-foreground"
										>new parcel{r.statementNumber ? ` · ${r.statementNumber}` : ''}</span
									>
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={7} class="py-10 text-center text-muted-foreground">
								Nothing changes — every parcel in this file is already up to date.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
