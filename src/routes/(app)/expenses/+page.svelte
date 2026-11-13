<script lang="ts">
	import { formAction } from '#lib/form-action.js';
	import { ask } from '#lib/confirm.svelte.js';
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Lock from '@lucide/svelte/icons/lock';
	import X from '@lucide/svelte/icons/x';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Money from '#lib/components/app/money.svelte';
	import Stat from '#lib/components/app/stat.svelte';
	import { formatRs } from '#lib/money.js';
	import { currentMonth, monthLabel } from '#lib/month.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Expense = (typeof data.expenses)[number];
	let open = $state(false);
	let saving = $state(false);
	let editing = $state<Expense | null>(null);
	let categoryId = $state('');
	let inUsd = $state(false);
	let usd = $state('');
	let rate = $state('');
	let amount = $state('');

	const catById = $derived(new Map(data.categories.map((c) => [c.id, c])));
	const totals = $derived(new Map(data.byCat.map((c) => [c.categoryId, c.total])));
	const total = $derived(data.byCat.reduce((s, c) => s + c.total, 0));
	const marketing = $derived(
		data.byCat
			.filter((c) => catById.get(c.categoryId)?.group === 'marketing')
			.reduce((s, c) => s + c.total, 0)
	);
	const defaultDate = $derived(
		data.month === currentMonth()
			? new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
			: `${data.month}-01`
	);
	const usdPreview = $derived.by(() => {
		const u = Number(usd.replace(/,/g, '')),
			r = Number(rate.replace(/,/g, ''));
		return u > 0 && r > 0 ? Math.round(u * r * 100) : null;
	});

	function openForm(e: Expense | null, catId?: string) {
		editing = e;
		categoryId = e?.categoryId ?? catId ?? data.categories.find((c) => !c.archived)?.id ?? '';
		inUsd = !!e?.usdCents || (!e && catById.get(categoryId)?.group === 'marketing');
		usd = e?.usdCents ? String(e.usdCents / 100) : '';
		rate = e?.fxRateX10000
			? String(e.fxRateX10000 / 10_000)
			: data.lastUsdRate
				? String(data.lastUsdRate / 10_000)
				: '';
		amount = e ? String(e.amount / 100) : '';
		open = true;
	}
	const fmtDate = (d: string) =>
		new Date(`${d}T12:00:00+05:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Expenses</h1>
			<p class="text-sm text-muted-foreground">
				{monthLabel(data.month)} · enter what actually left the bank, in Rs. Your own drawings are not
				expenses.
			</p>
		</div>
		<Button onclick={() => openForm(null)} disabled={data.locked}><Plus /> Add expense</Button>
	</div>

	{#if data.locked}
		<div
			class="flex items-center gap-2 rounded-lg border bg-muted p-3 text-sm text-muted-foreground"
		>
			<Lock class="size-4" />
			{monthLabel(data.month)} is locked. Unlock it in Reports to change expenses.
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3 md:grid-cols-3">
		<Stat label="Total expenses">{formatRs(total)}</Stat>
		<Stat label="Marketing (ads)">{formatRs(marketing)}</Stat>
		<Stat label="Operating">{formatRs(total - marketing)}</Stat>
	</div>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
		{#each data.categories.filter((c) => !c.archived || totals.get(c.id)) as c (c.id)}
			<button
				type="button"
				disabled={data.locked}
				onclick={() => openForm(null, c.id)}
				class="grid gap-0.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-card"
			>
				<span class="text-xs text-muted-foreground">{c.name}</span>
				<span class={['num text-sm font-medium', !totals.get(c.id) && 'text-muted-foreground']}>
					{formatRs(totals.get(c.id) ?? 0)}
				</span>
			</button>
		{/each}
	</div>

	<Card.Root>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="pl-6">Date</Table.Head>
						<Table.Head>Category</Table.Head>
						<Table.Head>Note</Table.Head>
						<Table.Head class="text-right">USD</Table.Head>
						<Table.Head class="text-right">Amount</Table.Head>
						<Table.Head class="w-24 pr-6"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.expenses as e (e.id)}
						<Table.Row>
							<Table.Cell class="pl-6 text-sm">{fmtDate(e.date)}</Table.Cell>
							<Table.Cell>{catById.get(e.categoryId)?.name ?? '—'}</Table.Cell>
							<Table.Cell class="max-w-64 truncate text-sm text-muted-foreground"
								>{e.note ?? ''}</Table.Cell
							>
							<Table.Cell class="num text-right text-sm text-muted-foreground">
								{#if e.usdCents}${(e.usdCents / 100).toFixed(2)}{#if e.fxRateX10000}<div
											class="text-xs"
										>
											@ {e.fxRateX10000 / 10_000}
										</div>{/if}{/if}
							</Table.Cell>
							<Table.Cell class="text-right font-medium"><Money paisa={e.amount} /></Table.Cell>
							<Table.Cell class="pr-6">
								{#if !data.locked}
									<div class="flex justify-end gap-1">
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label="Edit"
											onclick={() => openForm(e)}><Pencil /></Button
										>
										<form
											method="POST"
											action={formAction('delete')}
											use:enhance={async ({ cancel }) => {
												const ok = await ask({
													title: 'Delete expense?',
													description: `${formatRs(e.amount)} · ${catById.get(e.categoryId)?.name ?? ''} · ${fmtDate(e.date)}${e.note ? ` · ${e.note}` : ''}`,
													confirmLabel: 'Delete',
													destructive: true
												});
												if (!ok) cancel();
											}}
										>
											<input type="hidden" name="id" value={e.id} />
											<Button type="submit" size="icon-sm" variant="ghost" aria-label="Delete"
												><Trash /></Button
											>
										</form>
									</div>
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="py-10 text-center text-muted-foreground">
								No expenses in {monthLabel(data.month)}. Click a category above to add one.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<details class="text-sm">
		<summary class="cursor-pointer text-muted-foreground">Manage categories</summary>
		<div class="mt-2 flex flex-wrap gap-2">
			{#each data.categories.filter((c) => !c.archived) as c (c.id)}
				{#if data.usedCategories.includes(c.id)}
					<span
						class="inline-flex items-center rounded-full border bg-card px-3 py-1 text-muted-foreground"
						title="Has expenses — can't be removed">{c.name}</span
					>
				{:else}
					<form
						method="POST"
						action={formAction('removeCategory')}
						use:enhance={async ({ cancel }) => {
							const ok = await ask({
								title: `Remove category “${c.name}”?`,
								confirmLabel: 'Remove',
								destructive: true
							});
							if (!ok) cancel();
						}}
						class="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-0.5 pl-3"
					>
						<input type="hidden" name="id" value={c.id} />
						<span>{c.name}</span>
						<Button
							type="submit"
							size="icon-xs"
							variant="ghost"
							aria-label="Remove {c.name}"
							class="rounded-full"><X /></Button
						>
					</form>
				{/if}
			{/each}
		</div>
		<form
			method="POST"
			action={formAction('addCategory')}
			use:enhance
			class="mt-3 flex flex-wrap items-end gap-2"
		>
			<Input name="name" placeholder="Name" class="w-48" aria-label="Category name" />
			<select
				name="group"
				class="h-9 rounded-md border bg-background px-2 text-sm"
				aria-label="Group"
			>
				<option value="operating">Operating</option>
				<option value="marketing">Marketing</option>
			</select>
			<Button type="submit" variant="outline" size="sm">Add</Button>
		</form>
	</details>
</div>

<Sheet.Root bind:open>
	<Sheet.Content side="right">
		<Sheet.Header>
			<Sheet.Title>{editing ? 'Edit expense' : 'Add expense'}</Sheet.Title>
			<Sheet.Description
				>For card payments in USD, the Rs your bank charged is the most accurate.</Sheet.Description
			>
		</Sheet.Header>
		<form
			method="POST"
			action={formAction('save')}
			class="grid gap-4 px-4"
			use:enhance={() => {
				saving = true;
				return async ({ update, result }) => {
					await update();
					saving = false;
					if (result.type === 'success') open = false;
				};
			}}
		>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<div class="grid gap-2">
				<Label for="date">Date paid</Label>
				<Input id="date" name="date" type="date" value={editing?.date ?? defaultDate} required />
			</div>
			<div class="grid gap-2">
				<Label for="categoryId">Category</Label>
				<select
					id="categoryId"
					name="categoryId"
					bind:value={categoryId}
					class="h-9 rounded-md border bg-background px-2 text-sm"
				>
					{#each data.categories.filter((c) => !c.archived || c.id === editing?.categoryId) as c (c.id)}<option
							value={c.id}>{c.name}</option
						>{/each}
				</select>
			</div>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={inUsd} /> Paid in USD (card)
			</label>
			{#if inUsd}
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-2">
						<Label for="usd">USD</Label>
						<Input id="usd" name="usd" inputmode="decimal" bind:value={usd} />
					</div>
					<div class="grid gap-2">
						<Label for="rate">Rs per USD</Label>
						<Input
							id="rate"
							name="rate"
							inputmode="decimal"
							bind:value={rate}
							placeholder="from bank statement"
						/>
					</div>
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="amount">Amount in Rs {inUsd ? '(as charged by bank — optional)' : ''}</Label>
				<Input
					id="amount"
					name="amount"
					inputmode="decimal"
					bind:value={amount}
					placeholder={inUsd && usdPreview ? (usdPreview / 100).toFixed(0) : ''}
				/>
				{#if inUsd && !amount && usdPreview}
					<p class="text-xs text-muted-foreground">
						Will be saved as {formatRs(usdPreview)} (USD × rate).
					</p>
				{/if}
			</div>
			<div class="grid gap-2">
				<Label for="note">Note</Label>
				<Input
					id="note"
					name="note"
					value={editing?.note ?? ''}
					placeholder="e.g. Meta ads 1–15 Nov"
				/>
			</div>
			<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
		</form>
	</Sheet.Content>
</Sheet.Root>
