/**
 * Duplicate-safe merge of courier data into `shipments`. See SPEC.md §4 "Import pipeline".
 *
 * Key: (courier, tracking_no). For each incoming row:
 *   new        → insert
 *   unchanged  → nothing
 *   updated    → patch + audit row in shipment_changes
 *   conflict   → nothing applied, conflict_note set, shown for review
 *
 * Precedence:
 *   - real fees/taxes (from statements) beat estimates (from API)
 *   - a final status (delivered/returned) is never downgraded to in-transit by an older source
 *   - delivered ↔ returned flip, or a parcel moving to a different statement = conflict
 *   - manual order links are never overwritten
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Courier, NormalizedShipment, ParsedStatement } from './types.js';

type Row = typeof schema.shipments.$inferSelect;
type Insert = typeof schema.shipments.$inferInsert;

const FEE_FIELDS = ['fee', 'feeTax', 'returnFee', 'returnFeeTax', 'otherFees'] as const;
const TAX_FIELDS = ['itwh', 'stwh'] as const;
const PLAIN_FIELDS = [
	'originalTrackingNo',
	'orderRefRaw',
	'courierStatus',
	'bookedAt',
	'pickupAt',
	'finalAt',
	'weightKg',
	'province',
	'city',
	'cod',
	'settledAt'
] as const;
const FINAL = new Set(['delivered', 'returned']);

export type RowOutcome = {
	trackingNo: string;
	kind: 'new' | 'updated' | 'unchanged' | 'conflict';
	diff?: Record<string, [unknown, unknown]>;
	conflict?: string;
	incoming: NormalizedShipment;
	existingId?: string;
};

export type MergePlan = {
	courier: Courier;
	outcomes: RowOutcome[];
	counts: { new: number; updated: number; unchanged: number; conflict: number };
	statements: ParsedStatement[];
};

function netPayable(
	r: Pick<Row, 'status' | 'cod' | (typeof FEE_FIELDS)[number] | (typeof TAX_FIELDS)[number]>
) {
	const codIn = r.status === 'delivered' ? r.cod : 0;
	return codIn - r.fee - r.feeTax - r.returnFee - r.returnFeeTax - r.otherFees - r.itwh - r.stwh;
}

async function loadExisting(courier: Courier, trackingNos: string[]) {
	const map = new Map<string, Row>();
	for (let i = 0; i < trackingNos.length; i += 400) {
		const chunk = trackingNos.slice(i, i + 400);
		const rows = await db
			.select()
			.from(schema.shipments)
			.where(
				and(eq(schema.shipments.courier, courier), inArray(schema.shipments.trackingNo, chunk))
			);
		for (const r of rows) map.set(r.trackingNo, r);
	}
	const stmtIds = [
		...new Set([...map.values()].map((r) => r.statementId).filter(Boolean))
	] as string[];
	const stmtNumber = new Map<string, string>();
	for (let i = 0; i < stmtIds.length; i += 400) {
		const rows = await db
			.select({ id: schema.statements.id, number: schema.statements.number })
			.from(schema.statements)
			.where(inArray(schema.statements.id, stmtIds.slice(i, i + 400)));
		for (const r of rows) stmtNumber.set(r.id, r.number);
	}
	return { map, stmtNumber };
}

/** Compute what applying `incoming` on top of `existing` would change. Pure. */
export function mergeOne(
	existing: Row | undefined,
	existingStatementNumber: string | null,
	inc: NormalizedShipment
): Omit<RowOutcome, 'incoming'> & { patch?: Partial<Row> } {
	if (!existing) return { trackingNo: inc.trackingNo, kind: 'new' };

	const patch: Partial<Row> = {};
	const diff: Record<string, [unknown, unknown]> = {};
	const set = <K extends keyof Row>(k: K, v: Row[K]) => {
		if (v === undefined || existing[k] === v) return;
		patch[k] = v;
		diff[k as string] = [existing[k], v];
	};

	// Status
	if (existing.status !== inc.status) {
		const exFinal = FINAL.has(existing.status);
		const inFinal = FINAL.has(inc.status);
		if (exFinal && inFinal)
			return {
				trackingNo: inc.trackingNo,
				kind: 'conflict',
				conflict: `Status: was ${existing.status}, source says ${inc.status}`,
				existingId: existing.id
			};
		if (!(exFinal && !inFinal)) set('status', inc.status);
	}

	// Statement
	if (
		inc.statementNumber &&
		existingStatementNumber &&
		inc.statementNumber !== existingStatementNumber
	)
		return {
			trackingNo: inc.trackingNo,
			kind: 'conflict',
			conflict: `Already in statement ${existingStatementNumber}, this source says ${inc.statementNumber} (possible double charge)`,
			existingId: existing.id
		};
	if (inc.statementNumber && !existingStatementNumber) diff.statement = [null, inc.statementNumber]; // linked in applyMerge

	for (const k of PLAIN_FIELDS) {
		const v = inc[k];
		if (v === undefined || v === null) continue; // no info ≠ erase
		set(k, v as never);
	}

	// An estimate never replaces real figures. Existing values count as real only when they are
	// on a statement or non-zero — a 0 saved while the parcel was in transit is just "not known yet".
	const realFees =
		!existing.feesEstimated &&
		(!!existingStatementNumber || existing.fee + existing.feeTax + existing.returnFee > 0);
	const realTaxes =
		!existing.taxesEstimated && (!!existingStatementNumber || existing.itwh + existing.stwh > 0);
	if (!(inc.feesEstimated && realFees)) {
		for (const k of FEE_FIELDS) if (inc[k] !== undefined) set(k, inc[k]!);
		if (inc.feesEstimated !== undefined) set('feesEstimated', inc.feesEstimated);
	}
	if (!(inc.taxesEstimated && realTaxes)) {
		for (const k of TAX_FIELDS) if (inc[k] !== undefined) set(k, inc[k]!);
		if (inc.taxesEstimated !== undefined) set('taxesEstimated', inc.taxesEstimated);
	}

	// Order link (never override a manual decision)
	if (existing.matchStatus !== 'manual' && existing.matchStatus !== 'excluded') {
		if (inc.orderName) {
			set('orderName', inc.orderName);
			// Courier corrected the order number: drop the old link, linkShipmentsToOrders re-links.
			if (
				existing.orderName &&
				inc.orderName !== existing.orderName &&
				existing.orderId &&
				!inc.orderId
			) {
				set('orderId', null as never);
				set('matchStatus', 'unmatched');
			}
		}
		if (inc.extraParcel !== undefined) set('extraParcel', inc.extraParcel);
		if (inc.orderId) {
			set('orderId', inc.orderId);
			set('matchStatus', 'auto');
		}
	}

	const merged = { ...existing, ...patch };
	const np = netPayable(merged);
	if (np !== existing.netPayable) set('netPayable', np);

	return Object.keys(diff).length
		? { trackingNo: inc.trackingNo, kind: 'updated', diff, patch, existingId: existing.id }
		: { trackingNo: inc.trackingNo, kind: 'unchanged', existingId: existing.id };
}

/** Dry run: what would happen if these rows were applied. Writes nothing. */
export async function planMerge(
	courier: Courier,
	rows: NormalizedShipment[],
	statements: ParsedStatement[] = []
): Promise<MergePlan & { patches: Map<string, Partial<Row>> }> {
	const { map, stmtNumber } = await loadExisting(
		courier,
		rows.map((r) => r.trackingNo)
	);
	const outcomes: RowOutcome[] = [];
	const patches = new Map<string, Partial<Row>>();
	const counts = { new: 0, updated: 0, unchanged: 0, conflict: 0 };
	for (const inc of rows) {
		const ex = map.get(inc.trackingNo);
		const res = mergeOne(
			ex,
			ex?.statementId ? (stmtNumber.get(ex.statementId) ?? null) : null,
			inc
		);
		counts[res.kind]++;
		if (res.patch) patches.set(inc.trackingNo, res.patch);
		outcomes.push({
			trackingNo: res.trackingNo,
			kind: res.kind,
			diff: res.diff,
			conflict: res.conflict,
			existingId: res.existingId,
			incoming: inc
		});
	}
	return { courier, outcomes, counts, statements, patches };
}

/** Apply a plan. `source` goes into the audit log ("api", "file:<id>", "manual"). */
export async function applyMerge(
	plan: Awaited<ReturnType<typeof planMerge>>,
	source: string
): Promise<MergePlan['counts']> {
	const now = new Date().toISOString();

	// 1. Statements
	for (const s of plan.statements) {
		await db
			.insert(schema.statements)
			.values({
				courier: s.courier,
				number: s.number,
				periodStart: s.periodStart ?? null,
				periodEnd: s.periodEnd ?? null,
				statementDate: s.statementDate ?? null
			})
			.onConflictDoUpdate({
				target: [schema.statements.courier, schema.statements.number],
				set: {
					periodStart: sql`coalesce(${schema.statements.periodStart}, excluded.period_start)`,
					periodEnd: sql`coalesce(${schema.statements.periodEnd}, excluded.period_end)`,
					statementDate: sql`coalesce(${schema.statements.statementDate}, excluded.statement_date)`
				}
			});
	}
	const numbers = [
		...new Set(plan.outcomes.map((o) => o.incoming.statementNumber).filter(Boolean))
	] as string[];
	const stmtId = new Map<string, string>();
	for (let i = 0; i < numbers.length; i += 400) {
		const rows = await db
			.select({ id: schema.statements.id, number: schema.statements.number })
			.from(schema.statements)
			.where(
				and(
					eq(schema.statements.courier, plan.courier),
					inArray(schema.statements.number, numbers.slice(i, i + 400))
				)
			);
		for (const r of rows) stmtId.set(r.number, r.id);
	}

	const statements: Parameters<typeof db.batch>[0][number][] = [];
	const touchedStatements = new Set<string>();

	for (const o of plan.outcomes) {
		const inc = o.incoming;
		const sid = inc.statementNumber ? (stmtId.get(inc.statementNumber) ?? null) : null;
		if (sid) touchedStatements.add(sid);

		if (o.kind === 'new') {
			const row: Insert = {
				courier: inc.courier,
				trackingNo: inc.trackingNo,
				originalTrackingNo: inc.originalTrackingNo ?? null,
				orderRefRaw: inc.orderRefRaw ?? null,
				orderName: inc.orderName ?? null,
				extraParcel: inc.extraParcel ?? false,
				orderId: inc.orderId ?? null,
				matchStatus: inc.orderId ? 'auto' : 'unmatched',
				status: inc.status,
				courierStatus: inc.courierStatus ?? null,
				bookedAt: inc.bookedAt ?? null,
				pickupAt: inc.pickupAt ?? null,
				finalAt: inc.finalAt ?? null,
				weightKg: inc.weightKg ?? null,
				province: inc.province ?? null,
				city: inc.city ?? null,
				cod: inc.cod ?? 0,
				fee: inc.fee ?? 0,
				feeTax: inc.feeTax ?? 0,
				returnFee: inc.returnFee ?? 0,
				returnFeeTax: inc.returnFeeTax ?? 0,
				otherFees: inc.otherFees ?? 0,
				itwh: inc.itwh ?? 0,
				stwh: inc.stwh ?? 0,
				netPayable: 0,
				feesEstimated: inc.feesEstimated ?? false,
				taxesEstimated: inc.taxesEstimated ?? false,
				statementId: sid,
				settledAt: inc.settledAt ?? null,
				raw: inc.raw ? JSON.stringify(inc.raw) : null,
				updatedAt: now
			};
			row.netPayable = netPayable(row as Row);
			statements.push(db.insert(schema.shipments).values(row));
		} else if (o.kind === 'updated') {
			const patch = { ...plan.patches.get(inc.trackingNo)! };
			if (sid) patch.statementId = sid;
			if (inc.raw) patch.raw = JSON.stringify(inc.raw);
			statements.push(
				db
					.update(schema.shipments)
					.set({ ...patch, conflictNote: null, updatedAt: now })
					.where(eq(schema.shipments.id, o.existingId!))
			);
			statements.push(
				db
					.insert(schema.shipmentChanges)
					.values({ shipmentId: o.existingId!, source, diff: JSON.stringify(o.diff) })
			);
		} else if (o.kind === 'conflict') {
			statements.push(
				db
					.update(schema.shipments)
					.set({ conflictNote: `${o.conflict} [${source}]`, updatedAt: now })
					.where(eq(schema.shipments.id, o.existingId!))
			);
		}
	}

	for (let i = 0; i < statements.length; i += 100) {
		const chunk = statements.slice(i, i + 100);
		if (chunk.length) await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
	}

	// Refresh statement totals.
	const ids = [...touchedStatements];
	for (let i = 0; i < ids.length; i += 400) {
		await db.run(sql`
			update statements set
				total_cod_paisa = coalesce((select sum(case when status = 'delivered' then cod_paisa else 0 end) from shipments where statement_id = statements.id), 0),
				total_payable_paisa = coalesce((select sum(net_payable_paisa) from shipments where statement_id = statements.id), 0)
			where id in (${sql.join(
				ids.slice(i, i + 400).map((id) => sql`${id}`),
				sql`, `
			)})`);
	}

	return plan.counts;
}
