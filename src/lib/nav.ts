import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import Truck from '@lucide/svelte/icons/truck';
import Boxes from '@lucide/svelte/icons/boxes';
import PackagePlus from '@lucide/svelte/icons/package-plus';
import Receipt from '@lucide/svelte/icons/receipt';
import Tag from '@lucide/svelte/icons/tag';
import Settings from '@lucide/svelte/icons/settings';

/** `badge` = key into the layout's attention counts. */
export const nav = [
	{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
	{ href: '/reports', label: 'Reports', icon: ChartColumn },
	{ href: '/orders', label: 'Orders', icon: ShoppingCart },
	{ href: '/couriers', label: 'Couriers', icon: Truck, badge: 'couriers' },
	{ href: '/inventory', label: 'Inventory', icon: Boxes, badge: 'inventory' },
	{ href: '/pricing', label: 'Pricing', icon: Tag },
	{ href: '/purchases', label: 'Purchases', icon: PackagePlus },
	{ href: '/expenses', label: 'Expenses', icon: Receipt }
] as const;

export const settingsNav = { href: '/settings', label: 'Settings', icon: Settings } as const;
