import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import Truck from '@lucide/svelte/icons/truck';
import Boxes from '@lucide/svelte/icons/boxes';
import Ship from '@lucide/svelte/icons/ship';
import Receipt from '@lucide/svelte/icons/receipt';
import Settings from '@lucide/svelte/icons/settings';

/** `badge` = key into the layout's attention counts. */
export const nav = [
	{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
	{ href: '/reports', label: 'Reports', icon: ChartColumn },
	{ href: '/orders', label: 'Orders', icon: ShoppingCart },
	{ href: '/couriers', label: 'Couriers', icon: Truck, badge: 'couriers' },
	{ href: '/inventory', label: 'Inventory', icon: Boxes, badge: 'inventory' },
	{ href: '/imports', label: 'Imports', icon: Ship },
	{ href: '/expenses', label: 'Expenses', icon: Receipt }
] as const;

export const settingsNav = { href: '/settings', label: 'Settings', icon: Settings } as const;
