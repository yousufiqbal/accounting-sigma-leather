/** Pull parcels from the PostEx API and merge them. Also links settled parcels to their CPR. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { linkShipmentsToOrders } from '../shopify-sync.js';
import { settleDeliveries } from '../assumptions.js';
import { db, schema } from '../db/index.js';
import { postexGet } from '../postex.js';
import { applyMerge, planMerge } from './merge.js';
import { normalizePostexApi, type PostexApiOrder } from './postex.js';
import { parsePkTime } from './util.js';

const HISTORY_START = '2025-11-01';
const DAY = 86_400_000;
const ymd = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);

export type PostexSyncResult = {
	fetched: number;
	new: number;
	updated: number;
	unchanged: number;
	conflict: number;
	cprLinked: number;
	cprPending: number;
};

/** `mode: 'recent'` = last 60 days (nightly). `'full'` = everything since the first booking. */
export async function syncPostex(mode: 'recent' | 'full' = 'recent'): Promise<PostexSyncResult> {
	const [run] = await db
		.insert(schema.syncRuns)
		.values({ kind: `postex_${mode}` })
		.returning({ id: schema.syncRuns.id });
	try {
		const end = new Date();
		const start = mode === 'full' ? new Date(HISTORY_START) : new Date(end.getTime() - 60 * DAY);

		// Fetch in ≤90-day windows to keep responses small.
		const orders: PostexApiOrder[] = [];
		for (let from = start; from < end; from = new Date(from.getTime() + 90 * DAY)) {
			const to = new Date(Math.min(from.getTime() + 90 * DAY - DAY, end.getTime()));
			const chunk = await postexGet<PostexApiOrder[]>(
				`v1/get-all-order?orderStatusId=0&startDate=${ymd(from)}&endDate=${ymd(to)}`
			);
			orders.push(...(chunk ?? []));
		}
		const byTracking = new Map(orders.map((o) => [String(o.trackingNumber), o]));
		const rows = [...byTracking.values()].map(normalizePostexApi);

		const plan = await planMerge('postex', rows);
		const counts = await applyMerge(plan, 'api');
		const cpr = await linkPostexCprs();
		await linkShipmentsToOrders();
		await settleDeliveries();

		const result = { fetched: rows.length, ...counts, ...cpr };
		await db
			.update(schema.syncRuns)
			.set({ finishedAt: new Date().toISOString(), ok: true, summary: JSON.stringify(result) })
			.where(eq(schema.syncRuns.id, run.id));
		return result;
	} catch (e) {
		await db
			.update(schema.syncRuns)
			.set({
				finishedAt: new Date().toISOString(),
				ok: false,
				summary: JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
			})
			.where(eq(schema.syncRuns.id, run.id));
		throw e;
	}
}

type PaymentStatus = {
	trackingNumber: string;
	settle?: boolean;
	settlementDate?: string;
	cpr1?: string;
	cpr1Date?: string;
};

/**
 * For delivered/returned PostEx parcels without a statement, ask PostEx which CPR paid them.
 * Bounded per run so a cron call stays short; the rest is picked up next run.
 */
export async function linkPostexCprs(
	limit = 150
): Promise<{ cprLinked: number; cprPending: number }> {
	const pendingWhere = and(
		eq(schema.shipments.courier, 'postex'),
		inArray(schema.shipments.status, ['delivered', 'returned']),
		isNull(schema.shipments.statementId)
	);
	const pending = await db
		.select({ id: schema.shipments.id, trackingNo: schema.shipments.trackingNo })
		.from(schema.shipments)
		.where(pendingWhere)
		// Never-checked first, then the longest-unchecked — parcels that never settle can't starve newer ones.
		.orderBy(sql`${schema.shipments.cprCheckedAt} is not null`, schema.shipments.cprCheckedAt)
		.limit(limit);

	let linked = 0;
	const touched = new Set<string>();
	const queue = [...pending];
	const worker = async () => {
		for (let p = queue.shift(); p; p = queue.shift()) {
			let ps: PaymentStatus;
			try {
				ps = await postexGet<PaymentStatus>(`v1/payment-status/${p.trackingNo}`);
			} catch {
				continue;
			}
			await db
				.update(schema.shipments)
				.set({ cprCheckedAt: new Date().toISOString() })
				.where(eq(schema.shipments.id, p.id));
			if (!ps?.settle || !ps.cpr1) continue;
			const date = parsePkTime(ps.cpr1Date ?? ps.settlementDate);
			const [stmt] = await db
				.insert(schema.statements)
				.values({ courier: 'postex', number: ps.cpr1, statementDate: date })
				.onConflictDoUpdate({
					target: [schema.statements.courier, schema.statements.number],
					set: {
						statementDate: sql`coalesce(${schema.statements.statementDate}, excluded.statement_date)`
					}
				})
				.returning({ id: schema.statements.id });
			await db
				.update(schema.shipments)
				.set({ statementId: stmt.id, settledAt: date, updatedAt: new Date().toISOString() })
				.where(eq(schema.shipments.id, p.id));
			touched.add(stmt.id);
			linked++;
		}
	};
	await Promise.all(Array.from({ length: 5 }, worker));

	for (const id of touched) {
		await db.run(sql`
			update statements set
				total_cod_paisa = coalesce((select sum(case when status = 'delivered' then cod_paisa else 0 end) from shipments where statement_id = ${id}), 0),
				total_payable_paisa = coalesce((select sum(net_payable_paisa) from shipments where statement_id = ${id}), 0)
			where id = ${id}`);
	}

	const [{ n }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(schema.shipments)
		.where(pendingWhere);
	return { cprLinked: linked, cprPending: n };
}
