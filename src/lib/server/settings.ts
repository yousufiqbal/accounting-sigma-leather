import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';

export async function getSetting<T>(key: string): Promise<T | null> {
	const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
	return row ? (JSON.parse(row.value) as T) : null;
}

export async function setSetting(key: string, value: unknown) {
	const v = JSON.stringify(value);
	await db
		.insert(schema.settings)
		.values({ key, value: v })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value: v } });
}
