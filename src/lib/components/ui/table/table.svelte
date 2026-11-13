<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLTableAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		/** Long tables: column headings stay pinned under the top bar while the page scrolls (wide screens). */
		sticky = false,
		children,
		...restProps
	}: WithElementRef<HTMLTableAttributes> & { sticky?: boolean } = $props();
</script>

<div data-slot="table-container" class="relative w-full overflow-x-auto">
	<table
		bind:this={ref}
		data-slot="table"
		data-sticky={sticky || undefined}
		class={cn('w-full caption-bottom text-sm', className)}
		{...restProps}
	>
		{@render children?.()}
	</table>
</div>
