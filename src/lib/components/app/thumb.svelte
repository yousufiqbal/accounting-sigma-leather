<script lang="ts">
	import ImageOff from '@lucide/svelte/icons/image-off';
	import { openLightbox, sizedImage } from '#lib/lightbox.svelte.js';

	let {
		src,
		alt = '',
		size = 36,
		zoom = true
	}: { src: string | null | undefined; alt?: string; size?: number; zoom?: boolean } = $props();
</script>

{#if src}
	{#if zoom}
		<button
			type="button"
			class="shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-border transition hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			style:width="{size}px"
			style:height="{size}px"
			title="View image"
			onclick={(e) => {
				e.stopPropagation();
				openLightbox(src, alt);
			}}
		>
			<img src={sizedImage(src, size * 2)} {alt} loading="lazy" class="size-full object-cover" />
		</button>
	{:else}
		<img
			src={sizedImage(src, size * 2)}
			{alt}
			loading="lazy"
			class="shrink-0 rounded-md bg-white object-cover ring-1 ring-border"
			style:width="{size}px"
			style:height="{size}px"
		/>
	{/if}
{:else}
	<span
		class="grid shrink-0 place-items-center rounded-md bg-muted text-muted-foreground/60 ring-1 ring-border"
		style:width="{size}px"
		style:height="{size}px"
		title="No image"
	>
		<ImageOff class="size-3.5" />
	</span>
{/if}
