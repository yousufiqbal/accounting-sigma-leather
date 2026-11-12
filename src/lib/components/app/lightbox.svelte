<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';
	import { lightbox, sizedImage } from '#lib/lightbox.svelte.js';
</script>

<DialogPrimitive.Root bind:open={lightbox.open}>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
		/>
		<DialogPrimitive.Content
			class="fixed inset-0 z-50 grid place-items-center p-4 outline-none sm:p-10 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
			onclick={(e) => {
				if (e.target === e.currentTarget) lightbox.open = false; // click outside the image
			}}
		>
			<DialogPrimitive.Title class="sr-only">{lightbox.alt || 'Image'}</DialogPrimitive.Title>
			{#if lightbox.src}
				<figure class="grid max-h-full max-w-full justify-items-center gap-3">
					<img
						src={sizedImage(lightbox.src, 1600)}
						alt={lightbox.alt}
						class="max-h-[80vh] max-w-full rounded-lg bg-white object-contain shadow-2xl"
					/>
					{#if lightbox.alt}
						<figcaption class="max-w-2xl text-center text-sm text-white/85">{lightbox.alt}</figcaption>
					{/if}
				</figure>
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
