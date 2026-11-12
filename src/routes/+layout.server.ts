import { storeName } from '#lib/server/store-name.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({ storeName: await storeName() });
