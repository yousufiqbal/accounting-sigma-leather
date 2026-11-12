<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';

	let { title, phase, items = [] }: { title: string; phase: number; items?: string[] } = $props();
</script>

<div class="grid gap-4">
	<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
	<Card.Root>
		<Card.Header>
			<Card.Title>Coming in phase {phase}</Card.Title>
			<Card.Description>See SPEC.md §10 for the build order.</Card.Description>
		</Card.Header>
		{#if items.length}
			<Card.Content>
				<ul class="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
					{#each items as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</Card.Content>
		{/if}
	</Card.Root>
</div>
