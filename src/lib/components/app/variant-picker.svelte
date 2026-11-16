<script lang="ts" module>
	export type PickerOption = {
		id: string;
		title: string;
		variant: string | null;
		sku: string | null;
		image: string | null;
	};
</script>

<script lang="ts">
	import Thumb from './thumb.svelte';

	let {
		options,
		name = 'variantId',
		id = 'variant-picker',
		placeholder = 'Type product name or SKU…',
		value = $bindable('')
	}: {
		options: PickerOption[];
		name?: string;
		id?: string;
		placeholder?: string;
		value?: string;
	} = $props();

	let query = $state('');
	let open = $state(false);
	let active = $state(0);
	let input = $state<HTMLInputElement>();
	let box = $state<HTMLDivElement>();
	/** Dropdown is fixed to the viewport so cards (overflow: hidden) can't clip it. */
	let pos = $state({ top: 0, left: 0, width: 0, maxHeight: 320, up: false });
	function place() {
		if (!box) return;
		const r = box.getBoundingClientRect();
		const below = window.innerHeight - r.bottom - 8;
		const above = r.top - 8;
		const up = below < 220 && above > below;
		pos = {
			top: up ? r.top - 4 : r.bottom + 4,
			left: r.left,
			width: r.width,
			maxHeight: Math.max(160, Math.min(320, up ? above : below)),
			up
		};
	}
	$effect(() => {
		if (open) place();
	});

	const selected = $derived(options.find((o) => o.id === value) ?? null);
	const label = (o: PickerOption) => `${o.title}${o.variant ? ` — ${o.variant}` : ''}`;

	/** Every typed word must appear in title, variant or SKU. */
	const matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return options.slice(0, 40);
		const out: PickerOption[] = [];
		for (const o of options) {
			const hay = `${o.title} ${o.variant ?? ''} ${o.sku ?? ''}`.toLowerCase();
			if (words.every((w) => hay.includes(w))) out.push(o);
			if (out.length >= 40) break;
		}
		return out;
	});

	function choose(o: PickerOption) {
		value = o.id;
		query = label(o);
		open = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			active = Math.min(active + 1, matches.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter' && open && matches[active]) {
			e.preventDefault();
			choose(matches[active]);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	/** Reset after the parent form clears `value`. */
	$effect(() => {
		if (!value) query = '';
	});
</script>

<svelte:window onresize={() => open && place()} onscrollcapture={() => open && place()} />

<div class="relative">
	<input type="hidden" {name} {value} />
	<div
		bind:this={box}
		class="flex items-center gap-2 rounded-md border bg-background pl-1.5 focus-within:ring-2 focus-within:ring-ring/50"
	>
		<Thumb src={selected?.image} alt={selected ? label(selected) : ''} size={26} zoom={false} />
		<input
			bind:this={input}
			{id}
			{placeholder}
			autocomplete="off"
			role="combobox"
			aria-expanded={open}
			aria-controls="{id}-list"
			class="h-9 w-full bg-transparent pr-3 text-sm outline-none placeholder:text-muted-foreground"
			value={query}
			oninput={(e) => {
				query = e.currentTarget.value;
				value = '';
				open = true;
				active = 0;
			}}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 150)}
			{onkeydown}
		/>
	</div>
	{#if open && matches.length}
		<ul
			id="{id}-list"
			role="listbox"
			class="fixed z-50 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-lg"
			style:left="{pos.left}px"
			style:width="{pos.width}px"
			style:max-height="{pos.maxHeight}px"
			style:top={pos.up ? null : `${pos.top}px`}
			style:bottom={pos.up ? `${window.innerHeight - pos.top}px` : null}
		>
			{#each matches as o, i (o.id)}
				<li role="option" aria-selected={i === active}>
					<button
						type="button"
						class={[
							'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left',
							i === active ? 'bg-accent' : 'hover:bg-accent/60'
						]}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(o)}
						onmouseenter={() => (active = i)}
					>
						<Thumb src={o.image} alt={label(o)} size={32} zoom={false} />
						<span class="grid min-w-0">
							<span class="truncate">{o.title}</span>
							<span class="truncate text-xs text-muted-foreground"
								>{o.variant ?? ''}{o.variant && o.sku ? ' · ' : ''}{o.sku ?? ''}</span
							>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if open && query}
		<div
			class="fixed z-50 rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-lg"
			style:left="{pos.left}px"
			style:width="{pos.width}px"
			style:top={pos.up ? null : `${pos.top}px`}
			style:bottom={pos.up ? `${window.innerHeight - pos.top}px` : null}
		>
			No product matches “{query}”.
		</div>
	{/if}
</div>
