import { openOrders } from '#lib/server/open-orders.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => openOrders();
