import { currentMonth, isMonth } from '#lib/month.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url }) => {
	const m = url.searchParams.get('m');
	return { month: isMonth(m) ? m : currentMonth() };
};
