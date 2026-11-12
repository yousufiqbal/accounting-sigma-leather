<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Money from '#lib/components/app/money.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let open = $state(false);
	let currency = $state<'RMB' | 'PKR'>('RMB');

	const STATUS = {
		draft: { tone: 'muted', label: 'draft' },
		paid: { tone: 'info', label: 'paid · on the way' },
		landing: { tone: 'warning', label: 'adding to stock…' },
		landed: { tone: 'success', label: 'landed' }
	} as const;
	const fmtDate = (d: string | null) =>
		d ? new Date(`${d}T12:00:00+05:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Purchases</h1>
			<p class="text-sm text-muted-foreground">
				Stock bought from suppliers — China or local. Marking a purchase arrived adds the stock in Shopify and updates average cost.
			</p>
		</div>
		<Button onclick={() => (open = true)}><Plus /> New purchase</Button>
	</div>

	<Card.Root>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Purchase</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Items</Table.Head>
						<Table.Head class="text-right">Units</Table.Head>
						<Table.Head class="text-right">Weight</Table.Head>
						<Table.Head class="text-right">Goods</Table.Head>
						<Table.Head class="text-right">DDP + other</Table.Head>
						<Table.Head class="pr-6 text-right">Landed total</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.batches as b (b.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<a href="/purchases/{b.id}" class="font-medium hover:underline">{b.ref}</a>
								<div class="text-xs text-muted-foreground">
									{b.supplier ?? ''}{b.supplier ? ' · ' : ''}{b.currency === 'PKR'
										? 'Pakistani supplier'
										: `¥1 = Rs ${b.fxRateX10000 / 10_000}`}
								</div>
							</Table.Cell>
							<Table.Cell>
								<StatusBadge tone={STATUS[b.status].tone} label={STATUS[b.status].label} />
								{#if b.ddpPending && b.status !== 'landed'}<StatusBadge tone="warning" label="DDP pending" />{/if}
								<div class="text-xs text-muted-foreground">
									{b.status === 'landed' ? fmtDate(b.landedOn) : b.status === 'paid' ? fmtDate(b.paidOn) : ''}
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">{b.items}</Table.Cell>
							<Table.Cell class="num text-right">{b.totals.units}</Table.Cell>
							<Table.Cell class="num text-right">{(b.totals.weightG / 1000).toFixed(1)} kg</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={b.totals.goods} /></Table.Cell>
							<Table.Cell class="text-right"><Money paisa={b.totals.ddp + b.totals.extra} /></Table.Cell>
							<Table.Cell class="pr-6 text-right font-medium"><Money paisa={b.totals.landed} /></Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={8} class="py-10 text-center text-muted-foreground">
								No purchases yet. Stock you already have is costed on the Inventory page.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>

<Sheet.Root bind:open>
	<Sheet.Content side="right">
		<Sheet.Header>
			<Sheet.Title>New purchase</Sheet.Title>
			<Sheet.Description>Rates can be changed later until it arrives.</Sheet.Description>
		</Sheet.Header>
		<form method="POST" action={formAction('create')} use:enhance class="grid gap-4 px-4">
			{#if form?.error}
				<div class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
					<TriangleAlert class="mt-0.5 size-4 shrink-0" />{form.error}
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="ref">Name</Label>
				<Input id="ref" name="ref" placeholder="e.g. Nov-2026 batch 1" required />
			</div>
			<div class="grid gap-2">
				<Label for="supplier">Supplier (optional)</Label>
				<Input id="supplier" name="supplier" />
			</div>
			<div class="grid gap-2">
				<Label>Supplier prices in</Label>
				<div class="flex gap-2">
					{#each [['RMB', 'Yuan (China)'], ['PKR', 'Rupees (Pakistan)']] as [val, label] (val)}
						<label
							class={[
								'flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm',
								currency === val && 'border-primary bg-accent'
							]}
						>
							<input type="radio" name="currency" value={val} bind:group={currency} class="sr-only" />{label}
						</label>
					{/each}
				</div>
			</div>
			{#if currency === 'RMB'}
				<div class="grid gap-2">
					<Label for="fx">Rs paid per 1 yuan</Label>
					<Input id="fx" name="fx" inputmode="decimal" value={data.rates.rmbFx ? data.rates.rmbFx / 10_000 : ''} required />
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="ddp">DDP Rs per kg</Label>
				<Input
					id="ddp"
					name="ddp"
					inputmode="decimal"
					value={currency === 'RMB' && data.rates.ddpPerKg ? data.rates.ddpPerKg / 100 : '0'}
				/>
				{#if currency === 'PKR'}<p class="text-xs text-muted-foreground">Usually 0 for local suppliers.</p>{/if}
			</div>
			<Button type="submit">Create</Button>
		</form>
	</Sheet.Content>
</Sheet.Root>
