/** Upload → parse → stash as pending import (preview) → commit or discard. */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { looksLikeDex, parseDex } from './dex.js';
import { applyMerge, planMerge } from './merge.js';
import { looksLikePostexCsv, parsePostexCsv } from './postex.js';
import { parseCsv, parseXlsx } from './sheets.js';
import type { ParsedFile } from './types.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class ImportError extends Error {}

export function parseUpload(filename: string, bytes: Uint8Array): ParsedFile {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.xlsx')) {
		const grid = parseXlsx(bytes);
		if (looksLikeDex(grid)) return parseDex(grid);
		throw new ImportError(
			'This .xlsx is not a DEX statement (no "Statement Number" / "External Order No." columns).'
		);
	}
	if (lower.endsWith('.csv')) {
		const grid = parseCsv(new TextDecoder().decode(bytes));
		if (looksLikePostexCsv(grid)) return parsePostexCsv(grid);
		throw new ImportError(
			'This .csv is not a PostEx export (no TRACKING_NUMBER / RESERVE_CPR_NUMBER columns).'
		);
	}
	throw new ImportError('Upload a DEX statement (.xlsx) or a PostEx export (.csv).');
}

/** Returns the pending import id, or throws if this exact file was already imported. */
export async function stageUpload(filename: string, bytes: Uint8Array): Promise<string> {
	if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ImportError('File is larger than 10 MB.');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const done = await db.query.importFiles.findFirst({
		where: eq(schema.importFiles.sha256, sha256)
	});
	if (done)
		throw new ImportError(
			`This exact file was already imported on ${done.importedAt.slice(0, 10)} (${done.filename}). Nothing to do.`
		);
	const parsed = parseUpload(filename, bytes);
	if (!parsed.rows.length && !parsed.errors.length)
		throw new ImportError('No parcels found in this file.');
	const [row] = await db
		.insert(schema.pendingImports)
		.values({ sha256, filename, courier: parsed.courier, payload: JSON.stringify(parsed) })
		.returning({ id: schema.pendingImports.id });
	return row.id;
}

export async function loadPending(id: string) {
	const p = await db.query.pendingImports.findFirst({ where: eq(schema.pendingImports.id, id) });
	if (!p) return null;
	const parsed = JSON.parse(p.payload) as ParsedFile;
	const plan = await planMerge(parsed.courier, parsed.rows, parsed.statements);
	return { pending: p, parsed, plan };
}

export async function commitPending(id: string) {
	const loaded = await loadPending(id);
	if (!loaded) throw new ImportError('This import no longer exists. Upload the file again.');
	const { pending, parsed, plan } = loaded;
	if (parsed.errors.length) throw new ImportError('Fix the errors before importing.');
	const [file] = await db
		.insert(schema.importFiles)
		.values({
			sha256: pending.sha256,
			filename: pending.filename,
			courier: pending.courier,
			counts: JSON.stringify(plan.counts)
		})
		.returning({ id: schema.importFiles.id });
	const counts = await applyMerge(plan, `file:${file.id}`);
	await db.delete(schema.pendingImports).where(eq(schema.pendingImports.id, id));
	return counts;
}

export async function discardPending(id: string) {
	await db.delete(schema.pendingImports).where(eq(schema.pendingImports.id, id));
}
