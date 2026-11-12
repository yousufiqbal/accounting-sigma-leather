import { fail, redirect } from '@sveltejs/kit';
import {
	clearFailedLogins,
	createSession,
	isRateLimited,
	recordFailedLogin,
	verifyCredentials
} from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

function safeNext(next: string | null): string {
	// Only same-site relative paths. Browsers treat "/\x" like "//x", so reject backslashes too,
	// and make sure the URL still resolves to this origin.
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
	try {
		const u = new URL(next, 'http://local.invalid');
		return u.origin === 'http://local.invalid' ? u.pathname + u.search + u.hash : '/';
	} catch {
		return '/';
	}
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authed) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const ip = getClientAddress();
		if (await isRateLimited(ip)) {
			return fail(429, { email: '', message: 'Too many attempts. Try again in 15 minutes.' });
		}
		const data = await request.formData();
		const email = String(data.get('email') ?? '');
		const password = String(data.get('password') ?? '');
		if (!email || !password || !verifyCredentials(email, password)) {
			await recordFailedLogin(ip);
			return fail(400, { email, message: 'Wrong email or password.' });
		}
		await clearFailedLogins(ip);
		createSession(cookies);
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
