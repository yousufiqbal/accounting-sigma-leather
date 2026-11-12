<script lang="ts">
	import { formatRs } from '#lib/money.js';

	let {
		paisa,
		decimals = false,
		colored = false,
		muted = false
	}: { paisa: number; decimals?: boolean; colored?: boolean; muted?: boolean } = $props();
</script>

<span
	class={[
		'num whitespace-nowrap',
		paisa < 0 && 'text-danger',
		colored && paisa > 0 && 'text-success',
		muted && paisa === 0 && 'text-muted-foreground'
	]}>{formatRs(paisa, { decimals })}</span
>
