<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="grid gap-4">
	<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
	<Card.Root>
		<Card.Header>
			<Card.Title>Connections</Card.Title>
			<Card.Description>Checked live each time this page loads.</Card.Description>
		</Card.Header>
		<Card.Content>
			<ul class="divide-y">
				{#each data.checks as c (c.name)}
					<li class="flex items-center justify-between gap-4 py-3">
						<div class="grid">
							<span class="text-sm font-medium">{c.name}</span>
							<span class="text-xs break-all text-muted-foreground">{c.detail}</span>
						</div>
						<Badge class={c.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}>
							{c.ok ? 'OK' : 'Error'}
						</Badge>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>
</div>
