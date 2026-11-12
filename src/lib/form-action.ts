import { page } from '$app/state';

/**
 * Named form action URL that keeps the current query string (e.g. `?m=2026-10`), so the
 * page reloaded after the action still shows the same month/filters.
 * `formAction('save')` on `/expenses?m=2026-10` → `?m=2026-10&/save`.
 */
export function formAction(name: string) {
	const params = new URLSearchParams(page.url.search);
	for (const key of [...params.keys()]) if (key.startsWith('/')) params.delete(key);
	const query = params.toString();
	return query ? `?${query}&/${name}` : `?/${name}`;
}
