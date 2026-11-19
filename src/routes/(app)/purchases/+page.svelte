<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Popover } from 'bits-ui';
	import Thumb from '#lib/components/app/thumb.svelte';
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
	import { page } from '$app/state';
	import { formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let open = $state(false);
	let currency = $state<'RMB' | 'PKR'>('RMB');

	const STATUS = {
		draft: { tone: 'muted', label: 'draft' },
		paid: { tone: 'info', label: 'purchased · incoming' },
		landing: { tone: 'warning', label: 'adding to stock…' },
		landed: { tone: 'success', label: 'arrived' }
	} as const;
	const fmtDate = (d: string | null) =>
		d
			? new Date(`${d}T12:00:00+05:00`).toLocaleDateString('en-GB', {
					day: '2-digit',
					month: 'short',
					year: 'numeric'
				})
			: '—';

	/** Stage tabs; All is the default. */
	const TABS = [
		{ id: 'all', label: 'All', has: () => true },
		{ id: 'draft', label: 'Draft', has: (st: string) => st === 'draft' },
		{ id: 'incoming', label: 'Incoming', has: (st: string) => st === 'paid' || st === 'landing' },
		{ id: 'arrived', label: 'Arrived', has: (st: string) => st === 'landed' }
	] as const;
	const tab = $derived(TABS.find((t) => t.id === page.url.searchParams.get('tab')) ?? TABS[0]);
	const shown = $derived(data.batches.filter((b) => tab.has(b.status)));
	const count = (t: (typeof TABS)[number]) => data.batches.filter((b) => t.has(b.status)).length;
	const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
	const addDays = (d: string, n: number) => {
		const t = new Date(`${d}T12:00:00Z`);
		t.setUTCDate(t.getUTCDate() + n);
		return t.toISOString().slice(0, 10);
	};
	/**
	 * One thumbnail per variant (its own picture). Variants that
	 * share the very same picture show it once.
	 */
	function thumbs(lines: (typeof data.batches)[number]['lines']) {
		const seen = new Set<string>();
		const uniq = lines.filter((l) => {
			const key = l.image ?? `none:${l.id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		return uniq;
	}
	/** Days until the expected arrival (negative = late); null when arrived or no date set. */
	function daysToArrival(b: (typeof data.batches)[number]) {
		if (b.status === 'landed' || !b.paidOn || b.expectedDays === null) return null;
		const due = addDays(b.paidOn, b.expectedDays);
		return Math.round(
			(Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000
		);
	}
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Purchases</h1>
			<p class="text-sm text-muted-foreground">
				Stock bought from suppliers — China or local. Marking a purchase arrived adds the stock in
				Shopify and updates average cost.
			</p>
		</div>
		<Button onclick={() => (open = true)}><Plus /> New purchase</Button>
	</div>

	<Card.Root>
		<Card.Header class="pb-0" data-sveltekit-noscroll>
			<div class="flex flex-wrap gap-1">
				{#each TABS as t (t.id)}
					<Button
						href={t.id === 'all' ? '?' : `?tab=${t.id}`}
						size="sm"
						variant={tab.id === t.id ? 'secondary' : 'ghost'}
						data-sveltekit-replacestate>{t.label} ({count(t)})</Button
					>
				{/each}
			</div>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Purchase</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Items</Table.Head>
						<Table.Head class="text-right">Units</Table.Head>
						<Table.Head class="text-right">Weight</Table.Head>
						<Table.Head class="pl-8">Expected</Table.Head>
						<Table.Head class="pr-6 pl-8">Products</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each shown as b (b.id)}
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
								{#if b.ddpPending && b.status !== 'landed'}<StatusBadge
										tone="warning"
										label="Transport pending"
									/>{/if}
								<div class="text-xs text-muted-foreground">
									{b.status === 'landed'
										? fmtDate(b.landedOn)
										: b.status === 'paid'
											? b.paidOn && b.expectedDays !== null
												? `expected ${fmtDate(addDays(b.paidOn, b.expectedDays))}`
												: fmtDate(b.paidOn)
											: ''}
								</div>
							</Table.Cell>
							<Table.Cell class="text-right">
								<Popover.Root>
									<Popover.Trigger
										class="num inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent data-[state=open]:bg-accent"
										title="Show items"
									>
										{b.items}<ChevronDown class="size-3.5" />
									</Popover.Trigger>
									<Popover.Portal>
										<Popover.Content
											align="end"
											sideOffset={6}
											class="z-50 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
										>
											{#if b.lines.length}
												<!-- About 6 rows tall, then scrolls. -->
												<div class="max-h-[22rem] overflow-y-auto">
													{#each b.lines as l (l.id)}
														<div
															class="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent/60"
														>
															<Thumb
																src={l.image}
																alt={`${l.title}${l.variant ? ` · ${l.variant}` : ''}`}
																caption="Qty {l.qty}"
																size={36}
															/>
															<div class="min-w-0 flex-1">
																<div class="truncate" title={l.title}>{l.title}</div>
																{#if l.variant}<div class="truncate text-xs text-muted-foreground">
																		{l.variant}
																	</div>{/if}
																<div class="num text-xs text-muted-foreground">
																	{l.qty} × {b.currency === 'PKR' ? 'Rs ' : '¥'}{(
																		l.price / 100
																	).toLocaleString('en-PK', { maximumFractionDigits: 2 })}
																	· landed {formatRs(l.landed)}
																</div>
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="px-2 py-3 text-sm text-muted-foreground">No items yet.</p>
											{/if}
										</Popover.Content>
									</Popover.Portal>
								</Popover.Root>
							</Table.Cell>
							<Table.Cell class="num text-right">{b.totals.units}</Table.Cell>
							<Table.Cell class="num text-right"
								>{(b.totals.weightG / 1000).toFixed(1)} kg</Table.Cell
							>
							<Table.Cell class="pl-8 whitespace-nowrap">
								{@const due = daysToArrival(b)}
								{#if due === null}<span class="text-muted-foreground">—</span>
								{:else if due > 0}in {due} {due === 1 ? 'day' : 'days'}
								{:else if due === 0}<span class="font-medium">today</span>
								{:else}<span class="font-medium text-warning"
										>{-due} {due === -1 ? 'day' : 'days'} late</span
									>{/if}
							</Table.Cell>
							<Table.Cell class="pr-6 pl-8">
								{@const pics = thumbs(b.lines)}
								<!-- One picture per variant, left to right; the viewer pages through this purchase only. -->
								<div
									class="flex max-w-[24rem] [scrollbar-width:none] items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
									data-gallery
								>
									{#each pics as l (l.id)}
										<Thumb
											src={l.image}
											alt={`${l.title}${l.variant ? ` · ${l.variant}` : ''}`}
											caption="Qty {l.qty}"
											size={32}
										/>
									{/each}
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={7} class="py-10 text-center text-muted-foreground">
								{data.batches.length
									? `No ${tab.label.toLowerCase()} purchases.`
									: 'No purchases yet. Stock you already have is costed on the Inventory page.'}
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
							<input
								type="radio"
								name="currency"
								value={val}
								bind:group={currency}
								class="sr-only"
							/>{label}
						</label>
					{/each}
				</div>
			</div>
			{#if currency === 'RMB'}
				<div class="grid gap-2">
					<Label for="fx">Rs paid per 1 yuan</Label>
					<Input
						id="fx"
						name="fx"
						inputmode="decimal"
						value={data.rates.rmbFx ? data.rates.rmbFx / 10_000 : ''}
						required
					/>
				</div>
			{/if}
			{#if currency === 'RMB'}
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-2">
						<Label for="orderedOn">Ordered on</Label>
						<Input id="orderedOn" name="orderedOn" type="date" value={today} />
					</div>
					<div class="grid gap-2">
						<Label for="expectedDays">Expected in (days)</Label>
						<Input
							id="expectedDays"
							name="expectedDays"
							inputmode="numeric"
							value={String(data.lead.airDays)}
						/>
					</div>
				</div>
			{:else}
				<input type="hidden" name="orderedOn" value={today} />
			{/if}
			<div class="grid gap-2">
				<Label for="ddp">Transport Rs per kg</Label>
				<Input
					id="ddp"
					name="ddp"
					inputmode="decimal"
					value={currency === 'RMB' && data.rates.ddpPerKg ? data.rates.ddpPerKg / 100 : '0'}
				/>
				{#if currency === 'PKR'}<p class="text-xs text-muted-foreground">
						Usually 0 for local suppliers.
					</p>{/if}
			</div>
			<Button type="submit">Create</Button>
		</form>
	</Sheet.Content>
</Sheet.Root>
