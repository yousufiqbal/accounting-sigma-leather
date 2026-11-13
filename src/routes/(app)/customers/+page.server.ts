import { customerList } from '#lib/server/customers.js';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;
const SORTS = ['profit', 'orders', 'worst', 'recent'] as const;

export const load: PageServerLoad = async ({ url }) => {
	const sortParam = url.searchParams.get('sort') ?? '';
	const sort = (SORTS as readonly string[]).includes(sortParam)
		? (sortParam as (typeof SORTS)[number])
		: 'profit';
	const q = url.searchParams.get('q')?.trim() ?? '';
	const risky = url.searchParams.get('risky') === '1';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const all = await customerList();
	const totals = {
		customers: all.length,
		repeat: all.filter((c) => c.delivered >= 2).length,
		risky: all.filter((c) => c.risky).length,
		profit: all.reduce((s, c) => s + c.profit, 0)
	};

	const needle = q.toLowerCase();
	const digits = q.replace(/\D/g, '');
	let list = all.filter(
		(c) =>
			(!risky || c.risky) &&
			(!q ||
				(c.name ?? '').toLowerCase().includes(needle) ||
				(c.city ?? '').toLowerCase().includes(needle) ||
				(digits.length >= 4 && (c.phone ?? '').replace(/\D/g, '').includes(digits)))
	);
	list = list.sort((a, b) =>
		sort === 'orders'
			? b.orders - a.orders || b.profit - a.profit
			: sort === 'worst'
				? b.returned - a.returned || a.profit - b.profit
				: sort === 'recent'
					? (b.lastOrder ?? '').localeCompare(a.lastOrder ?? '')
					: b.profit - a.profit
	);
	return {
		sort,
		q,
		risky,
		page,
		totals,
		pageCount: Math.max(1, Math.ceil(list.length / PAGE_SIZE)),
		totalRows: list.length,
		customers: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
	};
};
