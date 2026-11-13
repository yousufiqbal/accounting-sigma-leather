<script lang="ts">
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Stat from '#lib/components/app/stat.svelte';
	import VariantPicker from '#lib/components/app/variant-picker.svelte';
	import { formatRs } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let open = $state<string | null>(null);
	let busy = $state<string | null>(null);
	/** Typed costs per group (Rs), so "copy from product" can fill them. */
	let groupCost = $state<Record<string, string>>({});
	const costOf = (id: string) => data.options.find((o) => o.id === id)?.cost ?? null;
	const pickerOptions = $derived(
		data.options.map((o) => ({
			id: o.id,
			title: o.title,
			variant: `${o.variant ?? ''}${o.variant ? ' · ' : ''}${formatRs(o.cost)}`,
			sku: o.sku,
			image: o.image
		}))
	);
	/** Picking a product copies its cost into the group's box. */
	function copyCost(key: string, variantId: string) {
		const c = costOf(variantId);
		if (c !== null) groupCost[key] = String(c / 100);
	}

	const fmtDate = (iso: string) =>
		new Date(iso).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Asia/Karachi'
		});
	const rs = (paisa: number | null) => (paisa ? String(paisa / 100) : '');

	const submit = (key: string) => () => {
		busy = key;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = null;
		};
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
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Items without cost</h1>
				<p class="text-sm text-muted-foreground">
					Order lines not linked to a Shopify product — custom items typed into an order, or
					products deleted since. Set their cost here so order profit is right.
				</p>
			</div>
			<div class="flex gap-1">
				<Button href="?" size="sm" variant={data.all ? 'ghost' : 'secondary'}>Missing cost</Button>
				<Button href="?view=all" size="sm" variant={data.all ? 'secondary' : 'ghost'}
					>All custom items</Button
				>
			</div>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-3">
		<Stat label="Lines without cost">{data.totals.lines}</Stat>
		<Stat label="Units">{data.totals.units}</Stat>
		<Stat label="Their sales" hint="Counted as 100% profit until a cost is set">
			{formatRs(data.totals.sales)}
		</Stat>
	</div>

	<Card.Root>
		<Card.Content class="grid gap-0 px-0">
			{#each data.groups as g (g.key)}
				{@const ids = g.lines.map((l) => l.id).join(',')}
				{@const isOpen = open === g.key}
				<div class="border-b last:border-b-0">
					<div class="flex flex-wrap items-center gap-3 px-6 py-3">
						<button
							class="flex min-w-0 flex-1 items-center gap-2 text-left"
							onclick={() => (open = isOpen ? null : g.key)}
						>
							{#if isOpen}<ChevronDown class="size-4 shrink-0" />{:else}<ChevronRight
									class="size-4 shrink-0"
								/>{/if}
							<span class="min-w-0">
								<span class="block truncate font-medium" title={g.title}>{g.title}</span>
								<span class="text-xs text-muted-foreground">
									{g.sku ? `${g.sku} · ` : ''}{g.lines.length} order{g.lines.length === 1
										? ''
										: 's'}
									· {g.units} units · {formatRs(g.sales)} sales
								</span>
							</span>
						</button>
						<form
							method="POST"
							action="?/setCost"
							class="flex items-center gap-2"
							use:enhance={submit(g.key)}
						>
							<input type="hidden" name="lineIds" value={ids} />
							<Input
								name="cost"
								inputmode="decimal"
								placeholder="Cost per unit, Rs"
								class="h-8 w-40"
								bind:value={() => groupCost[g.key] ?? '', (v) => (groupCost[g.key] = v)}
							/>
							<Button type="submit" size="sm" disabled={busy === g.key || !groupCost[g.key]}>
								{busy === g.key
									? 'Saving…'
									: g.lines.length > 1
										? `Set for all ${g.lines.length}`
										: 'Set'}
							</Button>
						</form>
					</div>

					{#if isOpen}
						<div class="grid gap-3 bg-muted/30 px-6 py-3">
							<div class="grid max-w-xl gap-1">
								<span class="text-xs text-muted-foreground"
									>Same as a product? Pick it to copy its cost into the box above.</span
								>
								<VariantPicker
									options={pickerOptions}
									bind:value={() => '', (v) => v && copyCost(g.key, v)}
									id="copy-{g.key}"
									name="copy"
								/>
							</div>
							<div class="grid gap-1.5">
								{#each g.lines as l (l.id)}
									<form
										method="POST"
										action="?/setCost"
										class="flex flex-wrap items-center gap-3 text-sm"
										use:enhance={submit(l.id)}
									>
										<input type="hidden" name="lineIds" value={l.id} />
										<a href="/orders/{l.orderName}" class="w-16 font-medium hover:underline"
											>#{l.orderName}</a
										>
										<span class="w-28 text-muted-foreground">{fmtDate(l.createdAt)}</span>
										<span class="w-40">{l.qty} × {formatRs(l.price)}</span>
										<span class="w-24 text-xs text-muted-foreground"
											>{l.delivered ? 'delivered' : 'not delivered yet'}</span
										>
										<Input
											name="cost"
											inputmode="decimal"
											value={rs(l.cost)}
											placeholder="Cost / unit"
											class="h-8 w-32"
										/>
										<Button type="submit" size="xs" variant="outline" disabled={busy === l.id}
											>{busy === l.id ? '…' : 'Save'}</Button
										>
									</form>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<p class="py-10 text-center text-muted-foreground">
					{data.all ? 'No custom items.' : 'Every custom item has a cost.'}
				</p>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
