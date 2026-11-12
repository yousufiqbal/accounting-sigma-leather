/**
 * DEX statement (.xlsx) → normalized parcels.
 * Columns are matched by name (aliases allowed), never by position — DEX renames/adds columns
 * between exports. A non-empty column we don't know blocks the import.
 */
import type { Grid } from './sheets.js';
import type { NormalizedShipment, ParsedFile, ParsedStatement } from './types.js';
import { absPaisa, headerKey, paisa, parsePkTime } from './util.js';

type Field =
	| 'statement'
	| 'period'
	| 'tracking'
	| 'originalTracking'
	| 'externalOrder'
	| 'created'
	| 'finalDate'
	| 'province'
	| 'billingWeight'
	| 'finalStatus'
	| 'cod'
	| 'shippingFee'
	| 'shippingVat'
	| 'returnShippingFee'
	| 'failedDeliveryFee'
	| 'incomeTax'
	| 'salesTax'
	| 'payable'
	| 'otherFee' // any extra charge column (cod fee, insurance, VAS, fuel, rebate…)
	| 'ignore';

const ALIASES: Record<string, Field> = {
	statementnumber: 'statement',
	statementperiod: 'period',
	trackingno: 'tracking',
	trackingnumber: 'tracking',
	originaltrackingnumber: 'originalTracking',
	externalorderno: 'externalOrder',
	ordercreationdate: 'created',
	finalstatusdate: 'finalDate',
	buyerprovince: 'province',
	billingweight: 'billingWeight',
	finalstatus: 'finalStatus',
	codamount: 'cod',
	shippingfee: 'shippingFee',
	shippingfeevat: 'shippingVat',
	returnshippingfee: 'returnShippingFee',
	faileddeliveryfee: 'failedDeliveryFee',
	incometax: 'incomeTax',
	salestax: 'salesTax',
	payableamount: 'payable',
	// extra charges (sign as given: negative = charge, positive = rebate)
	codsurchargefee: 'otherFee',
	codfee: 'otherFee',
	paidshippingfee: 'otherFee',
	insurancefee: 'otherFee',
	rebatefee: 'otherFee',
	vasothers: 'otherFee',
	fuelsurcharge3pv: 'otherFee',
	// informational
	warehousename: 'ignore',
	ordertype: 'ignore',
	orderno: 'ignore',
	buyername: 'ignore',
	buyerphone: 'ignore',
	deadweight: 'ignore',
	paymentmethod: 'ignore',
	note: 'ignore'
};

const REQUIRED: Field[] = ['statement', 'tracking', 'finalStatus', 'cod', 'payable'];

export function looksLikeDex(grid: Grid): boolean {
	const keys = (grid[0] ?? []).map(headerKey);
	return keys.includes('statementnumber') && keys.includes('externalorderno');
}

export function parseDex(grid: Grid): ParsedFile {
	const errors: string[] = [];
	const warnings: string[] = [];
	const header = grid[0] ?? [];
	const colsByField = new Map<Field, number[]>();
	const unknown: { name: string; col: number }[] = [];

	header.forEach((h, col) => {
		const key = headerKey(h);
		if (!key) return;
		const field = ALIASES[key];
		if (!field) unknown.push({ name: String(h).trim(), col });
		else colsByField.set(field, [...(colsByField.get(field) ?? []), col]);
	});
	for (const f of REQUIRED) if (!colsByField.has(f)) errors.push(`Missing column: ${f}`);

	const one = (row: string[], f: Field) => {
		const c = colsByField.get(f)?.[0];
		return c === undefined ? '' : (row[c] ?? '').trim();
	};

	const trackingCol = colsByField.get('tracking')?.[0] ?? -1;
	const dataRows: string[][] = [];
	let totalsRow: string[] | null = null;
	for (let i = 1; i < grid.length; i++) {
		const row = grid[i];
		if (
			String(row[0] ?? '')
				.trim()
				.toLowerCase() === 'total'
		) {
			// DEX puts labels on this row and the sums on the next one.
			totalsRow = grid[i + 1] ?? null;
			break;
		}
		if ((row[trackingCol] ?? '').trim()) dataRows.push(row);
	}

	// Unknown columns: fine if empty, blocking if they carry numbers.
	for (const u of unknown) {
		const used = dataRows.some((r) => {
			const v = (r[u.col] ?? '').trim();
			return v !== '' && Number(v) !== 0;
		});
		if (used)
			errors.push(`Unknown column "${u.name}" has values — tell the developer how to treat it.`);
		else warnings.push(`Ignored empty column "${u.name}".`);
	}

	const rows: NormalizedShipment[] = [];
	const statements = new Map<string, ParsedStatement>();
	let sumCod = 0;
	let sumPayable = 0;

	for (const r of dataRows) {
		const tracking = one(r, 'tracking');
		try {
			const statementNumber = one(r, 'statement');
			const period = one(r, 'period');
			const [pStart, pEnd] = period.split(/\s+-\s+/);
			if (statementNumber && !statements.has(statementNumber)) {
				statements.set(statementNumber, {
					courier: 'dex',
					number: statementNumber,
					periodStart: pStart ? parsePkTime(pStart) : null,
					periodEnd: pEnd ? parsePkTime(pEnd) : null,
					statementDate: pEnd ? parsePkTime(pEnd) : null
				});
			}

			const finalStatus = one(r, 'finalStatus');
			const isDelivered = /^delivered$/i.test(finalStatus);
			const isReturned = /return/i.test(finalStatus);
			if (!isDelivered && !isReturned) {
				errors.push(`${tracking}: unknown final status "${finalStatus}" — not imported (tell the developer how to treat it)`);
				continue;
			}

			const cod = paisa(one(r, 'cod'));
			const shippingFee = absPaisa(one(r, 'shippingFee'));
			const vat = absPaisa(one(r, 'shippingVat'));
			const returnFee =
				absPaisa(one(r, 'returnShippingFee')) + absPaisa(one(r, 'failedDeliveryFee'));
			const other = -(colsByField.get('otherFee') ?? []).reduce((s, c) => s + paisa(r[c]), 0);
			const itwh = absPaisa(one(r, 'incomeTax'));
			const stwh = absPaisa(one(r, 'salesTax'));
			const payable = paisa(one(r, 'payable'));

			// VAT belongs to whichever fee was charged.
			const feeTax = returnFee && !shippingFee ? 0 : vat;
			const returnFeeTax = returnFee && !shippingFee ? vat : 0;

			const computed = cod - shippingFee - returnFee - vat - other - itwh - stwh;
			if (Math.abs(computed - payable) > 2)
				errors.push(
					`${tracking}: amounts don't add up (computed ${computed / 100}, file says ${payable / 100})`
				);

			const ext = one(r, 'externalOrder');
			// "2409_8385904935104_140": first part is the Shopify order number. The middle number
			// is NOT the Shopify order id, so linking happens by order number.
			const [orderName] = ext.split('_');
			const weight =
				one(r, 'billingWeight')
					.split(/\s*-\s*/)
					.pop() ?? '';

			rows.push({
				courier: 'dex',
				trackingNo: tracking,
				originalTrackingNo: one(r, 'originalTracking') || null,
				orderRefRaw: ext || null,
				orderName: /^\d+$/.test(orderName ?? '') ? orderName : null,
				extraParcel: false,
				status: isReturned ? 'returned' : 'delivered',
				courierStatus: finalStatus,
				bookedAt: parsePkTime(one(r, 'created')),
				finalAt: parsePkTime(one(r, 'finalDate')),
				weightKg: weight || null,
				province: one(r, 'province') || null,
				cod,
				fee: shippingFee,
				feeTax,
				returnFee,
				returnFeeTax,
				otherFees: other,
				itwh,
				stwh,
				netPayable: payable,
				feesEstimated: false,
				taxesEstimated: false,
				statementNumber: statementNumber || null,
				raw: Object.fromEntries(header.map((h, i) => [String(h).trim(), r[i] ?? '']))
			});
			sumCod += cod;
			sumPayable += payable;
		} catch (e) {
			errors.push(`${tracking}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// Cross-check with DEX's own Total row.
	if (totalsRow) {
		const codCol = colsByField.get('cod')![0];
		const payCol = colsByField.get('payable')![0];
		const fileCod = paisa(totalsRow[codCol]);
		const filePay = paisa(totalsRow[payCol]);
		if (Math.abs(fileCod - sumCod) > 100)
			errors.push(`COD total mismatch: rows ${sumCod / 100}, file total ${fileCod / 100}`);
		if (Math.abs(filePay - sumPayable) > 100)
			errors.push(`Payable total mismatch: rows ${sumPayable / 100}, file total ${filePay / 100}`);
	} else warnings.push('No Total row found — totals not cross-checked.');

	const seen = new Set<string>();
	for (const r of rows) {
		if (seen.has(r.trackingNo)) errors.push(`Tracking ${r.trackingNo} appears twice in this file`);
		seen.add(r.trackingNo);
	}

	return {
		courier: 'dex',
		kind: 'dex_xlsx',
		rows,
		statements: [...statements.values()],
		errors,
		warnings
	};
}
