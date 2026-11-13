<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLTableAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		/** Long tables: scroll inside a screen-tall box with the column headings pinned on top. */
		sticky = false,
		children,
		...restProps
	}: WithElementRef<HTMLTableAttributes> & { sticky?: boolean } = $props();
</script>

<div
	data-slot="table-container"
	class={cn(
		'relative w-full overflow-x-auto',
		sticky && 'max-h-[calc(100svh-8rem)] overflow-y-auto overscroll-contain'
	)}
>
	<table
		bind:this={ref}
		data-slot="table"
		class={cn(
			'w-full caption-bottom text-sm',
			sticky &&
				'[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_var(--border)]',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</table>
</div>
