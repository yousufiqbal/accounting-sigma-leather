/** How a product's cost was set — label + badge tone. */
export const COST_SOURCE: Record<
	string,
	{ tone: 'success' | 'warning' | 'info' | 'danger'; label: string }
> = {
	batch: { tone: 'success', label: 'from purchase' },
	estimated: { tone: 'warning', label: 'estimated' },
	shopify: { tone: 'info', label: 'Shopify cost' },
	none: { tone: 'danger', label: 'missing' }
};
