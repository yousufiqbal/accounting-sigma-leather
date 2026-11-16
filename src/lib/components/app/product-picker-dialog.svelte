<script lang="ts">
	/**
	 * Pick many products at once: search, tick whole products (all their variants) or single
	 * variants. Variants already on the purchase show as "added" and can't be picked again.
	 */
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Thumb from '#lib/components/app/thumb.svelte';

	type Option = {
		id: string;
		productId: string;
		title: string;
		variant: string | null;
		sku: string | null;
		image: string | null;
	};
	let {
		open = $bindable(false),
		options,
		existing,
		busy = false,
		onadd
	}: {
		open?: boolean;
		options: Option[];
		existing: Set<string>;
		busy?: boolean;
		onadd: (ids: string[]) => void;
	} = $props();

	let q = $state('');
	let picked = $state<Set<string>>(new Set());

	/** Products in catalogue order, each with its variants. */
	const products = $derived.by(() => {
		const map = new Map<string, Option[]>();
		for (const o of options) {
			const list = map.get(o.productId);
			if (list) list.push(o);
			else map.set(o.productId, [o]);
		}
		return [...map.values()];
	});

	const shown = $derived.by(() => {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return products;
		const hit = (o: Option) => {
			const text = `${o.title} ${o.variant ?? ''} ${o.sku ?? ''}`.toLowerCase();
			return words.every((w) => text.includes(w));
		};
		return products
			.map((vs) => {
				// Product name matches → all its variants; otherwise only the matching variants.
				const title = vs[0].title.toLowerCase();
				return words.every((w) => title.includes(w)) ? vs : vs.filter(hit);
			})
			.filter((vs) => vs.length);
	});

	const free = (vs: Option[]) => vs.filter((o) => !existing.has(o.id));
	function toggle(id: string) {
		const next = new Set(picked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		picked = next;
	}
	function toggleProduct(vs: Option[]) {
		const ids = free(vs).map((o) => o.id);
		const all = ids.length > 0 && ids.every((id) => picked.has(id));
		const next = new Set(picked);
		for (const id of ids) {
			if (all) next.delete(id);
			else next.add(id);
		}
		picked = next;
	}
	const productState = (vs: Option[]) => {
		const ids = free(vs).map((o) => o.id);
		const n = ids.filter((id) => picked.has(id)).length;
		return {
			all: ids.length > 0 && n === ids.length,
			some: n > 0 && n < ids.length,
			none: !ids.length
		};
	};

	// Fresh start each time it opens.
	$effect(() => {
		if (open) {
			q = '';
			picked = new Set();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Add products</Dialog.Title>
			<Dialog.Description>
				Tick a product to add all its variants, or tick single variants. Enter quantities and prices
				in the items table after adding.
			</Dialog.Description>
		</Dialog.Header>
		<Input bind:value={q} placeholder="Search product name or SKU…" autofocus />

		<div class="min-h-0 flex-1 overflow-auto rounded-lg border">
			{#each shown as vs (vs[0].productId)}
				{@const st = productState(vs)}
				{@const multi = vs.length > 1 || !!vs[0].variant}
				<div class="border-b last:border-b-0">
					<label
						class={[
							'flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent',
							st.none && 'cursor-default opacity-60'
						]}
					>
						<input
							type="checkbox"
							class="size-4 accent-primary"
							checked={st.all || (st.none && true)}
							indeterminate={st.some}
							disabled={st.none}
							onchange={() => toggleProduct(vs)}
						/>
						<Thumb src={vs[0].image} alt={vs[0].title} size={32} />
						<span class="min-w-0 flex-1">
							<span class="line-clamp-1 font-medium">{vs[0].title}</span>
							{#if multi}
								<span class="text-xs text-muted-foreground"
									>{vs.length} variant{vs.length === 1 ? '' : 's'}{q ? ' matching' : ''}</span
								>
							{:else if vs[0].sku}<span class="text-xs text-muted-foreground">{vs[0].sku}</span
								>{/if}
						</span>
						{#if st.none}<span class="text-xs text-muted-foreground">added</span>{/if}
					</label>
					{#if multi}
						{#each vs as o (o.id)}
							{@const added = existing.has(o.id)}
							<label
								class={[
									'flex cursor-pointer items-center gap-3 py-1.5 pr-3 pl-10 text-sm hover:bg-accent',
									added && 'cursor-default opacity-60'
								]}
							>
								<input
									type="checkbox"
									class="size-4 accent-primary"
									checked={added || picked.has(o.id)}
									disabled={added}
									onchange={() => toggle(o.id)}
								/>
								<Thumb src={o.image} alt={`${o.title} ${o.variant ?? ''}`} size={24} />
								<span class="min-w-0 flex-1 truncate">{o.variant ?? 'Default'}</span>
								<span class="text-xs text-muted-foreground">{added ? 'added' : (o.sku ?? '')}</span>
							</label>
						{/each}
					{/if}
				</div>
			{:else}
				<p class="p-6 text-center text-sm text-muted-foreground">No products match.</p>
			{/each}
		</div>

		<Dialog.Footer class="items-center gap-2 sm:justify-between">
			<span class="text-sm text-muted-foreground">
				{picked.size} selected
				{#if picked.size}
					· <button type="button" class="underline" onclick={() => (picked = new Set())}
						>clear</button
					>{/if}
			</span>
			<div class="flex gap-2">
				<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
				<Button disabled={!picked.size || busy} onclick={() => onadd([...picked])}
					>{busy
						? 'Adding…'
						: `Add ${picked.size || ''} ${picked.size === 1 ? 'item' : 'items'}`}</Button
				>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
