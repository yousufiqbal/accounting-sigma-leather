import { error, fail, redirect } from '@sveltejs/kit';
import {
	ImportError,
	commitPending,
	discardPending,
	loadPending
} from '#lib/server/couriers/import-file.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const loaded = await loadPending(params.id);
	if (!loaded) error(404, 'This import no longer exists. Upload the file again.');
	const { pending, parsed, plan } = loaded;
	const statementNumbers = new Set(parsed.rows.map((r) => r.statementNumber).filter(Boolean));
	return {
		filename: pending.filename,
		courier: parsed.courier,
		kind: parsed.kind,
		errors: parsed.errors,
		warnings: parsed.warnings,
		counts: plan.counts,
		statementCount: statementNumbers.size,
		// Only what the preview table needs.
		rows: plan.outcomes.map((o) => ({
			trackingNo: o.trackingNo,
			kind: o.kind,
			orderName: o.incoming.orderName ?? null,
			orderRefRaw: o.incoming.orderRefRaw ?? null,
			status: o.incoming.status,
			cod: o.incoming.cod ?? 0,
			netPayable: o.incoming.netPayable ?? 0,
			statementNumber: o.incoming.statementNumber ?? null,
			diff: o.diff ?? null,
			conflict: o.conflict ?? null
		}))
	};
};

export const actions: Actions = {
	commit: async ({ params, url }) => {
		try {
			const counts = await commitPending(params.id);
			const m = url.searchParams.get('m') ?? '';
			redirect(
				303,
				`/couriers?m=${m}&imported=${counts.new}-${counts.updated}-${counts.unchanged}-${counts.conflict}`
			);
		} catch (e) {
			if (e instanceof ImportError) return fail(400, { error: e.message });
			throw e;
		}
	},
	discard: async ({ params, url }) => {
		await discardPending(params.id);
		redirect(303, `/couriers?m=${url.searchParams.get('m') ?? ''}`);
	}
};
