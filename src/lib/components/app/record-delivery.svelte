<script lang="ts">
	/** Record a delivery/return that has no PostEx/DEX data. Open with `show(order)`. */
	import { enhance } from '$app/forms';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	type Target = { id: string; name: string; outstanding: number; tags: string[] };
	let open = $state(false);
	let saving = $state(false);
	let target = $state<Target | null>(null);
	let manualStatus = $state<'delivered' | 'returned'>('delivered');
	const COURIER_TAGS = /leopards|karachi logistics|^kl$|pickup|daraz|dex|postex|tcs|m&p|trax/i;
	const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

	export function show(order: Target) {
		target = order;
		manualStatus = 'delivered';
		open = true;
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right">
		<Sheet.Header>
			<Sheet.Title>Record delivery · #{target?.name}</Sheet.Title>
			<Sheet.Description
				>For orders sent without PostEx/DEX (Leopards, pickup, own rider…).</Sheet.Description
			>
		</Sheet.Header>
		{#if target}
			<form
				method="POST"
				action="/orders?/manualDelivery"
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
				<input type="hidden" name="orderId" value={target.id} />
				<div class="grid gap-2">
					<Label>Outcome</Label>
					<div class="flex gap-2">
						{#each ['delivered', 'returned'] as s (s)}
							<label
								class={[
									'flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm',
									manualStatus === s && 'border-primary bg-accent'
								]}
							>
								<input
									type="radio"
									name="status"
									value={s}
									bind:group={manualStatus}
									class="sr-only"
								/>
								{s === 'delivered' ? 'Delivered' : 'Returned'}
							</label>
						{/each}
					</div>
				</div>
				<div class="grid gap-2">
					<Label for="how">Sent by</Label>
					<Input
						id="how"
						name="how"
						placeholder="Leopards / Pickup / Rider"
						value={target.tags.find((t) => COURIER_TAGS.test(t)) ?? ''}
					/>
				</div>
				<div class="grid gap-2">
					<Label for="date">{manualStatus === 'delivered' ? 'Delivered on' : 'Returned on'}</Label>
					<Input id="date" name="date" type="date" value={today} required />
				</div>
				{#if manualStatus === 'delivered'}
					<div class="grid gap-2">
						<Label for="cash">Cash collected (Rs)</Label>
						<Input
							id="cash"
							name="cash"
							inputmode="decimal"
							value={String(target.outstanding / 100)}
						/>
						<p class="text-xs text-muted-foreground">0 if the customer paid in advance.</p>
					</div>
				{/if}
				<div class="grid gap-2">
					<Label for="fee">Courier charge (Rs)</Label>
					<Input id="fee" name="fee" inputmode="decimal" value="0" />
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="received" class="size-4" checked />
					Money already received (no courier payment pending)
				</label>
				<Sheet.Footer class="px-0">
					<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
				</Sheet.Footer>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>
