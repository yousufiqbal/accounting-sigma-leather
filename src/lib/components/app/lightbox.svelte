<script lang="ts">
	/**
	 * Big image view. ← → (or the side buttons) move through the gallery, the strip at the bottom
	 * jumps. Old and new image slide past each other (quint ease, as in the dispatcher panel).
	 * Images load at screen size (never the full original); neighbours are preloaded.
	 */
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { fly, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { lightbox, sizedImage, viewWidth } from '#lib/lightbox.svelte.js';

	const W = viewWidth();
	const preloaded = new Set<string>();
	let strip = $state<HTMLDivElement>();

	const cur = $derived(lightbox.current);
	const many = $derived(lightbox.items.length > 1);

	// Preload the next and previous big images.
	$effect(() => {
		if (!lightbox.open || !many) return;
		for (const step of [1, -1]) {
			const n = lightbox.items.length;
			const it = lightbox.items[(lightbox.index + step + n) % n];
			if (!it) continue;
			const url = sizedImage(it.src, W);
			if (preloaded.has(url)) continue;
			preloaded.add(url);
			new Image().src = url;
		}
	});
	// Keep the active thumbnail in view.
	$effect(() => {
		const i = lightbox.index;
		if (!lightbox.open) return;
		const el = strip?.querySelector<HTMLElement>(`[data-i="${i}"]`);
		if (strip && el)
			strip.scrollTo({
				left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2,
				behavior: 'smooth'
			});
	});

	function onkeydown(e: KeyboardEvent) {
		if (!lightbox.open) return;
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			lightbox.go(1);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			lightbox.go(-1);
		}
	}
</script>

<svelte:window {onkeydown} />

<DialogPrimitive.Root bind:open={lightbox.open}>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
		/>
		<DialogPrimitive.Content
			class="fixed inset-0 z-50 flex flex-col outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
		>
			<DialogPrimitive.Title class="sr-only">{cur?.title || 'Image'}</DialogPrimitive.Title>
			{#if many}
				<span
					class="num absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-base font-semibold text-white/90"
					>{lightbox.index + 1} / {lightbox.items.length}</span
				>
			{/if}
			<div
				class="flex min-h-0 flex-1 items-center justify-center gap-2 p-4 pt-16 sm:gap-4"
				role="presentation"
				onclick={(e) => {
					if (e.target === e.currentTarget) lightbox.open = false; // click outside the image
				}}
			>
				{#if many}
					<button
						type="button"
						disabled={lightbox.index === 0}
						class="shrink-0 rounded-full p-1.5 text-white/70 transition-opacity hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-20"
						aria-label="Previous image"
						onclick={() => lightbox.go(-1)}><ChevronLeft class="size-7" /></button
					>
				{/if}
				{#if cur}
					<!-- Old and new image share one grid cell, so they slide past each other. -->
					<div class="grid min-w-0" in:scale={{ duration: 220, start: 0.92, easing: quintOut }}>
						{#key lightbox.index}
							<figure
								class="col-start-1 row-start-1 grid justify-items-center gap-3"
								in:fly={{ x: 60 * lightbox.dir, duration: 260, easing: quintOut }}
								out:fly={{ x: -60 * lightbox.dir, duration: 260, easing: quintOut }}
							>
								<img
									src={sizedImage(cur.src, W)}
									alt={cur.title}
									decoding="async"
									class="max-h-[62vh] max-w-full rounded-xl bg-white object-contain shadow-2xl"
								/>
								<figcaption class="grid justify-items-center gap-1.5 text-center">
									<p class="max-w-2xl text-sm font-medium text-white">{cur.title}</p>
									{#if cur.caption}
										<span
											class="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white/90"
											>{cur.caption}</span
										>
									{/if}
								</figcaption>
							</figure>
						{/key}
					</div>
				{/if}
				{#if many}
					<button
						type="button"
						disabled={lightbox.index === lightbox.items.length - 1}
						class="shrink-0 rounded-full p-1.5 text-white/70 transition-opacity hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-20"
						aria-label="Next image"
						onclick={() => lightbox.go(1)}><ChevronRight class="size-7" /></button
					>
				{/if}
			</div>

			{#if many}
				<div
					bind:this={strip}
					class="flex shrink-0 [scrollbar-width:thin] overflow-x-auto pt-2 pb-4"
				>
					<div class="flex gap-2 px-[calc(50vw-28px)]">
						{#each lightbox.items as it, i (i)}
							<button
								type="button"
								data-i={i}
								class={[
									'size-14 shrink-0 overflow-hidden rounded-md bg-white ring-2 transition',
									i === lightbox.index
										? 'ring-white'
										: 'opacity-60 ring-transparent hover:opacity-100'
								]}
								title={it.title}
								onclick={() => lightbox.jump(i)}
							>
								<img
									src={sizedImage(it.src, 112)}
									alt={it.title}
									loading="lazy"
									class="size-full object-cover"
								/>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<DialogPrimitive.Close
				class="absolute top-4 right-4 grid size-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
				aria-label="Close"
			>
				<X class="size-5" />
			</DialogPrimitive.Close>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>
