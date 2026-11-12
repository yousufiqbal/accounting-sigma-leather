import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Ship from '@lucide/svelte/icons/ship';
import Boxes from '@lucide/svelte/icons/boxes';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import Truck from '@lucide/svelte/icons/truck';
import Receipt from '@lucide/svelte/icons/receipt';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import Settings from '@lucide/svelte/icons/settings';

export const nav = [
	{ href: '/', label: 'Dashboard', icon: LayoutDashboard, phase: 5 },
	{ href: '/imports', label: 'Imports (China)', icon: Ship, phase: 4 },
	{ href: '/inventory', label: 'Inventory', icon: Boxes, phase: 4 },
	{ href: '/orders', label: 'Orders', icon: ShoppingCart, phase: 3 },
	{ href: '/couriers', label: 'Couriers', icon: Truck, phase: 2 },
	{ href: '/expenses', label: 'Expenses', icon: Receipt, phase: 5 },
	{ href: '/reports', label: 'Reports', icon: ChartColumn, phase: 5 },
	{ href: '/settings', label: 'Settings', icon: Settings, phase: 1 }
] as const;
