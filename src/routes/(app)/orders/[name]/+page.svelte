<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Thumb from '#lib/components/app/thumb.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import CostSheet from '#lib/components/app/cost-sheet.svelte';
	import RecordDelivery from '#lib/components/app/record-delivery.svelte';
	import { COST_SOURCE } from '#lib/cost-source.js';
	import { formatRs } from '#lib/money.js';
	import { currentMonth, monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const o = $derived(data.order);
	const p = $derived(data.profit);

	let costSheet = $state<CostSheet>();
	let recorder = $state<RecordDelivery>();

	const COURIER: Record<string, string> = { postex: 'PostEx', dex: 'DEX', manual: 'Manual' };
	const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');
	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso.length === 10 ? `${iso}T12:00:00+05:00` : iso).toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'Asia/Karachi'
				})
			: '—';

	const lines = $derived(
		data.lines.map((l) => {
			const sales = l.qty * l.unitPrice - l.discount;
			const cost = l.qty * l.unitCost;
			return { ...l, sales, cost, profit: sales - cost };
		})
	);
	const itemsSales = $derived(lines.reduce((s, l) => s + l.sales, 0));
	const itemsCost = $derived(lines.reduce((s, l) => s + l.cost, 0));
	const payment = $derived(
		o.cancelledAt
			? 'Cancelled'
			: o.isPrepaid
				? o.outstanding > 0
					? 'Part advance'
					: 'Advance'
				: 'COD'
	);
	function discountLabel(d: { kind: string; label: string; value: string | number }) {
		const name = d.kind === 'prepaid' ? 'Advance discount' : d.label || 'Discount';
		const v = String(d.value);
		return `${name} · ${v.endsWith('%') ? v : formatRs(Math.round(Number(v) * 100))}`;
	}
	const backHref = $derived(p ? `/orders?m=${currentMonth(new Date(p.at))}` : '/orders');
</script>

<div class="grid gap-6">
	<div class="grid gap-3">
		<a
			href={backHref}
			class="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft class="size-4" /> Orders
		</a>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="grid gap-1">
				<h1 class="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
					Order #{o.name}
					{#if p}<StatusBadge status={p.outcome} />{:else if o.cancelledAt}<StatusBadge
							status="cancelled"
						/>{/if}
				</h1>
				<p class="text-sm text-muted-foreground">
					Placed {fmtDate(o.createdAt)} · {payment}
					{#if o.financialStatus}· Shopify: {o.financialStatus
							.toLowerCase()
							.replace(/_/g, ' ')}{/if}
					{#if o.fulfillmentStatus}· {o.fulfillmentStatus.toLowerCase().replace(/_/g, ' ')}{/if}
				</p>
				{#if o.tags.length}
					<div class="flex flex-wrap gap-1">
						{#each o.tags as t (t)}<StatusBadge tone="muted" label={t} />{/each}
					</div>
				{/if}
			</div>
			<div class="flex gap-2">
				{#if data.canRecord}
					<Button variant="outline" onclick={() => recorder?.show(o)}>Record delivery</Button>
				{/if}
				{#if data.shopifyUrl}
					<Button variant="outline" href={data.shopifyUrl} target="_blank" rel="noopener">
						Open in Shopify <ExternalLink />
					</Button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Items -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Items</Card.Title>
			{#if o.discountCodes.length}
				<Card.Description class="flex flex-wrap gap-1">
					{#each o.discountCodes as d, i (i)}
						<StatusBadge
							tone={d.kind === 'prepaid' ? 'success' : 'info'}
							label={discountLabel(d)}
						/>
					{/each}
				</Card.Description>
			{/if}
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Item</Table.Head>
						<Table.Head class="text-right">Qty</Table.Head>
						<Table.Head class="text-right">Price</Table.Head>
						<Table.Head class="text-right">Discount</Table.Head>
						<Table.Head class="text-right">Unit cost</Table.Head>
						<Table.Head class="pr-6 text-right">Profit</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each lines as l (l.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<div class="flex items-center gap-3">
									<Thumb src={l.imageUrl} alt={l.title} size={40} />
									<div class="min-w-0">
										<div class="max-w-72 truncate font-medium" title={l.productTitle ?? l.title}>
											{l.productTitle ?? l.title}
										</div>
										<div class="text-xs text-muted-foreground">
											{[l.variantTitle, l.sku].filter(Boolean).join(' · ')}
										</div>
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="num text-right">{l.qty}</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={l.unitPrice} /></Table.Cell>
							<Table.Cell class="text-right">
								{#if l.discount}<Money paisa={-l.discount} muted />{:else}<span
										class="text-muted-foreground">—</span
									>{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if l.variantId}
									<button
										class="text-right hover:underline"
										onclick={() => costSheet?.show(l.variantId!)}
										title="How this cost is built"
									>
										<Money paisa={l.unitCost} />
									</button>
								{:else}<Money paisa={l.unitCost} />{/if}
								<div class="mt-0.5">
									{#if !l.unitCost}
										<StatusBadge tone="danger" label="no cost" />
									{:else if l.frozen && !l.estimated}
										<StatusBadge tone="success" label="at shipping" />
									{:else}
										<StatusBadge
											tone={COST_SOURCE[l.costSource]?.tone ?? 'warning'}
											label={l.estimated ? 'estimated' : COST_SOURCE[l.costSource]?.label}
										/>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell class={['pr-6 text-right font-medium', l.profit < 0 && 'text-danger']}>
								{formatRs(l.profit)}
								<div class="text-xs font-normal text-muted-foreground">
									{pct(l.sales ? l.profit / l.sales : NaN)}
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="py-8 text-center text-muted-foreground"
								>No items.</Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
				{#if lines.length > 1}
					<Table.Footer>
						<Table.Row>
							<Table.Cell class="pl-6 font-medium" colspan={4}>Items total</Table.Cell>
							<Table.Cell class="text-right"><Money paisa={itemsCost} muted /></Table.Cell>
							<Table.Cell class="pr-6 text-right font-medium">
								{formatRs(itemsSales - itemsCost)}
							</Table.Cell>
						</Table.Row>
					</Table.Footer>
				{/if}
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<div class="grid items-start gap-6 md:grid-cols-2">
		<!-- Profit -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Profit</Card.Title>
				<Card.Description>
					{#if p}Counts in {monthLabel(currentMonth(new Date(p.at)))}{:else}Not delivered or
						returned yet — final once the courier reports it.{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-1.5 text-sm">
				{#if p && p.outcome === 'returned'}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Sales</span><span class="text-muted-foreground"
							>none (returned)</span
						>
					</div>
					<div class="flex justify-between">
						<span>Courier fees (out + back)</span><Money paisa={-p.courier} muted />
					</div>
					<div class="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
						<span>Loss</span><span class="text-danger">{formatRs(p.profit)}</span>
					</div>
				{:else}
					{@const shipping = p ? p.shipping : o.shippingCharged}
					{@const sales = p ? p.sales : o.total}
					{@const cogs = p ? p.cogs : itemsCost}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Items after discounts</span><Money
							paisa={sales - shipping}
						/>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">+ Shipping charged</span><Money paisa={shipping} />
					</div>
					<div class="flex justify-between border-t pt-1.5 font-medium">
						<span>Sales</span><Money paisa={sales} />
					</div>
					{#if data.courierOnly && p}
						<p class="text-xs text-muted-foreground">
							Cancelled in Shopify but delivered — sale is the cash the courier collected.
						</p>
					{/if}
					<div class="flex justify-between">
						<span class="flex items-center gap-1.5"
							>− Product cost
							{#if p?.unitsNoCost}<StatusBadge
									tone="danger"
									label="{p.unitsNoCost} no cost"
								/>{:else if p?.cogsEstimated}<StatusBadge tone="warning" label="est." />{/if}</span
						><Money paisa={-cogs} muted />
					</div>
					{#if p}
						<div class="flex justify-between">
							<span class="flex items-center gap-1.5"
								>− Courier fees {#if p.courierEstimated}<StatusBadge
										tone="warning"
										label="est."
									/>{/if}</span
							><Money paisa={-p.courier} muted />
						</div>
						<div class="flex justify-between">
							<span>− Courier tax</span><Money paisa={-p.tax} muted />
						</div>
						<div
							class="mt-1 flex items-baseline justify-between border-t pt-2 text-base font-semibold"
						>
							<span>Profit</span>
							<span class={p.profit < 0 ? 'text-danger' : ''}
								>{formatRs(p.profit)}
								<span class="text-sm font-normal text-muted-foreground">{pct(p.margin)}</span></span
							>
						</div>
					{:else}
						<div class="flex justify-between text-muted-foreground">
							<span>− Courier fees & tax</span><span>after delivery</span>
						</div>
						<div class="mt-1 flex justify-between border-t pt-2 font-medium">
							<span>Before courier costs</span><span>{formatRs(sales - cogs)}</span>
						</div>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>
		{#each data.parcels as s (s.id)}
			{@const est = s.feesEstimated || s.taxesEstimated}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2 text-base">
						{COURIER[s.courier]}
						<span class="font-mono text-sm font-normal text-muted-foreground"
							>{s.courier === 'manual' ? (s.courierStatus ?? '') : s.trackingNo}</span
						>
						<StatusBadge status={s.status} />
						{#if est}<StatusBadge tone="warning" label="fees est." />{/if}
					</Card.Title>
					<Card.Description>
						{#if s.bookedAt}Booked {fmtDate(s.bookedAt)}{/if}
						{#if s.finalAt}{s.bookedAt ? ' · ' : ''}{s.status === 'returned'
								? 'Returned'
								: 'Delivered'}
							{fmtDate(s.finalAt)}{/if}
						{#if s.city}· {s.city}{/if}
						{#if s.weightKg}· {s.weightKg} kg{/if}
						{#if s.courier !== 'manual' && s.courierStatus}· “{s.courierStatus}”{/if}
					</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-1.5 text-sm">
					{#if s.conflictNote}
						<div class="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning">
							<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{s.conflictNote}
						</div>
					{/if}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Cash collected (COD)</span><Money paisa={s.cod} />
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">Delivery fee + tax</span><Money
							paisa={-(s.fee + s.feeTax)}
							muted
						/>
					</div>
					{#if s.returnFee || s.returnFeeTax}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Return fee + tax</span><Money
								paisa={-(s.returnFee + s.returnFeeTax)}
								muted
							/>
						</div>
					{/if}
					{#if s.otherFees}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Other charges</span><Money
								paisa={-s.otherFees}
								muted
							/>
						</div>
					{/if}
					{#if s.itwh || s.stwh}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Tax withheld (ITWH + STWH)</span><Money
								paisa={-(s.itwh + s.stwh)}
								muted
							/>
						</div>
					{/if}
					<div class="flex justify-between border-t pt-1.5 font-medium">
						<span>Net from courier</span><Money paisa={s.net} />
					</div>
					<div class="mt-1 text-xs">
						{#if s.statement}
							<span class="text-success"
								>Paid on {s.statement}{s.statementDate
									? ` · ${fmtDate(s.statementDate)}`
									: ''}</span
							>
						{:else if s.settledAt}
							<span class="text-success">Money received {fmtDate(s.settledAt)}</span>
						{:else if s.status === 'delivered' || s.status === 'returned'}
							<span class="text-warning">Courier owes you — not on a payment statement yet</span>
						{:else}
							<span class="text-muted-foreground">On the way</span>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
	{#if !data.parcels.length && !data.canRecord}
		<p class="text-sm text-muted-foreground">No parcels for this order yet.</p>
	{/if}
</div>

<CostSheet bind:this={costSheet} />
<RecordDelivery bind:this={recorder} />
