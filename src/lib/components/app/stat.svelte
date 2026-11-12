<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children, hint }: { label: string; children: Snippet; hint?: string } = $props();
</script>

<div class="grid gap-1 rounded-lg border bg-card p-4">
	<span class="text-xs text-muted-foreground">{label}</span>
	<span class="num text-xl font-semibold tracking-tight">{@render children()}</span>
	{#if hint}<span class="text-xs text-muted-foreground">{hint}</span>{/if}
</div>
