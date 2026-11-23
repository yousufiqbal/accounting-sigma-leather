<script lang="ts">
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Download from '@lucide/svelte/icons/download';
	import Check from '@lucide/svelte/icons/check';
	import TableIcon from '@lucide/svelte/icons/table';
	import { Button } from '#lib/components/ui/button/index.js';
	import Thumb from '#lib/components/app/thumb.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/restock/${data.session.id}`);

	let ordered = $derived<Record<string, boolean>>(
		Object.fromEntries(data.list.map((i) => [i.id, !!i.orderedAt]))
	);
	const orderedCount = $derived(Object.values(ordered).filter(Boolean).length);

	type Filter = 'all' | 'todo' | 'ordered';
	let filter = $state<Filter>('all');
	const visible = $derived(
		filter === 'todo'
			? data.list.filter((i) => !ordered[i.id])
			: filter === 'ordered'
				? data.list.filter((i) => ordered[i.id])
				: data.list
	);

	/** The input owns its value; this keeps the latest numbers for totals and CSV. */
	let qty = $derived<Record<string, number>>(
		Object.fromEntries(data.list.map((i) => [i.id, i.actualRestock ?? 0]))
	);
	async function commitQty(id: string, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const n = Number.parseInt(input.value, 10);
		const next = Number.isFinite(n) && n >= 0 ? n : 0;
		input.value = String(next);
		if (next === qty[id]) return;
		qty = { ...qty, [id]: next };
		const fd = new FormData();
		fd.set('id', id);
		fd.set('qty', String(next));
		await fetch('?/updateQty', {
			method: 'POST',
			body: fd,
			headers: { 'x-sveltekit-action': 'true' }
		});
	}

	/** One section per shipment, so air and sea are ordered separately. */
	const sections = $derived(
		[
			{ key: 'air', label: '✈ Air', tone: 'text-info' },
			{ key: 'sea', label: '🚢 Sea', tone: 'text-primary' },
			{ key: null, label: 'No shipment picked', tone: 'text-muted-foreground' }
		]
			.map((s) => ({
				...s,
				items: visible.filter((i) => (i.restockMode ?? null) === s.key)
			}))
			.filter((s) => s.items.length > 0)
	);

	function exportCSV() {
		const head = ['Product', 'Variant', 'SKU', 'Shipment', 'Restock qty', 'Available', 'Incoming'];
		const rows = data.list.map((i) => {
			const s = data.stock[i.variantId];
			return [
				i.productTitle,
				i.variantTitle ?? '',
				i.sku ?? '',
				i.restockMode ?? '',
				qty[i.id] ?? 0,
				s?.available ?? '',
				s?.incoming ?? ''
			];
		});
		const csv = [head, ...rows]
			.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `restock-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="grid max-w-3xl gap-5">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
		<div>
			<a
				href="/restock"
				class="mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft class="size-4" /> Sessions
			</a>
			<h1 class="text-2xl font-semibold tracking-tight">Restock list</h1>
			<p class="text-sm text-muted-foreground">
				<b class="text-foreground">{data.list.length}</b> items · {orderedCount} ordered
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" href="{base}/table"><TableIcon /> Edit in table</Button>
			<Button variant="outline" onclick={exportCSV} disabled={!data.list.length}
				><Download /> Export CSV</Button
			>
		</div>
	</div>

	{#if !data.list.length}
		<div class="rounded-xl border border-dashed p-12 text-center">
			<p class="text-sm font-medium">Nothing to restock</p>
			<p class="mt-1 text-xs text-muted-foreground">No variant has a restock quantity above 0.</p>
		</div>
	{:else}
		<div class="inline-flex w-fit items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
			{#each [{ key: 'all', label: 'All', n: data.list.length }, { key: 'todo', label: 'Pending', n: data.list.length - orderedCount }, { key: 'ordered', label: 'Ordered', n: orderedCount }] as f (f.key)}
				<button
					type="button"
					onclick={() => (filter = f.key as Filter)}
					class={[
						'rounded-md px-2.5 py-1.5 font-medium',
						filter === f.key ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
					]}>{f.label} <span class="num opacity-70">{f.n}</span></button
				>
			{/each}
		</div>

		{#each sections as s (s.key)}
			<section class="grid gap-2">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class={['text-xs font-semibold tracking-wide uppercase', s.tone]}>
						{s.label}
						<span class="font-medium tracking-normal text-muted-foreground normal-case">
							· {s.items.length} items · {s.items.reduce((n, i) => n + (qty[i.id] ?? 0), 0)} units
						</span>
					</h2>
				</div>
				<div class="divide-y overflow-hidden rounded-xl border bg-card">
					{#each s.items as item (item.id)}
						{@const done = ordered[item.id] ?? false}
						{@const live = data.stock[item.variantId]}
						<div class={['flex items-center gap-3 px-4 py-3', done && 'bg-success-soft/40']}>
							<Thumb src={item.variantImageUrl ?? item.productImageUrl} alt="" size={44} />
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-medium">{item.productTitle}</div>
								<div class="truncate text-xs text-muted-foreground">
									{item.variantTitle ?? ''}
								</div>
							</div>
							<div class="num w-14 shrink-0 text-right text-xs leading-tight">
								<div class="text-muted-foreground">Incoming</div>
								<b class={!live?.incoming ? 'text-muted-foreground' : ''}>{live?.incoming ?? '—'}</b
								>
							</div>
							<div class="num w-12 shrink-0 text-right text-xs leading-tight">
								<div class="text-muted-foreground">Avail</div>
								<b class={live && live.available <= 0 ? 'text-danger' : ''}
									>{live?.available ?? '—'}</b
								>
							</div>
							<input
								type="number"
								min="0"
								inputmode="numeric"
								value={qty[item.id]}
								onchange={(e) => commitQty(item.id, e)}
								data-qty
								onkeydown={(e) => {
									const input = e.currentTarget as HTMLInputElement;
									if (e.key === 'Enter') {
										e.preventDefault();
										input.blur();
									} else if (e.key === 'Tab') {
										const all = [
											...document.querySelectorAll<HTMLInputElement>('input[data-qty]:not(:disabled)')
										];
										const next = all[all.indexOf(input) + (e.shiftKey ? -1 : 1)];
										if (!next) return;
										e.preventDefault();
										next.focus();
										next.select();
									}
								}}
								title="Restock quantity"
								class={[
									'num h-8 w-14 shrink-0 [appearance:textfield] rounded-lg border-0 text-center text-xs font-bold text-background focus:ring-2 focus:ring-ring focus:outline-none disabled:opacity-70 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
									done ? 'bg-success' : 'bg-foreground'
								]}
							/>
							<form
								method="POST"
								action="?/toggleOrdered"
								use:enhance={() => {
									ordered = { ...ordered, [item.id]: !done };
									return async () => {};
								}}
							>
								<input type="hidden" name="id" value={item.id} />
								<Button
									type="submit"
									variant="outline"
									size="icon-sm"
									title={done ? 'Mark as not ordered' : 'Mark as ordered'}
									aria-label={done ? 'Mark as not ordered' : 'Mark as ordered'}
									class={done ? 'border-success/40 bg-success-soft text-success' : ''}
									><Check /></Button
								>
							</form>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>
