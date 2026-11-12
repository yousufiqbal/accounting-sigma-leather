/** Money helpers. All amounts are integer paisa (1 Rs = 100 paisa). */

const fmt0 = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Parse "1,234.56" / 1234.56 / "-172.5" → paisa. Empty → 0. */
export function toPaisa(value: string | number | null | undefined): number {
	if (value === null || value === undefined || value === '') return 0;
	const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
	if (!Number.isFinite(n)) throw new Error(`Not a number: ${value}`);
	return Math.round(n * 100);
}

/**
 * Format paisa for display. Losses in parentheses: (12,500).
 * `decimals` true only for detail rows; reports use whole rupees.
 */
export function formatRs(
	paisa: number,
	opts: { decimals?: boolean; prefix?: boolean } = {}
): string {
	const { decimals = false, prefix = true } = opts;
	const abs = Math.abs(paisa) / 100;
	const body = (decimals ? fmt2 : fmt0).format(abs);
	const withPrefix = prefix ? `Rs ${body}` : body;
	return paisa < 0 ? `(${withPrefix})` : withPrefix;
}

export function formatPct(ratio: number, digits = 1): string {
	if (!Number.isFinite(ratio)) return '—';
	return `${(ratio * 100).toFixed(digits)}%`;
}
