import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gt, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { getRates, saveCostInputs, setRates, stockSummary } from '#lib/server/costing.js';
import { parseCsv, parseXlsx } from '#lib/server/couriers/sheets.js';
import { headerKey } from '#lib/server/couriers/util.js';
import { syncStock } from '#lib/server/shopify-sync.js';
import {
	classifyStockChanges,
	recordOpeningStock,
	stockElsewhere,
	VARIANCE_REASONS,
	type VarianceReason
} from '#lib/server/stock.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 100;
const VIEWS = ['needs', 'noweight', 'estimated', 'highddp', 'all'] as const;
type View = (typeof VIEWS)[number];
const v = schema.variants;

/** Automatic DDP above 2× the goods cost (yuan items, no override) — worth checking. */
const highDdp = (rmbFx: number, ddpPerKg: number) =>
	sql`${v.costSource} = 'estimated' and ${v.estDdp} is null and coalesce(${v.estCurrency}, 'RMB') = 'RMB'
		and coalesce(${v.weightG}, 0) * ${ddpPerKg} / 1000.0 > 2 * ${v.estCnPriceMinor} * ${rmbFx} / 10000.0`;

const VIEW_WHERE: Record<Exclude<View, 'highddp'>, SQL | undefined> = {
	needs: and(gt(v.shopifyOnHand, 0), eq(v.avgCost, 0)),
	noweight: and(eq(v.status, 'ACTIVE'), sql`coalesce(${v.weightG}, 0) = 0`),
	estimated: or(eq(v.costSource, 'estimated'), eq(v.costSource, 'shopify')),
	all: undefined
};

export const load: PageServerLoad = async ({ url }) => {
	const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as View)
		: 'needs';
	const q = url.searchParams.get('q')?.trim() ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const rates = await getRates();
	const where_ = (k: View) => (k === 'highddp' ? highDdp(rates.rmbFx, rates.ddpPerKg) : VIEW_WHERE[k]);
	const filters = [where_(view)];
	if (q) filters.push(or(like(v.productTitle, `%${q}%`), like(v.sku, `%${q}%`)));
	const where = and(...filters.filter(Boolean));

	const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(v).where(where);
	const rows = await db
		.select({
			id: v.id,
			productId: v.productId,
			productTitle: v.productTitle,
			variantTitle: v.variantTitle,
			sku: v.sku,
			status: v.status,
			weightG: v.weightG,
			price: v.price,
			onHand: v.shopifyOnHand,
			shopifyCost: v.shopifyCost,
			shopifyCostOk: v.shopifyCostOk,
			cnPrice: v.estCnPriceMinor,
			currency: v.estCurrency,
			ddp: v.estDdp,
			estCost: v.estCost,
			avgCost: v.avgCost,
			costSource: v.costSource
		})
		.from(v)
		.where(where)
		.orderBy(desc(sql`max(coalesce(${v.shopifyOnHand}, 0), 0)`), asc(v.productTitle), asc(v.variantTitle))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE);

	const counts = Object.fromEntries(
		await Promise.all(
			VIEWS.map(async (k) => {
				const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(v).where(where_(k));
				return [k, n] as const;
			})
		)
	) as Record<View, number>;

	const [{ opening }] = await db
		.select({ opening: sql<number>`count(*)` })
		.from(schema.stockMovements)
		.where(eq(schema.stockMovements.type, 'opening'));

	const sm = schema.stockMovements;
	const changes = await db
		.select({
			id: sm.id,
			at: sm.at,
			qty: sm.qtyDelta,
			unitCost: sm.unitCost,
			productTitle: v.productTitle,
			variantTitle: v.variantTitle,
			sku: v.sku
		})
		.from(sm)
		.leftJoin(v, eq(v.id, sm.variantId))
		.where(and(eq(sm.type, 'variance'), isNull(sm.reason)))
		.orderBy(desc(sm.at), asc(v.productTitle))
		.limit(300);
	const lastCheck = await db.query.settings.findFirst({ where: eq(schema.settings.key, 'stock_checked_at') });

	return {
		changes,
		lastStockCheck: lastCheck ? (JSON.parse(lastCheck.value) as string) : null,
		elsewhere: await stockElsewhere(),
		view,
		q,
		page,
		pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)),
		totalRows: n,
		counts,
		rates,
		summary: await stockSummary(),
		openingRecorded: opening > 0,
		rows
	};
};

/** "39.5" → 395000 (×10⁴). */
function toX10000(s: string) {
	const n = Number(s.replace(/[,\s]/g, ''));
	if (!Number.isFinite(n) || n < 0) throw new Error('bad number');
	return Math.round(n * 10_000);
}

type Input = Parameters<typeof saveCostInputs>[0][number];

export const actions: Actions = {
	rates: async ({ request }) => {
		const f = await request.formData();
		try {
			const ddpPerKg = toPaisa(String(f.get('ddp') ?? ''));
			const rmbFx = toX10000(String(f.get('fx') ?? ''));
			if (ddpPerKg <= 0 || rmbFx <= 0) return fail(400, { error: 'Enter both rates.' });
			const r = await setRates({ ddpPerKg, rmbFx });
			return { saved: `Rates saved · ${r.changed} product costs updated.` };
		} catch {
			return fail(400, { error: 'Rates must be numbers.' });
		}
	},

	/** Grid save: JSON list of changed rows. */
	save: async ({ request }) => {
		const raw = String((await request.formData()).get('rows') ?? '[]');
		let inputs: Input[];
		try {
			inputs = (
				JSON.parse(raw) as { id: string; price: string; currency: string; ok: boolean; ddp: string }[]
			).map((r) => ({
				id: String(r.id),
				priceMinor: r.price.trim() === '' ? null : Math.abs(toPaisa(r.price)),
				currency: r.currency === 'PKR' ? 'PKR' : 'RMB',
				shopifyCostOk: !!r.ok,
				ddp: (r.ddp ?? '').trim() === '' ? null : Math.abs(toPaisa(r.ddp))
			}));
		} catch {
			return fail(400, { error: 'Prices must be numbers.' });
		}
		if (!inputs.length) return { saved: 'Nothing changed.' };
		const r = await saveCostInputs(inputs);
		return { saved: `Saved ${inputs.length} variants · ${r.changed} costs updated.` };
	},

	/** Bulk prices from the exported sheet (CSV or xlsx). Matches variant_id, else SKU. */
	upload: async ({ request }) => {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { error: 'Choose a file.' });
		if (file.size > 5_000_000) return fail(400, { error: 'File too large (max 5 MB).' });
		const bytes = new Uint8Array(await file.arrayBuffer());
		let grid: string[][];
		try {
			grid = /\.xlsx$/i.test(file.name)
				? parseXlsx(bytes)
				: parseCsv(new TextDecoder().decode(bytes));
		} catch (e) {
			return fail(400, { error: `Could not read file: ${e instanceof Error ? e.message : e}` });
		}
		const head = (grid[0] ?? []).map(headerKey);
		const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
		const iId = col('variantid', 'id');
		const iSku = col('sku');
		const iPrice = col('chinaprice', 'price', 'cnprice');
		const iCur = col('currency');
		const iOk = col('shopifycostcorrect');
		const iDdp = col('ddpperpiece', 'ddp');
		if (iPrice < 0 || (iId < 0 && iSku < 0))
			return fail(400, {
				error: 'Sheet needs a "china_price" column and "variant_id" or "sku". Use the exported sheet.'
			});

		const all = await db
			.select({ id: v.id, sku: v.sku, ok: v.shopifyCostOk, cur: v.estCurrency, price: v.estCnPriceMinor, ddp: v.estDdp })
			.from(v);
		const byId = new Map(all.map((r) => [r.id, r]));
		const bySku = new Map(all.filter((r) => r.sku).map((r) => [r.sku!.trim().toLowerCase(), r]));

		const inputs: Input[] = [];
		const problems: string[] = [];
		for (const [i, row] of grid.slice(1).entries()) {
			if (row.every((c) => !String(c ?? '').trim())) continue;
			const key = iId >= 0 && row[iId]?.trim() ? row[iId].trim() : '';
			const match =
				(key && byId.get(key)) ||
				(iSku >= 0 && row[iSku]?.trim() ? bySku.get(row[iSku].trim().toLowerCase()) : undefined);
			if (!match) {
				problems.push(`row ${i + 2}: product not found`);
				continue;
			}
			const p = String(row[iPrice] ?? '').trim();
			let priceMinor: number | null;
			try {
				priceMinor = p === '' ? null : Math.abs(toPaisa(p));
			} catch {
				problems.push(`row ${i + 2}: price "${p}" is not a number`);
				continue;
			}
			const cur = iCur >= 0 ? String(row[iCur] ?? '').trim().toUpperCase() : '';
			const okRaw = iOk >= 0 ? String(row[iOk] ?? '').trim().toLowerCase() : '';
			let ddp: number | null | undefined = undefined; // column missing → leave as is
			if (iDdp >= 0) {
				const d = String(row[iDdp] ?? '').trim();
				try {
					ddp = d === '' ? null : Math.abs(toPaisa(d));
				} catch {
					problems.push(`row ${i + 2}: DDP "${d}" is not a number`);
					continue;
				}
			}
			const next: Input = {
				id: match.id,
				priceMinor,
				currency: cur === 'PKR' || cur === 'RS' ? 'PKR' : 'RMB',
				shopifyCostOk: okRaw ? ['yes', 'y', 'true', '1'].includes(okRaw) : match.ok,
				ddp
			};
			if (
				next.priceMinor === match.price &&
				(next.priceMinor === null || next.currency === (match.cur ?? 'RMB')) &&
				next.shopifyCostOk === match.ok &&
				(ddp === undefined || ddp === match.ddp)
			)
				continue;
			inputs.push(next);
		}
		if (problems.length > 20)
			return fail(400, { error: `${problems.length} rows have problems, e.g. ${problems.slice(0, 5).join('; ')}` });
		const r = inputs.length ? await saveCostInputs(inputs) : { changed: 0 };
		return {
			saved:
				`Sheet imported: ${inputs.length} variants changed · ${r.changed} costs updated.` +
				(problems.length ? ` Skipped: ${problems.join('; ')}` : '')
		};
	},

	refresh: async () => {
		try {
			const r = await syncStock('recent');
			return {
				saved: `Pulled ${r.orders} changed orders and ${r.variants} variants from Shopify.${r.stockChanges ? ` ${r.stockChanges} stock changes need a reason.` : ''}`
			};
		} catch (e) {
			return fail(502, { error: `Shopify sync failed: ${e instanceof Error ? e.message : e}` });
		}
	},

	/** Give a reason to one or many Shopify stock changes. */
	classify: async ({ request }) => {
		const f = await request.formData();
		const reason = String(f.get('reason')) as VarianceReason;
		if (!VARIANCE_REASONS.includes(reason)) return fail(400, { error: 'Pick a reason.' });
		const ids = f.getAll('id').map(String).filter(Boolean);
		const n = await classifyStockChanges(ids, reason);
		return { saved: `${n} stock change${n === 1 ? '' : 's'} marked “${reason}”.` };
	},

	opening: async () => {
		try {
			const r = await recordOpeningStock();
			return { saved: `Stock ledger started: ${r.variants} variants · ${r.units} units on hand.` };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : String(e) });
		}
	}
};

/** Vercel: syncs can take minutes. */
export const config = { maxDuration: 300 };
