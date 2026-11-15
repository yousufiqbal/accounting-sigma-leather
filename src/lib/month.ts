/** Month helpers. Months are "YYYY-MM" in Asia/Karachi (UTC+5, no DST). */

export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function currentMonth(now = new Date()): string {
	const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
	return pkt.toISOString().slice(0, 7);
}

export function isMonth(value: string | null | undefined): value is string {
	return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	const d = new Date(Date.UTC(y, m - 1 + delta, 1));
	return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

/** UTC ISO bounds [start, end) of a PKT month, for querying ISO timestamps. */
export function monthBoundsUtc(month: string): { start: string; end: string } {
	const [y, m] = month.split('-').map(Number);
	const start = new Date(Date.UTC(y, m - 1, 1) - PKT_OFFSET_MS);
	const end = new Date(Date.UTC(y, m, 1) - PKT_OFFSET_MS);
	return { start: start.toISOString(), end: end.toISOString() };
}

/** Inclusive list of months from `a` to `b` ("YYYY-MM"). */
export function monthsBetween(a: string, b: string): string[] {
	const out: string[] = [];
	for (let m = a; m <= b && out.length < 600; m = shiftMonth(m, 1)) out.push(m);
	return out;
}

/** Last day of a month as "YYYY-MM-DD". */
export function monthEnd(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Pakistan financial year (July–June) that contains `month`; returns its first month. */
export function fyStart(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return `${m >= 7 ? y : y - 1}-07`;
}

export function dateLabel(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

/** The month picked in the top bar (?m=YYYY-MM), else the current month. */
export function monthFromUrl(url: URL): string {
	const m = url.searchParams.get('m');
	return isMonth(m) ? m : currentMonth();
}
