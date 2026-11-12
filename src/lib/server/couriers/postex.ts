/** PostEx: API order → normalized parcel, and the portal CSV export parser. */
import type { Grid } from './sheets.js';
import type { NormalizedShipment, ParsedFile, ParsedStatement, ShipmentStatus } from './types.js';
import { absPaisa, headerKey, normalizeOrderRef, paisa, parsePkTime, twoPercent } from './util.js';

export function mapPostexStatus(s: string | null | undefined): ShipmentStatus {
	const v = (s ?? '').trim().toLowerCase();
	if (v === 'delivered') return 'delivered';
	if (v.startsWith('return')) return 'returned';
	if (v === 'cancelled' || v === 'canceled') return 'cancelled';
	if (v === 'unbooked' || v === 'booked' || v === '') return 'booked';
	return 'in_transit';
}

/** Taxes are not in the API; PostEx withholds 2% + 2% of COD on delivered parcels. */
function estimatedTaxes(status: ShipmentStatus, cod: number) {
	if (status !== 'delivered' || cod <= 100) return { itwh: 0, stwh: 0 };
	return { itwh: twoPercent(cod), stwh: twoPercent(cod) };
}

export type PostexApiOrder = {
	trackingNumber: string;
	orderRefNumber?: string;
	invoicePayment?: number;
	transactionStatus?: string;
	transactionDate?: string;
	orderPickupDate?: string;
	orderDeliveryDate?: string;
	transactionFee?: number;
	transactionTax?: number;
	reversalFee?: number;
	reversalTax?: number;
	actualWeight?: number;
	bookingWeight?: number;
	cityName?: string;
	reservePaymentDate?: string;
	upfrontPaymentDate?: string;
};

export function normalizePostexApi(o: PostexApiOrder): NormalizedShipment {
	const status = mapPostexStatus(o.transactionStatus);
	const ref = normalizeOrderRef(o.orderRefNumber);
	const cod = paisa(o.invoicePayment ?? 0);
	const taxes = estimatedTaxes(status, cod);
	const fee = absPaisa(o.transactionFee ?? 0);
	const feeTax = absPaisa(o.transactionTax ?? 0);
	const returnFee = absPaisa(o.reversalFee ?? 0);
	const returnFeeTax = absPaisa(o.reversalTax ?? 0);
	const final = status === 'delivered' || status === 'returned';
	// No delivery date from PostEx → payment date, else pickup/booking date, so the parcel
	// still lands in a month (better roughly dated than missing from every report).
	const finalAt = final
		? (parsePkTime(o.orderDeliveryDate) ??
			parsePkTime(o.reservePaymentDate ?? o.upfrontPaymentDate) ??
			parsePkTime(o.orderPickupDate) ??
			parsePkTime(o.transactionDate))
		: null;
	const codIn = status === 'delivered' ? cod : 0;
	return {
		courier: 'postex',
		trackingNo: String(o.trackingNumber),
		orderRefRaw: o.orderRefNumber ?? null,
		orderName: ref?.orderName ?? null,
		extraParcel: ref?.extraParcel ?? false,
		status,
		courierStatus: o.transactionStatus ?? null,
		bookedAt: parsePkTime(o.transactionDate),
		pickupAt: parsePkTime(o.orderPickupDate),
		finalAt,
		weightKg:
			o.actualWeight != null
				? String(o.actualWeight)
				: o.bookingWeight != null
					? String(o.bookingWeight)
					: null,
		city: o.cityName ?? null,
		cod,
		fee,
		feeTax,
		returnFee,
		returnFeeTax,
		otherFees: 0,
		...taxes,
		netPayable: codIn - fee - feeTax - returnFee - returnFeeTax - taxes.itwh - taxes.stwh,
		feesEstimated: false,
		taxesEstimated: taxes.itwh > 0
	};
}

// ─── CSV export from the PostEx portal ─────────────────────────────────────────

const CSV_COLS = {
	ref: 'orderrefnumber',
	tracking: 'trackingnumber',
	cod: 'codamount',
	status: 'transactionstatus',
	upfrontCpr: 'upfrontcprnumber',
	upfrontDate: 'upfrontcprdate',
	reserveCpr: 'reservecprnumber',
	reserveDate: 'reservecprdate',
	pickup: 'orderpickupdate',
	delivery: 'orderdeliverydate',
	fee: 'fee',
	gst: 'gst',
	itwh: 'itwh2',
	stwh: 'stwh2'
} as const;

export function looksLikePostexCsv(grid: Grid): boolean {
	const keys = (grid[0] ?? []).map(headerKey);
	return keys.includes('trackingnumber') && keys.includes('reservecprnumber');
}

export function parsePostexCsv(grid: Grid): ParsedFile {
	const errors: string[] = [];
	const warnings: string[] = [];
	const keys = (grid[0] ?? []).map(headerKey);
	const idx = Object.fromEntries(
		Object.entries(CSV_COLS).map(([k, h]) => [k, keys.indexOf(h)])
	) as Record<keyof typeof CSV_COLS, number>;
	for (const k of ['ref', 'tracking', 'cod', 'status', 'fee'] as const)
		if (idx[k] < 0) errors.push(`Missing column: ${CSV_COLS[k]}`);

	const get = (r: string[], k: keyof typeof CSV_COLS) =>
		idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '';
	const rows: NormalizedShipment[] = [];
	const statements = new Map<string, ParsedStatement>();
	const seen = new Set<string>();

	for (const r of grid.slice(1)) {
		const tracking = get(r, 'tracking');
		if (!tracking) continue;
		try {
			const status = mapPostexStatus(get(r, 'status'));
			const ref = normalizeOrderRef(get(r, 'ref'));
			const cod = paisa(get(r, 'cod'));
			const fee = absPaisa(get(r, 'fee'));
			const gst = absPaisa(get(r, 'gst'));
			const itwh = absPaisa(get(r, 'itwh'));
			const stwh = absPaisa(get(r, 'stwh'));
			const cpr = get(r, 'reserveCpr') || get(r, 'upfrontCpr');
			const cprDate = parsePkTime(get(r, 'reserveDate') || get(r, 'upfrontDate'));
			if (cpr && !statements.has(cpr))
				statements.set(cpr, { courier: 'postex', number: cpr, statementDate: cprDate });

			const returned = status === 'returned';
			const codIn = status === 'delivered' ? cod : 0;
			rows.push({
				courier: 'postex',
				trackingNo: tracking,
				orderRefRaw: get(r, 'ref') || null,
				orderName: ref?.orderName ?? null,
				extraParcel: ref?.extraParcel ?? false,
				status,
				courierStatus: get(r, 'status'),
				pickupAt: parsePkTime(get(r, 'pickup')),
				finalAt: parsePkTime(get(r, 'delivery')) ?? (returned ? cprDate : null),
				cod,
				// On returns PostEx's single FEE column is the reversal charge.
				fee: returned ? 0 : fee,
				feeTax: returned ? 0 : gst,
				returnFee: returned ? fee : 0,
				returnFeeTax: returned ? gst : 0,
				otherFees: 0,
				itwh,
				stwh,
				netPayable: codIn - fee - gst - itwh - stwh,
				feesEstimated: false,
				taxesEstimated: false,
				statementNumber: cpr || null,
				settledAt: cprDate,
				raw: Object.fromEntries((grid[0] ?? []).map((h, i) => [h, r[i] ?? '']))
			});
			if (seen.has(tracking)) errors.push(`Tracking ${tracking} appears twice in this file`);
			seen.add(tracking);
		} catch (e) {
			errors.push(`${tracking}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return {
		courier: 'postex',
		kind: 'postex_csv',
		rows,
		statements: [...statements.values()],
		errors,
		warnings
	};
}
