<script lang="ts" module>
	type ProductRef = { index: number; title: string; done: boolean };
	/** Products marked done in this browser session (counts update before the save lands). */
	const sessionDone = new Map<string, Set<number>>();
	/** Jump-menu list, fetched once per session. */
	const productsCache = new Map<string, ProductRef[]>();
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, preloadData } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import TableIcon from '@lucide/svelte/icons/table';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Thumb from '#lib/components/app/thumb.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let saving = $state(false);
	let doneVersion = $state(0);
	const base = $derived(`/restock/${data.session.id}`);

	/** Which shipment each qty is for; picking Air/Sea sets it until the save lands. */
	let modes = $derived<Record<string, 'air' | 'sea' | null>>(
		Object.fromEntries(data.variants.map((v) => [v.id, v.restockMode]))
	);
	function setQty(id: string, value: number, mode: 'air' | 'sea') {
		const input = document.getElementById(`qty-${id}`) as HTMLInputElement | null;
		if (!input) return;
		input.value = String(value);
		modes = { ...modes, [id]: mode };
		input.focus();
	}

	function markDoneLocal(i: number) {
		let set = sessionDone.get(data.session.id);
		if (!set) sessionDone.set(data.session.id, (set = new Set()));
		set.add(i);
		doneVersion++;
	}
	const localDone = (i: number) => sessionDone.get(data.session.id)?.has(i) ?? false;

	let formEl = $state<HTMLFormElement>();
	let jumpOpen = $state(false);
	let jumpQuery = $state('');
	let products = $state<ProductRef[]>([]);
	$effect(() => {
		const sid = data.session.id;
		const cached = productsCache.get(sid);
		if (cached) {
			products = cached;
			return;
		}
		fetch(`/restock/${sid}/products`)
			.then((r) => r.json())
			.then((d: { products: ProductRef[] }) => {
				productsCache.set(sid, d.products);
				products = d.products;
			})
			.catch(() => {});
	});
	const productsView = $derived.by(() => {
		void doneVersion;
		return products.map((p) => ({ ...p, done: p.done || localDone(p.index) }));
	});
	const doneCount = $derived(productsView.filter((p) => p.done).length);
	const filtered = $derived.by(() => {
		const q = jumpQuery.trim().toLowerCase();
		return q ? productsView.filter((p) => p.title.toLowerCase().includes(q)) : productsView;
	});

	/**
	 * Save in the background. Moving forward counts the product as reviewed (blank qty → 0).
	 * Navigation doesn't wait, so a failure shows a toast naming the product to revisit.
	 */
	function saveForm(markDone: boolean): Promise<void> {
		if (!formEl) return Promise.resolve();
		const body = new FormData(formEl);
		const title = data.productTitle;
		if (markDone) {
			for (const [k, v] of [...body.entries()])
				if (k.startsWith('qty_') && v === '') body.set(k, '0');
			markDoneLocal(data.index);
		}
		return fetch(`${base}/${data.index}?/save`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		})
			.then(async (res) => {
				const r = res.ok ? await res.json() : null;
				if (r?.type !== 'success') throw new Error();
			})
			.catch(() => {
				toast.error(`Couldn't save "${title}" — go back and enter it again`);
			});
	}
	function navTo(i: number, markDone = false) {
		saveForm(markDone);
		goto(`${base}/${i}`);
	}
	/** Leaving the walk-through waits for the save, so the next page sees this product's qty. */
	async function leaveTo(href: string) {
		saving = true;
		await saveForm(false);
		saving = false;
		goto(href);
	}
	async function finish() {
		saving = true;
		await saveForm(true);
		await fetch(`${base}/${data.index}?/complete`, {
			method: 'POST',
			body: new FormData(),
			headers: { 'x-sveltekit-action': 'true' }
		});
		saving = false;
		goto(`${base}/complete`);
	}
	function jumpTo(i: number) {
		jumpOpen = false;
		jumpQuery = '';
		if (i !== data.index) navTo(i);
	}

	function onkeydown(e: KeyboardEvent) {
		// Tab goes straight to the next quantity (Shift+Tab: previous), skipping pictures and buttons.
		if (
			e.key === 'Tab' &&
			e.target instanceof HTMLInputElement &&
			e.target.name.startsWith('qty_')
		) {
			const inputs = [
				...(formEl?.querySelectorAll<HTMLInputElement>('input[name^="qty_"]') ?? [])
			];
			const next = inputs[inputs.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
			if (next) {
				e.preventDefault();
				next.focus();
				next.select();
			}
			return;
		}
		if (
			e.key === 'Enter' &&
			e.target instanceof HTMLInputElement &&
			e.target.name.startsWith('qty_')
		) {
			e.preventDefault();
			if (data.nextIndex !== null) navTo(data.nextIndex, true);
			else finish();
			return;
		}
		if (e.target instanceof HTMLInputElement) return;
		if (e.key === 'ArrowLeft' && data.prevIndex !== null) navTo(data.prevIndex);
		if (e.key === 'ArrowRight' && data.nextIndex !== null) navTo(data.nextIndex, true);
	}

	const progress = $derived(((data.index + 1) / data.totalProducts) * 100);
	// Focus the first quantity when a product loads.
	$effect(() => {
		void data.index;
		queueMicrotask(() => formEl?.querySelector<HTMLInputElement>('input[type="number"]')?.focus());
	});
	// Prefetch neighbours so Next / Previous are instant.
	$effect(() => {
		if (data.nextIndex !== null) preloadData(`${base}/${data.nextIndex}`);
		if (data.prevIndex !== null) preloadData(`${base}/${data.prevIndex}`);
	});
</script>

{#snippet recButton(id: string, mode: 'air' | 'sea', value: number)}
	{@const picked = modes[id] === mode}
	<button
		type="button"
		tabindex="-1"
		title="Use {value} for {mode === 'air' ? 'an air' : 'a sea'} shipment"
		onclick={() => setQty(id, value, mode)}
		class={[
			'flex min-w-14 flex-col items-center rounded-lg border px-2 py-1.5 transition-colors',
			mode === 'air'
				? 'border-info/30 bg-info-soft text-info hover:bg-info-soft/70'
				: 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
			picked && 'ring-2 ring-ring'
		]}
	>
		<span class="text-[10px] font-medium uppercase opacity-80"
			>{mode === 'air' ? '✈ Air' : '🚢 Sea'}</span
		>
		<span class="num text-sm font-semibold">{value}</span>
	</button>
{/snippet}

<svelte:window
	{onkeydown}
	onclick={() => {
		if (jumpOpen) jumpOpen = false;
	}}
/>

<div class="grid gap-5">
	<div class="grid gap-3">
		<div class="h-1 overflow-hidden rounded-full bg-muted">
			<div class="h-full bg-primary transition-all duration-300" style:width="{progress}%"></div>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<a
				href="/restock"
				class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft class="size-4" /> Sessions
			</a>
			<div class="relative">
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						jumpOpen = !jumpOpen;
					}}
					class="inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-sm font-medium hover:bg-accent"
				>
					<span
						><b>{data.index + 1}</b><span class="text-muted-foreground">
							/ {data.totalProducts}</span
						></span
					>
					<span class="num rounded-full bg-success-soft px-1.5 py-0.5 text-xs text-success"
						>{doneCount} done</span
					>
					<ChevronDown class="size-3.5 text-muted-foreground" />
				</button>
				{#if jumpOpen}
					<div
						role="menu"
						tabindex="-1"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.key === 'Escape' && (jumpOpen = false)}
						class="absolute top-full left-1/2 z-50 mt-2 w-72 -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-lg"
					>
						<div class="border-b p-2">
							<Input bind:value={jumpQuery} placeholder="Jump to product…" class="h-8" />
						</div>
						<div class="max-h-72 overflow-y-auto py-1">
							{#each filtered as p (p.index)}
								<button
									type="button"
									onclick={() => jumpTo(p.index)}
									class={[
										'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent',
										p.index === data.index && 'bg-accent font-medium'
									]}
								>
									{#if p.done}<Check class="size-3.5 shrink-0 text-success" />{:else}<span
											class="size-3.5 shrink-0 rounded-full border"
										></span>{/if}
									<span class="num w-7 shrink-0 text-xs text-muted-foreground">{p.index + 1}</span>
									<span class="truncate">{p.title}</span>
								</button>
							{:else}
								<div class="px-3 py-4 text-center text-sm text-muted-foreground">No match</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={saving}
					onclick={() => leaveTo(`${base}/table`)}
				>
					<TableIcon /> <span class="hidden sm:inline">Table view</span>
				</Button>
				{#if data.session.completedAt}
					<Button size="sm" disabled={saving} onclick={() => leaveTo(`${base}/complete`)}>
						Restock list <ChevronRight />
					</Button>
				{/if}
			</div>
		</div>
	</div>

	{#key data.index}
		<div class="grid gap-5">
			<div class="flex items-center gap-4">
				<Thumb src={data.productImageUrl} alt={data.productTitle} size={56} />
				<div>
					<h1 class="text-xl leading-tight font-semibold">{data.productTitle}</h1>
					<p class="text-xs text-muted-foreground">
						{data.variants.length} variant{data.variants.length > 1 ? 's' : ''} ·
						<b class="text-foreground">{data.variants.reduce((s, v) => s + v.sales90, 0)}</b> sold in
						90 days
					</p>
				</div>
			</div>

			<form
				method="POST"
				action="?/save"
				bind:this={formEl}
				use:enhance={() => {
					saving = true;
					return async ({ result, update }) => {
						await update({ reset: false });
						saving = false;
						if (result.type === 'success') toast.success('Restock quantities saved');
					};
				}}
				class="grid gap-5"
			>
				<div class="divide-y overflow-hidden rounded-xl border bg-card">
					<div
						class="hidden grid-cols-[minmax(0,1.4fr)_auto_auto_auto] items-center gap-4 bg-muted/40 px-4 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase lg:grid"
					>
						<span>Variant</span>
						<span class="grid grid-cols-3 gap-2 text-center"
							><span class="w-14">90d</span><span class="w-14">Incoming</span><span class="w-14"
								>Avail</span
							></span
						>
						<span class="w-36">Restock qty</span>
						<span class="w-[7.5rem] text-center">Suggested</span>
					</div>
					{#each data.variants as v (v.id)}
						{@const out = v.stock !== null && v.stock.available <= 0}
						<div
							class="grid gap-3 p-4 focus-within:bg-accent/40 hover:bg-accent/30 lg:grid-cols-[minmax(0,1.4fr)_auto_auto_auto] lg:items-center lg:gap-4"
						>
							<div class="flex min-w-0 items-center gap-3">
								<Thumb
									src={v.variantImageUrl}
									alt={v.variantTitle ?? data.productTitle}
									size={40}
								/>
								<div class="min-w-0">
									<div class="truncate text-sm font-medium">{v.variantTitle ?? 'Default'}</div>
									{#if v.sku}<div class="truncate font-mono text-xs text-muted-foreground">
											{v.sku}
										</div>{/if}
								</div>
							</div>
							<input type="hidden" name="mode_{v.id}" value={modes[v.id] ?? ''} />
							<div class="grid w-fit grid-cols-3 gap-2 text-center">
								<div
									class="w-14 rounded-lg border px-1 py-1.5"
									title="{v.sales30} in 30 days · {v.sales60} in 60 · {v.sales90} in 90"
								>
									<div class="text-[10px] text-muted-foreground uppercase lg:hidden">90d</div>
									<div class="num text-sm font-semibold">{v.sales90}</div>
								</div>
								<div
									class="w-14 rounded-lg border px-1 py-1.5"
									title="On purchases not arrived yet"
								>
									<div class="text-[10px] text-muted-foreground uppercase lg:hidden">Incoming</div>
									<div
										class={[
											'num text-sm font-semibold',
											!v.stock?.incoming && 'text-muted-foreground'
										]}
									>
										{v.stock?.incoming ?? '—'}
									</div>
								</div>
								<div
									class={[
										'w-14 rounded-lg border px-1 py-1.5',
										out && 'border-danger/30 bg-danger-soft text-danger'
									]}
									title={v.stock
										? `${v.stock.onHand} on hand · ${v.stock.committed} on unshipped orders`
										: undefined}
								>
									<div class="text-[10px] text-muted-foreground uppercase lg:hidden">Avail</div>
									<div class="num text-sm font-semibold">{v.stock?.available ?? '—'}</div>
								</div>
							</div>
							<div
								class="flex w-fit items-center overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-ring/40"
							>
								<button
									type="button"
									tabindex="-1"
									class="border-r px-3 py-2 text-lg leading-none text-muted-foreground select-none hover:bg-accent"
									onclick={(e) => {
										const input = e.currentTarget.nextElementSibling as HTMLInputElement;
										const n = Number.parseInt(input.value || '0', 10);
										if (n > 0) input.value = String(n - 1);
									}}>−</button
								>
								<input
									id="qty-{v.id}"
									type="number"
									name="qty_{v.id}"
									value={v.actualRestock ?? ''}
									min="0"
									placeholder="0"
									class="num w-16 [appearance:textfield] bg-transparent py-2 text-center text-base font-semibold focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
								/>
								<button
									type="button"
									tabindex="-1"
									class="border-l px-3 py-2 text-lg leading-none text-muted-foreground select-none hover:bg-accent"
									onclick={(e) => {
										const input = e.currentTarget.previousElementSibling as HTMLInputElement;
										input.value = String(Number.parseInt(input.value || '0', 10) + 1);
									}}>+</button
								>
							</div>
							<div class="flex gap-2">
								{#if v.calc}
									{@render recButton(v.id, 'air', v.calc.recAir)}
									{@render recButton(v.id, 'sea', v.calc.recSea)}
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<div class="flex items-center justify-between gap-3">
					<Button
						type="button"
						variant="outline"
						disabled={data.prevIndex === null}
						onclick={() => navTo(data.prevIndex!)}><ArrowLeft /> Previous</Button
					>
					<Button type="submit" variant="outline" disabled={saving}>
						{#if saving}<LoaderCircle class="animate-spin" />{/if} Save
					</Button>
					{#if data.nextIndex !== null}
						<Button type="button" onclick={() => navTo(data.nextIndex!, true)}
							>Next <ArrowRight /></Button
						>
					{:else}
						<Button type="button" disabled={saving} onclick={finish}>
							{#if saving}<LoaderCircle class="animate-spin" />{:else}Finish <Check />{/if}
						</Button>
					{/if}
				</div>
				<p class="text-center text-xs text-muted-foreground">
					Enter = next product · ← → move between products · ✈ / 🚢 fill in the suggestion
				</p>
			</form>
		</div>
	{/key}
</div>
