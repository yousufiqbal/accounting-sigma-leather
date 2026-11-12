import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, isValidSession } from '#lib/server/auth.js';

const PUBLIC_PATHS = ['/login'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	event.locals.authed = isValidSession(event.cookies.get(SESSION_COOKIE));

	// Cron endpoints authenticate with CRON_SECRET inside the route itself.
	const isCron = path.startsWith('/api/cron/');

	if (!event.locals.authed && !isCron && !PUBLIC_PATHS.includes(path)) {
		if (path.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	return response;
};
