<script lang="ts">
	/**
	 * One measure per month as bars (losses hang below the zero line). Hover a month for its value.
	 * Values in paisa. Single series → one colour; the title names it, no legend needed.
	 */
	import { formatRs } from '#lib/money.js';

	type Point = { key: string; label: string; value: number; note?: string };
	let { points, name }: { points: Point[]; name: string } = $props();

	let width = $state(0);
	const H = 240;
	const pad = { top: 14, right: 8, bottom: 26, left: 52 };
	let hover = $state<number | null>(null);

	/** Short axis money: 950, 12k, 1.2M (rupees). */
	const short = (paisa: number) => {
		const rs = paisa / 100;
		const a = Math.abs(rs);
		const s =
			a >= 1e6 ? `${+(rs / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(rs / 1e3).toFixed(0)}k` : `${rs}`;
		return s;
	};

	const scale = $derived.by(() => {
		const vals = points.map((p) => p.value);
		const lo = Math.min(0, ...vals);
		const hi = Math.max(0, ...vals);
		const span = hi - lo || 1;
		// Nice step: 1, 2, 2.5 or 5 × 10^n, about 4 gridlines.
		const raw = span / 4;
		const mag = 10 ** Math.floor(Math.log10(raw));
		const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
		const min = Math.floor(lo / step) * step;
		const max = Math.ceil(hi / step) * step || step;
		const ticks: number[] = [];
		for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t));
		return { min, max, ticks };
	});

	const innerW = $derived(Math.max(0, width - pad.left - pad.right));
	const innerH = H - pad.top - pad.bottom;
	const y = (v: number) => pad.top + ((scale.max - v) / (scale.max - scale.min)) * innerH;
	const band = $derived(points.length ? innerW / points.length : 0);
	const barW = $derived(Math.max(6, Math.min(44, band * 0.62)));
	const cx = (i: number) => pad.left + band * i + band / 2;

	/** Bar with a 4px rounded data end; the baseline end stays square. */
	function bar(i: number, v: number) {
		const x0 = cx(i) - barW / 2;
		const x1 = x0 + barW;
		const base = y(0);
		const end = y(v);
		const len = Math.abs(base - end);
		if (len < 0.5) return '';
		const r = Math.min(4, len, barW / 2);
		if (v >= 0)
			return `M${x0},${base}V${end + r}Q${x0},${end} ${x0 + r},${end}H${x1 - r}Q${x1},${end} ${x1},${end + r}V${base}Z`;
		return `M${x0},${base}V${end - r}Q${x0},${end} ${x0 + r},${end}H${x1 - r}Q${x1},${end} ${x1},${end - r}V${base}Z`;
	}

	/** Show every month label when there's room, otherwise every other one. */
	const labelEvery = $derived(band >= 44 ? 1 : band >= 22 ? 2 : 3);
</script>

<div class="relative w-full" bind:clientWidth={width}>
	{#if width > 0}
		<svg
			{width}
			height={H}
			role="img"
			aria-label="{name} by month"
			class="block overflow-visible"
			onmouseleave={() => (hover = null)}
		>
			{#each scale.ticks as t (t)}
				<line
					x1={pad.left}
					x2={width - pad.right}
					y1={y(t)}
					y2={y(t)}
					class={t === 0 ? 'stroke-muted-foreground/60' : 'stroke-border'}
					stroke-width="1"
				/>
				<text
					x={pad.left - 8}
					y={y(t)}
					dy="0.32em"
					text-anchor="end"
					class="fill-muted-foreground text-[11px] tabular-nums">{short(t)}</text
				>
			{/each}

			{#each points as p, i (p.key)}
				<path
					d={bar(i, p.value)}
					fill="var(--chart-1)"
					opacity={hover === null || hover === i ? 1 : 0.45}
				/>
				{#if i % labelEvery === 0}
					<text
						x={cx(i)}
						y={H - 8}
						text-anchor="middle"
						class={[
							'text-[11px]',
							hover === i ? 'fill-foreground font-medium' : 'fill-muted-foreground'
						]}>{p.label}</text
					>
				{/if}
				<!-- Hit area: the whole column, bigger than the bar. -->
				<rect
					x={pad.left + band * i}
					y={pad.top}
					width={band}
					height={innerH}
					fill="transparent"
					role="presentation"
					onmouseenter={() => (hover = i)}
				/>
			{/each}
		</svg>

		{#if hover !== null && points[hover]}
			{@const p = points[hover]}
			<div
				class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-sm"
				style:left="{Math.min(Math.max(cx(hover), 70), width - 70)}px"
				style:top="{Math.max(0, Math.min(y(p.value), y(0)) - 52)}px"
			>
				<div class="text-muted-foreground">{p.label}</div>
				<div class="num text-sm font-semibold">{formatRs(p.value)}</div>
				{#if p.note}<div class="text-muted-foreground">{p.note}</div>{/if}
			</div>
		{/if}
	{/if}
</div>
