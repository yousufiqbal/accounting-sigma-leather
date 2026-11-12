<script lang="ts" module>
	/** Fixed status → color mapping (SPEC.md §8). Use this everywhere, never ad-hoc colors. */
	const TONES = {
		muted: 'bg-muted text-muted-foreground',
		info: 'bg-info-soft text-info',
		success: 'bg-success-soft text-success',
		danger: 'bg-danger-soft text-danger',
		warning: 'bg-warning-soft text-warning',
		excluded: 'bg-excluded-soft text-excluded'
	} as const;
	export type Tone = keyof typeof TONES;

	const STATUS_TONE: Record<string, Tone> = {
		booked: 'muted',
		draft: 'muted',
		in_transit: 'info',
		delivered: 'success',
		final: 'success',
		returned: 'danger',
		conflict: 'danger',
		cancelled: 'muted',
		estimated: 'warning',
		provisional: 'warning',
		unmatched: 'excluded',
		excluded: 'excluded',
		new: 'info',
		updated: 'warning',
		unchanged: 'muted'
	};
	const LABEL: Record<string, string> = { in_transit: 'in transit' };
</script>

<script lang="ts">
	let { status, tone, label }: { status?: string; tone?: Tone; label?: string } = $props();
	const t = $derived(tone ?? STATUS_TONE[status ?? ''] ?? 'muted');
</script>

<span
	class={[
		'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
		TONES[t]
	]}
>
	{label ?? LABEL[status ?? ''] ?? status}
</span>
