/**
 * Orders fulfilled in Shopify that have no PostEx/DEX parcel (TCS for prepaid, early Leopards…).
 * Rule agreed with the owner (2026-11-12):
 *   - paid / partly paid → assumed delivered on the fulfilment date (TCS / other)
 *   - COD before LEOPARDS_UNTIL → assumed delivered by Leopards on the fulfilment date
 *   - COD after that → left for manual review
 * Courier fee unknown → median PostEx delivery fee (incl. tax), flagged as estimated.
 * Idempotent: one assumed parcel per order (tracking "A-<order>").
 */
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';

export const LEOPARDS_UNTIL = '2026-02-15T00:00:00+05:00';
export const SETTLE_DAYS = 14; // give courier data this long to arrive before assuming

const o = schema.orders;
const PAID = ['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];

function candidatesWhere() {
	const cutoff = new Date(Date.now() - SETTLE_DAYS * 86_400_000).toISOString();
	return and(
		isNull(o.cancelledAt),
		eq(o.test, false),
		or(eq(o.fulfillmentStatus, 'FULFILLED'), eq(o.fulfillmentStatus, 'PARTIALLY_FULFILLED')),
		lte(o.fulfilledAt, cutoff),
		sql`not exists (select 1 from shipments s where s.order_id = ${o.id} and s.status != 'cancelled')`
	);
}

type Kind = 'prepaid' | 'leopards' | 'review';
function classify(r: {
	financialStatus: string | null;
	isPrepaid: boolean;
	createdAt: string;
}): Kind {
	if (r.isPrepaid || PAID.includes(r.financialStatus ?? '')) return 'prepaid';
	if (new Date(r.createdAt) < new Date(LEOPARDS_UNTIL)) return 'leopards';
	return 'review';
}

async function candidates() {
	return db
		.select({
			id: o.id,
			name: o.name,
			createdAt: o.createdAt,
			fulfilledAt: o.fulfilledAt,
			financialStatus: o.financialStatus,
			isPrepaid: o.isPrepaid,
			total: o.total,
			outstanding: o.outstanding
		})
		.from(o)
		.where(candidatesWhere());
}

export async function previewAssumptions() {
	const rows = await candidates();
	const counts = { prepaid: 0, leopards: 0, review: 0 };
	for (const r of rows) counts[classify(r)]++;
	return counts;
}

/** Usual delivery cost per parcel (fee + tax), from real PostEx data. */
async function estimatedFee() {
	const fees = await db
		.select({ v: sql<number>`${schema.shipments.fee} + ${schema.shipments.feeTax}` })
		.from(schema.shipments)
		.where(
			and(
				eq(schema.shipments.courier, 'postex'),
				eq(schema.shipments.status, 'delivered'),
				gte(schema.shipments.fee, 1)
			)
		);
	const v = fees.map((f) => f.v).sort((a, b) => a - b);
	return v.length ? v[Math.floor(v.length / 2)] : 0;
}

export async function applyAssumptions() {
	const rows = await candidates();
	const fee = await estimatedFee();
	const now = new Date().toISOString();
	const counts = { prepaid: 0, leopards: 0, review: 0 };
	const stmts = [];
	for (const r of rows) {
		const kind = classify(r);
		counts[kind]++;
		if (kind === 'review' || !r.fulfilledAt) continue;
		// Prepaid: only the unpaid remainder (if any) is collected on delivery.
		const cash = kind === 'prepaid' ? Math.max(0, r.outstanding) : r.outstanding || r.total;
		stmts.push(
			db
				.insert(schema.shipments)
				.values({
					courier: 'manual',
					trackingNo: `A-${r.name}`,
					orderRefRaw: r.name,
					orderName: r.name,
					orderId: r.id,
					matchStatus: 'auto',
					status: 'delivered',
					courierStatus: kind === 'prepaid' ? 'Assumed: prepaid (TCS/other)' : 'Assumed: Leopards',
					finalAt: r.fulfilledAt,
					cod: cash,
					fee,
					netPayable: cash - fee,
					feesEstimated: true,
					settledAt: r.fulfilledAt,
					raw: JSON.stringify({ assumed: kind }),
					updatedAt: now
				})
				.onConflictDoNothing()
		);
	}
	for (let i = 0; i < stmts.length; i += 100) {
		const chunk = stmts.slice(i, i + 100);
		await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
	}
	return counts;
}
