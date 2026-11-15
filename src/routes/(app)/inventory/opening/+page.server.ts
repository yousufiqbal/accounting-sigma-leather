/**
 * Opening costs: the one-time set-up of costs for stock that existed before the panel.
 * Only active products still WITHOUT a purchase cost are listed — once a purchase lands,
 * the real landed cost takes over and the product drops off this page.
 */
import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gt, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.js';
import { toPaisa } from '#lib/money.js';
import { getRates, pushWeights, saveCostInputs, setRates } from '#lib/server/costing.js';
import { parseCsv, parseXlsx } from '#lib/server/couriers/sheets.js';
import { headerKey } from '#lib/server/couriers/util.js';
import { recordOpeningStock } from '#lib/server/stock.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 100;
const VIEWS = ['missing', 'estimated', 'noweight', 'highddp', 'all'] as const;
type View = (typeof VIEWS)[number];
const v = schema.variants;

/** Automatic DDP above 2× the goods cost (yuan items, no override) — worth checking. */
const highDdp = (rmbFx: number, ddpPerKg: number) =>
	sql`${v.costSource} = 'estimated' and ${v.estDdp} is null and coalesce(${v.estCurrency}, 'RMB') = 'RMB'
		and coalesce(${v.weightG}, 0) * ${ddpPerKg} / 1000.0 > 2 * ${v.estCnPriceMinor} * ${rmbFx} / 10000.0`;

const VIEW_WHERE: Record<Exclude<View, 'highddp'>, SQL | undefined> = {
	missing: and(gt(v.shopifyOnHand, 0), eq(v.avgCost, 0)),
	estimated: or(eq(v.costSource, 'estimated'), eq(v.costSource, 'shopify')),
	noweight: sql`coalesce(${v.weightG}, 0) = 0`,
	all: undefined
};

export const load: PageServerLoad = async ({ url }) => {
	const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as View)
		: 'missing';
	const q = url.searchParams.get('q')?.trim() ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const rates = await getRates();
	// Active products not yet costed by a purchase (drafts/archived are leftovers).
	// Bundles get their cost from their items — nothing to enter for them here.
	const base = and(eq(v.status, 'ACTIVE'), eq(v.isBundle, false), ne(v.costSource, 'batch'));
	const where_ = (k: View) =>
		and(base, k === 'highddp' ? highDdp(rates.rmbFx, rates.ddpPerKg) : VIEW_WHERE[k]);
	const filters = [where_(view)];
	if (q) filters.push(or(like(v.productTitle, `%${q}%`), like(v.sku, `%${q}%`)));
	const where = and(...filters.filter(Boolean));

	const [{ n }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(v)
		.where(where);
	const rows = await db
		.select({
			id: v.id,
			productId: v.productId,
			productTitle: v.productTitle,
			imageUrl: v.imageUrl,
			variantTitle: v.variantTitle,
			sku: v.sku,
			status: v.status,
			weightG: v.weightG,
			onHand: v.shopifyOnHand,
			shopifyCost: v.shopifyCost,
			shopifyCostOk: v.shopifyCostOk,
			cnPrice: v.estCnPriceMinor,
			currency: v.estCurrency,
			ddp: v.estDdp,
			avgCost: v.avgCost,
			costSource: v.costSource
		})
		.from(v)
		.where(where)
		.orderBy(
			desc(sql`sum(max(coalesce(${v.shopifyOnHand}, 0), 0)) over (partition by ${v.productId})`),
			asc(v.productTitle),
			asc(v.productId),
			asc(v.variantTitle)
		)
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE);

	const counts = Object.fromEntries(
		await Promise.all(
			VIEWS.map(async (k) => {
				const [{ n }] = await db
					.select({ n: sql<number>`count(*)` })
					.from(v)
					.where(where_(k));
				return [k, n] as const;
			})
		)
	) as Record<View, number>;

	// Progress: in-stock active products that have any cost.
	const [progress] = (await db.all(sql`
		select count(*) as inStock, sum(case when avg_cost_paisa > 0 then 1 else 0 end) as costed
		from variants where status = 'ACTIVE' and shopify_on_hand > 0`)) as {
		inStock: number;
		costed: number;
	}[];

	const [{ opening }] = await db
		.select({ opening: sql<number>`count(*)` })
		.from(schema.stockMovements)
		.where(eq(schema.stockMovements.type, 'opening'));

	return {
		view,
		q,
		page,
		pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)),
		totalRows: n,
		counts,
		rates,
		progress: { inStock: Number(progress.inStock), costed: Number(progress.costed ?? 0) },
		openingRecorded: opening > 0,
		units: Number(
			(
				(await db.all(
					sql`select coalesce(sum(shopify_on_hand), 0) as u from variants where status = 'ACTIVE' and shopify_on_hand > 0`
				)) as {
					u: number;
				}[]
			)[0].u
		),
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
const grams = (s: string) => {
	const n = Number(String(s).replace(/[,\s]/g, ''));
	if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new Error('weight');
	return Math.round(n);
};

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

	/** Grid save: JSON list of changed rows (cost inputs and/or weight). */
	save: async ({ request }) => {
		const raw = String((await request.formData()).get('rows') ?? '[]');
		let inputs: Input[];
		let weights: { id: string; weightG: number }[];
		try {
			const parsed = JSON.parse(raw) as {
				id: string;
				price: string;
				currency: string;
				ok: boolean;
				ddp: string;
				weight?: string;
				weightChanged?: boolean;
				costChanged?: boolean;
			}[];
			inputs = parsed
				.filter((r) => r.costChanged !== false)
				.map((r) => ({
					id: String(r.id),
					priceMinor: r.price.trim() === '' ? null : Math.abs(toPaisa(r.price)),
					currency: r.currency === 'PKR' ? 'PKR' : 'RMB',
					shopifyCostOk: !!r.ok,
					ddp: (r.ddp ?? '').trim() === '' ? null : Math.abs(toPaisa(r.ddp))
				}));
			weights = parsed
				.filter((r) => r.weightChanged && (r.weight ?? '').trim() !== '')
				.map((r) => ({ id: String(r.id), weightG: grams(r.weight!) }));
		} catch {
			return fail(400, { error: 'Prices and weights must be numbers.' });
		}
		if (!inputs.length && !weights.length) return { saved: 'Nothing changed.' };
		const w = await pushWeights(weights);
		const r = inputs.length ? await saveCostInputs(inputs) : { changed: 0 };
		if (w.failed)
			return fail(502, {
				error: `Saved costs, but ${w.failed} weight${w.failed === 1 ? '' : 's'} could not be updated in Shopify — try again.`
			});
		const parts = [
			inputs.length ? `${inputs.length} cost${inputs.length === 1 ? '' : 's'} saved` : '',
			w.done ? `${w.done} weight${w.done === 1 ? '' : 's'} updated in Shopify` : ''
		].filter(Boolean);
		return { saved: `${parts.join(' · ')}.` };
	},

	/** Bulk prices (and weights) from the exported sheet (CSV or xlsx). Matches variant_id, else SKU. */
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
		const iPrice = col('buyingprice', 'chinaprice', 'price', 'cnprice');
		const iCur = col('currency');
		const iOk = col('shopifycostcorrect');
		const iDdp = col('ddpperpiece', 'ddp');
		const iW = col('weightg', 'weight');
		if ((iPrice < 0 && iW < 0) || (iId < 0 && iSku < 0))
			return fail(400, {
				error:
					'Sheet needs "buying_price" and/or "weight_g", plus "variant_id" or "sku". Use the downloaded sheet.'
			});

		const all = await db
			.select({
				id: v.id,
				sku: v.sku,
				ok: v.shopifyCostOk,
				cur: v.estCurrency,
				price: v.estCnPriceMinor,
				ddp: v.estDdp,
				w: v.weightG
			})
			.from(v);
		const byId = new Map(all.map((r) => [r.id, r]));
		const bySku = new Map(all.filter((r) => r.sku).map((r) => [r.sku!.trim().toLowerCase(), r]));

		const inputs: Input[] = [];
		const weights: { id: string; weightG: number }[] = [];
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
			if (iW >= 0) {
				const ws = String(row[iW] ?? '').trim();
				if (ws !== '') {
					try {
						const g = grams(ws);
						if (g !== (match.w ?? 0)) weights.push({ id: match.id, weightG: g });
					} catch {
						problems.push(`row ${i + 2}: weight "${ws}" is not a number`);
					}
				}
			}
			if (iPrice < 0) continue;
			const p = String(row[iPrice] ?? '').trim();
			let priceMinor: number | null;
			try {
				priceMinor = p === '' ? null : Math.abs(toPaisa(p));
			} catch {
				problems.push(`row ${i + 2}: price "${p}" is not a number`);
				continue;
			}
			const cur =
				iCur >= 0
					? String(row[iCur] ?? '')
							.trim()
							.toUpperCase()
					: '';
			const okRaw =
				iOk >= 0
					? String(row[iOk] ?? '')
							.trim()
							.toLowerCase()
					: '';
			let ddp: number | null | undefined = undefined; // column missing → leave as is
			if (iDdp >= 0) {
				const d = String(row[iDdp] ?? '').trim();
				try {
					ddp = d === '' ? null : Math.abs(toPaisa(d));
				} catch {
					problems.push(`row ${i + 2}: transport "${d}" is not a number`);
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
			return fail(400, {
				error: `${problems.length} rows have problems, e.g. ${problems.slice(0, 5).join('; ')}`
			});
		const w = await pushWeights(weights);
		const r = inputs.length ? await saveCostInputs(inputs) : { changed: 0 };
		return {
			saved:
				`Sheet imported: ${inputs.length} costs changed` +
				(weights.length
					? ` · ${w.done} weights updated in Shopify${w.failed ? ` (${w.failed} failed)` : ''}`
					: '') +
				` · ${r.changed} costs recalculated.` +
				(problems.length ? ` Skipped: ${problems.join('; ')}` : '')
		};
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

/** Vercel: pushing many weights can take a while. */
export const config = { maxDuration: 300 };
