/**
 * Single-admin auth. Email + password come from env (ADMIN_EMAIL / ADMIN_PASSWORD);
 * session = HMAC-signed cookie `{expiresAt}.{signature}`. No session table needed.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET } from '$app/env/private';
import { db, schema } from './db';

export const SESSION_COOKIE = 'sl_session';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Constant-time string compare (hash first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
	const ha = createHash('sha256').update(a).digest();
	const hb = createHash('sha256').update(b).digest();
	return timingSafeEqual(ha, hb);
}

export function verifyCredentials(email: string, password: string): boolean {
	// Evaluate both so timing doesn't reveal which one was wrong.
	const emailOk = safeEqual(email.trim().toLowerCase(), ADMIN_EMAIL.trim().toLowerCase());
	const passwordOk = safeEqual(password, ADMIN_PASSWORD);
	return emailOk && passwordOk;
}

function sign(value: string) {
	return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

export function createSession(cookies: Cookies) {
	const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
	const value = `${expiresAt}.${sign(String(expiresAt))}`;
	cookies.set(SESSION_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		expires: new Date(expiresAt)
	});
}

export function isValidSession(value: string | undefined): boolean {
	if (!value) return false;
	const [exp, sig] = value.split('.');
	if (!exp || !sig) return false;
	const expected = Buffer.from(sign(exp));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
	return Number(exp) > Date.now();
}

export function destroySession(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Returns true if this IP is currently blocked. */
export async function isRateLimited(ip: string): Promise<boolean> {
	const row = await db.query.loginAttempts.findFirst({ where: eq(schema.loginAttempts.ip, ip) });
	if (!row) return false;
	if (Date.now() - row.windowStart > WINDOW_MS) return false;
	return row.count >= MAX_ATTEMPTS;
}

export async function recordFailedLogin(ip: string) {
	const now = Date.now();
	const row = await db.query.loginAttempts.findFirst({ where: eq(schema.loginAttempts.ip, ip) });
	if (!row || now - row.windowStart > WINDOW_MS) {
		await db
			.insert(schema.loginAttempts)
			.values({ ip, count: 1, windowStart: now })
			.onConflictDoUpdate({ target: schema.loginAttempts.ip, set: { count: 1, windowStart: now } });
	} else {
		await db
			.update(schema.loginAttempts)
			.set({ count: row.count + 1 })
			.where(eq(schema.loginAttempts.ip, ip));
	}
}

export async function clearFailedLogins(ip: string) {
	await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.ip, ip));
}
