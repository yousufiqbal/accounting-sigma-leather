<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Layers from '@lucide/svelte/icons/layers';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Thumb from '#lib/components/app/thumb.svelte';
	import { calcRestock } from '#lib/restock-calc.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/restock/${data.session.id}`);
	type Mode = 'air' | 'sea' | null;

	// Local copies of what's editable — rows save one at a time.
	let qty = $derived<Record<string, number | null>>(
		Object.fromEntries(data.items.map((i) => [i.id, i.actualRestock]))
	);
	let modes = $derived<Record<string, Mode>>(
		Object.fromEntries(data.items.map((i) => [i.id, i.restockMode]))
	);
	let saving = $state<Record<string, boolean>>({});
	const anySaving = $derived(Object.values(saving).some(Boolean));

	const rows = $derived(
		data.items.map((i) => {
			const s = data.stock[i.variantId] ?? null;
			const calc = s
				? calcRestock({ s30: i.sales30, s60: i.sales60, s90: i.sales90 }, s, data.lead)
				: null;
			return { ...i, stock: s, calc };
		})
	);
	type Row = (typeof rows)[number];

	type Filter = 'all' | 'needs' | 'entered';
	let filter = $state<Filter>('all');
	let sortBy = $state<'urgency' | 'session'>('urgency');
	let query = $state('');

	/** Variants grouped under their product; urgency sort uses the product's most urgent variant. */
	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const by = new Map<
			number,
			{ position: number; title: string; imageUrl: string | null; rows: Row[]; cover: number }
		>();
		for (const r of rows) {
			if (filter === 'needs' && !(r.calc && (r.calc.recAir > 0 || r.calc.recSea > 0))) continue;
			if (filter === 'entered' && !qty[r.id]) continue;
			if (
				q &&
				![r.productTitle, r.variantTitle ?? '', r.sku ?? ''].some((t) =>
					t.toLowerCase().includes(q)
				)
			)
				continue;
			let g = by.get(r.position);
			if (!g)
				by.set(
					r.position,
					(g = {
						position: r.position,
						title: r.productTitle,
						imageUrl: r.productImageUrl,
						rows: [],
						cover: Infinity
					})
				);
			g.rows.push(r);
			g.cover = Math.min(g.cover, r.calc?.coverDays ?? Infinity);
		}
		const list = [...by.values()];
		if (sortBy === 'urgency') list.sort((a, b) => a.cover - b.cover || a.position - b.position);
		return list;
	});
	const counts = $derived({
		all: rows.length,
		needs: rows.filter((r) => r.calc && (r.calc.recAir > 0 || r.calc.recSea > 0)).length,
		entered: rows.filter((r) => qty[r.id]).length
	});
	const progress = $derived.by(() => {
		const done = new Set<number>();
		const all = new Set<number>();
		for (const r of rows) {
			all.add(r.position);
			if (qty[r.id] != null) done.add(r.position);
		}
		const resume = [...all].sort((a, b) => a - b).find((p) => !done.has(p)) ?? 0;
		return { done: done.size, total: all.size, resume };
	});
	const totals = $derived.by(() => {
		let air = 0,
			sea = 0,
			other = 0;
		for (const r of rows) {
			const n = qty[r.id] ?? 0;
			if (modes[r.id] === 'air') air += n;
			else if (modes[r.id] === 'sea') sea += n;
			else other += n;
		}
		return { air, sea, other };
	});

	async function saveRow(id: string, next: number | null, mode: Mode) {
		qty = { ...qty, [id]: next };
		modes = { ...modes, [id]: next ? mode : null };
		saving[id] = true;
		const fd = new FormData();
		fd.set('id', id);
		fd.set('qty', next == null ? '' : String(next));
		fd.set('mode', modes[id] ?? '');
		try {
			const res = await fetch('?/saveRow', {
				method: 'POST',
				body: fd,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const r = res.ok ? await res.json() : null;
			if (r?.type !== 'success') throw new Error();
		} catch {
			toast.error(
				`Couldn't save ${rows.find((r) => r.id === id)?.productTitle ?? 'row'} — try again`
			);
		} finally {
			saving[id] = false;
		}
	}
	function onQtyChange(id: string, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const n = Number.parseInt(input.value, 10);
		const next = input.value === '' ? null : Number.isFinite(n) && n >= 0 ? n : 0;
		input.value = next == null ? '' : String(next);
		if (next !== qty[id]) saveRow(id, next, modes[id]);
	}
	/** Enter and Tab move down the column (Shift+Tab up), like a spreadsheet. */
	function onQtyKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== 'Tab') return;
		const input = e.currentTarget as HTMLInputElement;
		const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-qty]')];
		const next = inputs[inputs.indexOf(input) + (e.key === 'Tab' && e.shiftKey ? -1 : 1)];
		// Past the last (or first) input, Tab leaves the column as usual.
		if (e.key === 'Tab' && !next) return;
		e.preventDefault();
		input.blur();
		next?.focus();
		next?.select();
	}
	let finishing = $state(false);
</script>

{#snippet variantRow(r: Row, nested: boolean)}
	<tr class="border-b last:border-b-0 focus-within:bg-accent/40 hover:bg-accent/30">
		<td class="px-3 py-2">
			{#if nested}
				<div class="ml-4 flex min-w-0 items-center gap-2 border-l-2 pl-5">
					{#if r.variantImageUrl && r.variantImageUrl !== r.productImageUrl}
						<Thumb src={r.variantImageUrl} alt="" size={28} />
					{/if}
					<div class="min-w-0">
						<div class="truncate font-medium">{r.variantTitle}</div>
						{#if r.sku}<div class="truncate font-mono text-xs text-muted-foreground">
								{r.sku}
							</div>{/if}
					</div>
				</div>
			{:else}
				<div class="flex min-w-0 items-center gap-2.5">
					<Thumb src={r.variantImageUrl ?? r.productImageUrl} alt="" size={36} />
					<div class="min-w-0">
						<div class="truncate font-medium">{r.productTitle}</div>
						{#if r.sku}<div class="truncate font-mono text-xs text-muted-foreground">
								{r.sku}
							</div>{/if}
					</div>
				</div>
			{/if}
		</td>
		<td class="num px-2 py-2 text-center">{r.sales30}</td>
		<td class="num px-2 py-2 text-center text-muted-foreground">{r.sales90}</td>
		<td
			class={[
				'num px-2 py-2 text-center',
				r.stock?.incoming ? 'font-semibold' : 'text-muted-foreground'
			]}>{r.stock?.incoming ?? '—'}</td
		>
		<td
			class={[
				'num px-2 py-2 text-center font-semibold',
				r.stock && r.stock.available <= 0 && 'text-danger'
			]}
			title={r.stock
				? `${r.stock.onHand} on hand · ${r.stock.committed} on unshipped orders`
				: undefined}>{r.stock?.available ?? '—'}</td
		>
		<td class="px-3 py-2">
			<input
				data-qty
				type="number"
				min="0"
				inputmode="numeric"
				placeholder="—"
				value={qty[r.id] ?? ''}
				onchange={(e) => onQtyChange(r.id, e)}
				onkeydown={onQtyKeydown}
				class="num h-8 w-16 [appearance:textfield] rounded-md border bg-card text-center font-semibold focus:ring-2 focus:ring-ring/40 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
		</td>
		<td class="px-1 py-2 text-center">
			{#if r.calc}
				<button
					type="button"
					tabindex="-1"
					onclick={() => saveRow(r.id, r.calc!.recAir, 'air')}
					title="Use {r.calc.recAir} for an air shipment"
					class={[
						'num w-11 rounded-md bg-info-soft py-1 font-semibold text-info',
						modes[r.id] === 'air' && 'ring-2 ring-ring'
					]}>{r.calc.recAir}</button
				>
			{/if}
		</td>
		<td class="px-1 py-2 text-center">
			{#if r.calc}
				<button
					type="button"
					tabindex="-1"
					onclick={() => saveRow(r.id, r.calc!.recSea, 'sea')}
					title="Use {r.calc.recSea} for a sea shipment"
					class={[
						'num w-11 rounded-md bg-primary/10 py-1 font-semibold text-primary',
						modes[r.id] === 'sea' && 'ring-2 ring-ring'
					]}>{r.calc.recSea}</button
				>
			{/if}
		</td>
	</tr>
{/snippet}

<div class="grid gap-4">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
		<div>
			<a
				href="/restock"
				class="mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft class="size-4" /> Sessions
			</a>
			<h1 class="text-2xl font-semibold tracking-tight">Restock — table</h1>
			<p class="num text-sm text-muted-foreground">
				<b class="text-foreground">{progress.done}</b>/{progress.total} products done · ✈ {totals.air}
				· 🚢 {totals.sea}{#if totals.other}
					· {totals.other} no shipment picked{/if}
			</p>
		</div>
		<div class="flex shrink-0 gap-2">
			<Button variant="outline" href="{base}/{progress.resume}"><Layers /> One by one</Button>
			<form
				method="POST"
				action="?/complete"
				use:enhance={() => {
					finishing = true;
					return async ({ update }) => {
						await update();
						finishing = false;
					};
				}}
			>
				<Button type="submit" disabled={anySaving || finishing}>
					{#if finishing}<LoaderCircle class="animate-spin" />{:else}<Check />{/if}
					{data.session.completedAt ? 'Restock list' : 'Finish'}
				</Button>
			</form>
		</div>
	</div>

	<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
		<div class="inline-flex w-fit items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
			{#each [{ key: 'all', label: 'All' }, { key: 'needs', label: 'Needs restock' }, { key: 'entered', label: 'Entered' }] as f (f.key)}
				<button
					type="button"
					onclick={() => (filter = f.key as Filter)}
					class={[
						'rounded-md px-2.5 py-1.5 font-medium',
						filter === f.key ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
					]}
				>
					{f.label} <span class="num opacity-70">{counts[f.key as Filter]}</span>
				</button>
			{/each}
		</div>
		<select bind:value={sortBy} class="h-8 w-fit rounded-lg border bg-card px-2 text-xs">
			<option value="urgency">Most urgent first</option>
			<option value="session">Session order</option>
		</select>
		<Input
			bind:value={query}
			type="search"
			placeholder="Search product, variant, SKU…"
			class="h-8 sm:ml-auto sm:max-w-64"
		/>
	</div>

	<div class="overflow-x-auto rounded-xl border bg-card xl:overflow-visible">
		<table class="w-full min-w-[760px] table-fixed text-sm" data-sticky>
			<thead>
				<tr class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
					<th class="px-3 py-2.5 text-left">Item</th>
					<th class="w-14 px-2 py-2.5" title="Sold in the last 30 days">30d</th>
					<th class="w-14 px-2 py-2.5" title="Sold in the last 90 days">90d</th>
					<th class="w-20 px-2 py-2.5" title="On purchases not arrived yet">Incoming</th>
					<th class="w-16 px-2 py-2.5" title="On hand minus unshipped orders">Avail</th>
					<th class="w-24 px-3 py-2.5">Qty</th>
					<th class="w-14 px-2 py-2.5">✈ Air</th>
					<th class="w-14 px-2 py-2.5">🚢 Sea</th>
				</tr>
			</thead>
			{#each groups as g (g.position)}
				<tbody class="border-t-4 border-muted first-of-type:border-t-0">
					{#if g.rows[0].variantTitle !== null}
						<tr class="bg-muted/40">
							<td colspan="8" class="px-3 py-2">
								<div class="flex min-w-0 items-center gap-2.5">
									<Thumb src={g.imageUrl} alt="" size={36} />
									<div class="min-w-0">
										<div class="truncate font-semibold">{g.title}</div>
										<div class="num text-xs text-muted-foreground">
											{g.rows.length} variant{g.rows.length > 1 ? 's' : ''} · {g.rows.reduce(
												(s, r) => s + r.sales90,
												0
											)} sold in 90 days
										</div>
									</div>
								</div>
							</td>
						</tr>
						{#each g.rows as r (r.id)}{@render variantRow(r, true)}{/each}
					{:else}
						{@render variantRow(g.rows[0], false)}
					{/if}
				</tbody>
			{:else}
				<tbody
					><tr
						><td colspan="8" class="p-8 text-center text-sm text-muted-foreground"
							>No matching items.</td
						></tr
					></tbody
				>
			{/each}
		</table>
	</div>
</div>
