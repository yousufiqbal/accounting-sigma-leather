/** Minimal CSV + XLSX readers (first sheet, values only). No heavy dependencies. */
import { strFromU8, unzipSync } from 'fflate';

export type Grid = string[][];

/** RFC 4180 CSV (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): Grid {
	const rows: Grid = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const s = text.replace(/^﻿/, '');
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quoted) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(cell);
			cell = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && s[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += c;
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const decode = (s: string) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&amp;/g, '&');

const textOf = (xml: string) =>
	decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

function colIndex(ref: string): number {
	const letters = ref.match(/^[A-Z]+/)![0];
	let n = 0;
	for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

/** Read the first worksheet of an .xlsx file into a grid of strings. */
export function parseXlsx(bytes: Uint8Array): Grid {
	const files = unzipSync(bytes, {
		filter: (f) =>
			f.name === 'xl/sharedStrings.xml' ||
			f.name === 'xl/workbook.xml' ||
			f.name === 'xl/_rels/workbook.xml.rels' ||
			f.name.startsWith('xl/worksheets/sheet')
	});
	const shared = files['xl/sharedStrings.xml']
		? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
				textOf(m[1])
			)
		: [];

	// Resolve the first sheet in workbook order.
	let sheetPath = Object.keys(files).find((n) => n.startsWith('xl/worksheets/sheet'));
	const wb = files['xl/workbook.xml'] && strFromU8(files['xl/workbook.xml']);
	const rels =
		files['xl/_rels/workbook.xml.rels'] && strFromU8(files['xl/_rels/workbook.xml.rels']);
	const firstRid = wb?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
	if (firstRid && rels) {
		const target =
			rels.match(new RegExp(`Id="${firstRid}"[^>]*Target="([^"]+)"`))?.[1] ??
			rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${firstRid}"`))?.[1];
		if (target) sheetPath = 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '');
	}
	if (!sheetPath || !files[sheetPath]) throw new Error('No worksheet found in file');

	const xml = strFromU8(files[sheetPath]);
	const grid: Grid = [];
	for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const row: string[] = [];
		for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const attrs = c[1];
			const inner = c[2] ?? '';
			const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
			const type = attrs.match(/\bt="([^"]+)"/)?.[1];
			let value = '';
			if (type === 'inlineStr') value = textOf(inner);
			else {
				const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
				if (v !== undefined) value = type === 's' ? (shared[Number(v)] ?? '') : decode(v);
			}
			const idx = ref ? colIndex(ref) : row.length;
			while (row.length < idx) row.push('');
			row[idx] = value;
		}
		grid.push(row);
	}
	return grid;
}
