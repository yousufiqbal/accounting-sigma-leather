<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { confirmState } from '#lib/confirm.svelte.js';

	const c = $derived(confirmState.current);
</script>

<Dialog.Root
	bind:open={confirmState.open}
	onOpenChange={(open) => {
		if (!open) confirmState.settle(false); // Esc / click outside / ✕ = cancel
	}}
>
	<Dialog.Content showCloseButton={false} class="sm:max-w-md">
		{#if c}
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					{#if c.destructive}<TriangleAlert class="size-4 text-danger" />{/if}
					{c.title}
				</Dialog.Title>
				{#if c.description}
					<Dialog.Description class="whitespace-pre-line">{c.description}</Dialog.Description>
				{/if}
			</Dialog.Header>
			<Dialog.Footer>
				{#if c.kind === 'ask'}
					<Button variant="outline" onclick={() => confirmState.settle(false)}
						>{c.cancelLabel ?? 'Cancel'}</Button
					>
					<Button
						variant={c.destructive ? 'destructive' : 'default'}
						onclick={() => confirmState.settle(true)}
					>
						{c.confirmLabel ?? 'Confirm'}
					</Button>
				{:else}
					<Button onclick={() => confirmState.settle(true)}>{c.confirmLabel ?? 'OK'}</Button>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
