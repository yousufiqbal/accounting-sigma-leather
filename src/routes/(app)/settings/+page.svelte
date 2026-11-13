<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import History from '@lucide/svelte/icons/history';
	import { ask } from '#lib/confirm.svelte.js';
	import { sync } from '#lib/sync.svelte.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function fullSync() {
		const ok = await ask({
			title: 'Re-read all history?',
			description:
				'Pulls every Shopify order and product and every PostEx parcel again. Takes a few minutes. Only needed if something looks wrong.',
			confirmLabel: 'Start full sync'
		});
		if (ok) sync.run('full');
	}
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

	<Card.Root>
		<Card.Header>
			<Card.Title>Full history sync</Card.Title>
			<Card.Description>
				The Sync button at the top keeps recent changes up to date (and runs on its own when you
				open the panel). Use this only to re-read everything from Shopify and PostEx.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3">
			<div>
				<Button variant="outline" onclick={fullSync} disabled={sync.running}>
					<History />
					{sync.running && sync.mode === 'full' ? 'Syncing all history…' : 'Full history sync'}
				</Button>
			</div>
			{#if sync.mode === 'full' && sync.steps.length}
				<ul class="grid gap-1 text-sm">
					{#each sync.steps as s (s.id)}
						<li>
							<span class="font-medium">{s.label}:</span>
							<span class={s.status === 'failed' ? 'text-danger' : 'text-muted-foreground'}>
								{s.status === 'running' ? 'running…' : s.status === 'waiting' ? 'waiting' : s.text}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
