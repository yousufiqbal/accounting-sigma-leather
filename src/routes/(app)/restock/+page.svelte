<script lang="ts">
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Trash from '@lucide/svelte/icons/trash-2';
	import TableIcon from '@lucide/svelte/icons/table';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { ask } from '#lib/confirm.svelte.js';
	import { formAction } from '#lib/form-action.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let starting = $state(false);
	let savingLead = $state(false);

	const fmt = (iso: string) =>
		new Date(iso).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Karachi'
		});
</script>

<div class="grid max-w-3xl gap-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Restock</h1>
		<p class="text-sm text-muted-foreground">
			What to order, product by product. Uses sales from the last 90 days, current stock, and what's
			already on the way in Purchases.
		</p>
	</div>

	<Card.Root>
		<Card.Content class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-medium">New restock session</div>
				<div class="text-xs text-muted-foreground">
					All active products, most urgent first. Stock is re-read every time you open it.
				</div>
			</div>
			<form
				method="POST"
				action={formAction('start')}
				use:enhance={() => {
					starting = true;
					return async ({ update }) => {
						await update();
						starting = false;
					};
				}}
			>
				<Button type="submit" disabled={starting}>
					{#if starting}<LoaderCircle class="animate-spin" />{:else}<Plus />{/if}
					{starting ? 'Preparing…' : 'Start session'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<form
		method="POST"
		action={formAction('lead')}
		class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-5 py-3"
		use:enhance={() => {
			savingLead = true;
			return async ({ update }) => {
				await update({ reset: false });
				savingLead = false;
			};
		}}
	>
		<div class="text-sm font-medium" title="How many days a shipment takes to arrive">
			Lead times
		</div>
		<label class="flex items-center gap-1.5 text-sm text-muted-foreground">
			✈ Air
			<Input
				name="airDays"
				type="number"
				min="1"
				max="365"
				value={data.lead.airDays}
				required
				class="h-8 w-16 text-center"
			/>
			days
		</label>
		<label class="flex items-center gap-1.5 text-sm text-muted-foreground">
			🚢 Sea
			<Input
				name="seaDays"
				type="number"
				min="1"
				max="365"
				value={data.lead.seaDays}
				required
				class="h-8 w-16 text-center"
			/>
			days
		</label>
		<Button type="submit" size="sm" variant="outline" class="ml-auto" disabled={savingLead}
			>{savingLead ? 'Saving…' : 'Save'}</Button
		>
	</form>

	{#if data.sessions.length}
		<div class="grid gap-2">
			<h2 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				Previous sessions
			</h2>
			<Card.Root class="py-0">
				<Card.Content class="divide-y px-0">
					{#each data.sessions as s (s.id)}
						<div class="flex items-center gap-2 px-4 py-3 hover:bg-muted/30">
							<a
								href="/restock/{s.id}/{s.completedAt ? 'complete' : s.resume}"
								class="flex min-w-0 flex-1 items-center justify-between gap-3"
							>
								<span class="text-sm">{fmt(s.startedAt)}</span>
								<span class="flex items-center gap-2">
									{#if !s.completedAt && s.total}<span class="num text-xs text-muted-foreground"
											>{s.done}/{s.total}</span
										>{/if}
									<StatusBadge
										tone={s.completedAt ? 'success' : 'warning'}
										label={s.completedAt ? 'complete' : 'in progress'}
									/>
								</span>
							</a>
							<Button
								href="/restock/{s.id}/table"
								variant="ghost"
								size="icon-sm"
								title="Open in table view"
								aria-label="Open in table view"><TableIcon /></Button
							>
							<form
								method="POST"
								action={formAction('delete')}
								use:enhance={async ({ cancel }) => {
									if (
										!(await ask({
											title: 'Delete this restock session?',
											description: 'Its quantities are removed. Purchases already created stay.',
											confirmLabel: 'Delete',
											destructive: true
										}))
									)
										cancel();
								}}
							>
								<input type="hidden" name="id" value={s.id} />
								<Button
									type="submit"
									variant="ghost"
									size="icon-sm"
									class="text-muted-foreground hover:text-danger"
									aria-label="Delete session"><Trash /></Button
								>
							</form>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>
