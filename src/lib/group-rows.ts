/**
 * Variants of the same product sit next to each other in our tables. For each row: is it the
 * first of its product on this page, and how many variants of that product are on the page.
 * Products with more than one variant get a header row; their variants show only the variant name.
 */
export type RowGroup = { first: boolean; size: number; grouped: boolean };

export function productGroups<T extends { productId: string }>(rows: T[]): RowGroup[] {
	const out: RowGroup[] = [];
	let i = 0;
	while (i < rows.length) {
		let j = i;
		while (j < rows.length && rows[j].productId === rows[i].productId) j++;
		const size = j - i;
		for (let k = i; k < j; k++) out.push({ first: k === i, size, grouped: size > 1 });
		i = j;
	}
	return out;
}
