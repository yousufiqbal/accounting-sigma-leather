import { fail, redirect } from '@sveltejs/kit';
import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	notInArray,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { monthBoundsUtc } from '#lib/month.js';
import { postexConfigured } from '#lib/server/postex.js';
import { ImportError, stageUpload } from '#lib/server/couriers/import-file.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 50;
const VIEWS = ['month', 'transit', 'attention', 'all'] as const;
type View = (typeof VIEWS)[number];
const s = schema.shipments;

function median(values: number[]) {
	if (!values.length) return 0;
	const v = [...values].sort((a, b) => a - b);
	const m = Math.floor(v.length / 2);
	return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

/** Usual delivery fee per courier; anything above 3× is flagged. */
async function feeThresholds() {
	const rows = await db
		.select({ courier: s.courier, fee: s.fee })
		.from(s)
		.where(and(eq(s.status, 'delivered'), sql`${s.fee} > 0`))
		.orderBy(desc(s.finalAt))
		.limit(2000);
	const by = new Map<string, number[]>();
	for (const r of rows) by.set(r.courier, [...(by.get(r.courier) ?? []), r.fee]);
	return [...by].map(([courier, fees]) => ({
		courier,
		median: median(fees),
		limit: median(fees) * 3
	}));
}

function attentionWhere(thresholds: { courier: string; limit: number }[]): SQL {
	const outlier = thresholds.length
		? or(
				...thresholds.map((t) =>
					and(eq(s.courier, t.courier as 'postex'), sql`${s.fee} > ${t.limit}`)
				)
			)
		: undefined;
	return or(
		isNotNull(s.conflictNote),
		and(eq(s.matchStatus, 'unmatched'), sql`${s.status} != 'cancelled'`),
		outlier
	)!;
}

export const load: PageServerLoad = async ({ url, parent }) => {
	const { month } = await parent();
	const { start, end } = monthBoundsUtc(month);
	const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as View)
		: 'month';
	const courier = url.searchParams.get('courier');
	const q = url.searchParams.get('q')?.trim() ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const thresholds = await feeThresholds();
	const inMonth = and(gte(s.finalAt, start), lt(s.finalAt, end));

	// ── Month summary per courier (by final status date) ──
	const monthRows = await db
		.select({
			courier: s.courier,
			delivered: sql<number>`sum(case when ${s.status} = 'delivered' then 1 else 0 end)`,
			returned: sql<number>`sum(case when ${s.status} = 'returned' then 1 else 0 end)`,
			cod: sql<number>`sum(case when ${s.status} = 'delivered' then ${s.cod} else 0 end)`,
			deliveryFees: sql<number>`sum(case when ${s.status} = 'delivered' then ${s.fee} + ${s.feeTax} + ${s.otherFees} else 0 end)`,
			returnFees: sql<number>`sum(case when ${s.status} = 'returned' then ${s.fee} + ${s.feeTax} + ${s.returnFee} + ${s.returnFeeTax} + ${s.otherFees} else 0 end)`,
			taxes: sql<number>`sum(${s.itwh} + ${s.stwh})`,
			taxesEstimated: sql<number>`sum(case when ${s.taxesEstimated} then 1 else 0 end)`,
			net: sql<number>`sum(${s.netPayable})`
		})
		.from(s)
		.where(inMonth)
		.groupBy(s.courier);

	// ── All-time status per courier + unsettled ──
	const statusRows = await db
		.select({
			courier: s.courier,
			inTransit: sql<number>`sum(case when ${s.status} in ('booked','in_transit') then 1 else 0 end)`,
			unsettled: sql<number>`sum(case when ${s.status} in ('delivered','returned') and ${s.statementId} is null and ${s.settledAt} is null then ${s.netPayable} else 0 end)`,
			unsettledCount: sql<number>`sum(case when ${s.status} in ('delivered','returned') and ${s.statementId} is null and ${s.settledAt} is null then 1 else 0 end)`,
			total: sql<number>`count(*)`
		})
		.from(s)
		.groupBy(s.courier);

	const [attention] = await db
		.select({ n: sql<number>`count(*)` })
		.from(s)
		.where(attentionWhere(thresholds));

	// ── Parcel list ──
	const filters: SQL[] = [];
	if (view === 'month') filters.push(inMonth!);
	if (view === 'transit') filters.push(inArray(s.status, ['booked', 'in_transit']));
	if (view === 'attention') filters.push(attentionWhere(thresholds));
	if (courier === 'postex' || courier === 'dex') filters.push(eq(s.courier, courier));
	if (q)
		filters.push(
			or(
				like(s.trackingNo, `%${q}%`),
				like(s.orderName, `%${q.replace(/^#/, '')}%`),
				like(s.orderRefRaw, `%${q}%`)
			)!
		);
	const where = filters.length ? and(...filters) : undefined;

	const [{ n: totalRows }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(s)
		.where(where);
	const parcels = await db
		.select({
			id: s.id,
			courier: s.courier,
			trackingNo: s.trackingNo,
			orderName: s.orderName,
			orderRefRaw: s.orderRefRaw,
			extraParcel: s.extraParcel,
			status: s.status,
			courierStatus: s.courierStatus,
			bookedAt: s.bookedAt,
			finalAt: s.finalAt,
			weightKg: s.weightKg,
			cod: s.cod,
			fee: sql<number>`${s.fee} + ${s.feeTax} + ${s.returnFee} + ${s.returnFeeTax} + ${s.otherFees}`,
			rawFee: s.fee,
			taxes: sql<number>`${s.itwh} + ${s.stwh}`,
			taxesEstimated: s.taxesEstimated,
			netPayable: s.netPayable,
			statementNumber: schema.statements.number,
			conflictNote: s.conflictNote,
			matchStatus: s.matchStatus
		})
		.from(s)
		.leftJoin(schema.statements, eq(schema.statements.id, s.statementId))
		.where(where)
		.orderBy(desc(sql`coalesce(${s.finalAt}, ${s.bookedAt})`))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE);

	const lastSync = await db.query.syncRuns.findFirst({
		where: like(schema.syncRuns.kind, 'postex%'),
		orderBy: desc(schema.syncRuns.startedAt)
	});

	return {
		view,
		courier: courier ?? 'all',
		q,
		page,
		pageCount: Math.max(1, Math.ceil(totalRows / PAGE_SIZE)),
		totalRows,
		monthRows,
		statusRows,
		attentionCount: attention.n,
		thresholds,
		parcels,
		postexReady: postexConfigured(),
		lastSync: lastSync
			? {
					at: lastSync.startedAt,
					ok: lastSync.ok,
					summary: lastSync.summary ? JSON.parse(lastSync.summary) : null
				}
			: null
	};
};

export const actions: Actions = {
	upload: async ({ request, url }) => {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose a file first.' });
		let id: string;
		try {
			id = await stageUpload(file.name, new Uint8Array(await file.arrayBuffer()));
		} catch (e) {
			if (e instanceof ImportError) return fail(400, { error: e.message });
			return fail(400, { error: `Could not read the file: ${e instanceof Error ? e.message : e}` });
		}
		redirect(303, `/couriers/import/${id}?m=${url.searchParams.get('m') ?? ''}`);
	},

	/** Manually attach a parcel to a Shopify order (e.g. split order "1326-2", typo in ref). */
	link: async ({ request }) => {
		const f = await request.formData();
		const id = String(f.get('shipmentId') ?? '');
		const name = String(f.get('orderName') ?? '')
			.trim()
			.replace(/^#/, '');
		const order = await db.query.orders.findFirst({ where: eq(schema.orders.name, name) });
		if (!order)
			return fail(400, { error: `Order #${name} not found in Shopify data. Sync Shopify first?` });
		await db
			.update(s)
			.set({
				orderId: order.id,
				orderName: order.name,
				matchStatus: 'manual',
				updatedAt: new Date().toISOString()
			})
			.where(eq(s.id, id));
		await db.insert(schema.shipmentChanges).values({
			shipmentId: id,
			source: 'manual',
			diff: JSON.stringify({ order: [null, order.name] })
		});
		return { saved: `Parcel linked to #${order.name}.` };
	},

	/** Not a sale we account for (pre-Shopify, sample, personal parcel…). */
	exclude: async ({ request }) => {
		const id = String((await request.formData()).get('shipmentId') ?? '');
		await db
			.update(s)
			.set({ matchStatus: 'excluded', updatedAt: new Date().toISOString() })
			.where(eq(s.id, id));
		await db.insert(schema.shipmentChanges).values({
			shipmentId: id,
			source: 'manual',
			diff: JSON.stringify({ matchStatus: [null, 'excluded'] })
		});
		return { saved: 'Parcel excluded from the books.' };
	},

	/** Mark a conflict as reviewed (keeps the existing data). */
	resolve: async ({ request }) => {
		const id = String((await request.formData()).get('shipmentId') ?? '');
		await db.update(s).set({ conflictNote: null }).where(eq(s.id, id));
		return { saved: 'Conflict marked as reviewed.' };
	}
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
