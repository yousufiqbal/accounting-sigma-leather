import { toPaisa } from '../../money.js';

/**
 * Parse a courier timestamp to UTC ISO.
 * - "2026-11-10 14:13:00" (no zone) → treated as Pakistan time (+05:00)
 * - "2026-11-06T18:32:59.000+0500" → zone respected
 */
export function parsePkTime(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	let s = String(value).trim();
	if (!s) return null;
	s = s.replace(' ', 'T');
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
	if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += '+05:00';
	s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
	const d = new Date(s);
	if (Number.isNaN(d.getTime())) throw new Error(`Bad date: ${value}`);
	return d.toISOString();
}

/** Money cell → paisa, absolute value (couriers show deductions as negatives). */
export const absPaisa = (v: unknown) =>
	Math.abs(toPaisa(v === null || v === undefined ? '' : String(v)));
export const paisa = (v: unknown) => toPaisa(v === null || v === undefined ? '' : String(v));

/** 2% withholding on COD, rounded to the paisa (matches PostEx CSV exactly). */
export const twoPercent = (codPaisa: number) => Math.round(codPaisa * 0.02);

/**
 * Normalize a courier "order ref" to a Shopify order number.
 *  "2657" / "#2427" → { orderName: "2657" }
 *  "1326-2" / "1290 Part 2" → { orderName: "1326", extraParcel: true }
 *  "1103 Incomplete Warning" → { orderName: "1103" }
 *  "WP000254", "00097" → null (not a Shopify order number)
 */
export function normalizeOrderRef(
	ref: unknown
): { orderName: string; extraParcel: boolean } | null {
	const s = String(ref ?? '')
		.trim()
		.replace(/^#/, '');
	const m = s.match(/^([1-9]\d{2,})(?:\s*(?:-|part)\s*(\d+))?/i);
	if (!m) return null;
	return { orderName: m[1], extraParcel: !!m[2] };
}

/** Header → comparable key: lowercase alphanumerics only. */
export const headerKey = (h: unknown) =>
	String(h ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
