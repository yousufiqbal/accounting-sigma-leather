/**
 * Orders fulfilled in Shopify that have no PostEx/DEX parcel. Rule agreed with the owner:
 *   - fulfilled WITHOUT a tracking number (pickup, TCS without tracking, own rider)
 *       → delivered right away, on the fulfilment date
 *   - fulfilled WITH a tracking number → wait for courier data; still nothing after
 *       SETTLE_DAYS → assumed delivered on the fulfilment date
 * Labels: prepaid → "prepaid (TCS/other)", COD before LEOPARDS_UNTIL → "Leopards",
 *   otherwise "pickup / TCS (no tracking)". Known self-pickups get no fee.
 * Courier fee unknown → median PostEx delivery fee (incl. tax), flagged as estimated.
 * One assumed parcel per order (tracking "A-<order>"). When real courier data later links
 * to the order, the assumed parcel is retired (status cancelled) so nothing counts twice.
 */
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';

export const LEOPARDS_UNTIL = '2026-02-15T00:00:00+05:00';
export const SETTLE_DAYS = 14; // tracked parcels: give courier data this long to arrive
/** Collected by the customer at the shop: no courier, no fee. */
export const PICKUP_ORDERS = ['2152'];

const o = schema.orders;
const s = schema.shipments;
const PAID = ['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const shippedNoParcel = () =>
	and(
		isNull(o.cancelledAt),
		eq(o.test, false),
		or(eq(o.fulfillmentStatus, 'FULFILLED'), eq(o.fulfillmentStatus, 'PARTIALLY_FULFILLED')),
		sql`not exists (select 1 from shipments x where x.order_id = orders.id and x.status != 'cancelled')`
	);

function candidatesWhere() {
	const cutoff = new Date(Date.now() - SETTLE_DAYS * 86_400_000).toISOString();
	return and(shippedNoParcel(), or(isNull(o.fulfillmentTracking), lte(o.fulfilledAt, cutoff)));
}

type Kind = 'prepaid' | 'leopards' | 'direct';
function classify(r: { financialStatus: string | null; isPrepaid: boolean; createdAt: string }): Kind {
	if (r.isPrepaid || PAID.includes(r.financialStatus ?? '')) return 'prepaid';
	if (new Date(r.createdAt) < new Date(LEOPARDS_UNTIL)) return 'leopards';
	return 'direct';
}

/** Usual delivery cost per parcel (fee + tax), from real PostEx data. */
async function estimatedFee() {
	const fees = await db
		.select({ v: sql<number>`${s.fee} + ${s.feeTax}` })
		.from(s)
		.where(and(eq(s.courier, 'postex'), eq(s.status, 'delivered'), gte(s.fee, 1)));
	const v = fees.map((f) => f.v).sort((a, b) => a - b);
	return v.length ? v[Math.floor(v.length / 2)] : 0;
}

/** Retire assumed parcels for orders that now have real courier data. */
async function retireAssumed() {
	const r = await db.run(sql`
		update shipments set status = 'cancelled',
			courier_status = coalesce(courier_status, '') || ' — replaced by courier data',
			updated_at = ${new Date().toISOString()}
		where courier = 'manual' and tracking_no like 'A-%' and status != 'cancelled'
			and exists (select 1 from shipments c where c.order_id = shipments.order_id
				and c.courier != 'manual' and c.status != 'cancelled')`);
	return r.rowsAffected;
}

async function createAssumed() {
	const rows = await db
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
	if (!rows.length) return 0;
	const fee = await estimatedFee();
	const now = new Date().toISOString();
	const stmts = [];
	for (const r of rows) {
		if (!r.fulfilledAt) continue;
		const kind = classify(r);
		// Prepaid: only the unpaid remainder (if any) is collected on delivery.
		const cash = kind === 'prepaid' ? Math.max(0, r.outstanding) : r.outstanding || r.total;
		const pickup = PICKUP_ORDERS.includes(r.name);
		const parcelFee = pickup ? 0 : fee;
		const label = pickup
			? 'Self pickup at shop'
			: kind === 'prepaid'
				? 'Assumed: prepaid (TCS/other)'
				: kind === 'leopards'
					? 'Assumed: Leopards'
					: 'Assumed: pickup / TCS (no tracking)';
		const values = {
			status: 'delivered' as const,
			courierStatus: label,
			finalAt: r.fulfilledAt,
			cod: cash,
			fee: parcelFee,
			netPayable: cash - parcelFee,
			feesEstimated: !pickup,
			settledAt: r.fulfilledAt,
			updatedAt: now
		};
		stmts.push(
			db
				.insert(s)
				.values({
					courier: 'manual',
					trackingNo: `A-${r.name}`,
					orderRefRaw: r.name,
					orderName: r.name,
					orderId: r.id,
					matchStatus: 'auto',
					raw: JSON.stringify({ assumed: kind }),
					...values
				})
				// A retired assumption comes back if the real parcel was later cancelled.
				.onConflictDoUpdate({
					target: [s.courier, s.trackingNo],
					set: values,
					where: eq(s.status, 'cancelled')
				})
		);
	}
	for (let i = 0; i < stmts.length; i += 100) {
		const chunk = stmts.slice(i, i + 100);
		await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
	}
	return stmts.length;
}

/** Run after every orders/courier sync or import (orders must already be linked). */
export async function settleDeliveries() {
	const retired = await retireAssumed();
	const created = await createAssumed();
	return { retired, created };
}
