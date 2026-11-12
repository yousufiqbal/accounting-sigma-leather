/**
 * Panel-wide confirm / notice dialogs (instead of the browser's confirm() / alert()).
 * Rendered once by <ConfirmDialog /> in the app layout.
 *
 *   if (!(await ask({ title: 'Delete?', confirmLabel: 'Delete', destructive: true }))) return cancel();
 *   await notice({ title: 'Save your changes first' });
 */
export type AskOptions = {
	title: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
};

type Pending = AskOptions & { kind: 'ask' | 'notice'; resolve: (ok: boolean) => void };

class ConfirmState {
	current = $state<Pending | null>(null);
	open = $state(false);

	settle(ok: boolean) {
		const c = this.current;
		this.open = false;
		c?.resolve(ok);
	}
}

export const confirmState = new ConfirmState();

function show(kind: Pending['kind'], opts: AskOptions) {
	// A dialog already open is answered "no" — only one question at a time.
	confirmState.current?.resolve(false);
	return new Promise<boolean>((resolve) => {
		confirmState.current = { ...opts, kind, resolve };
		confirmState.open = true;
	});
}

/** Yes/no question. Resolves true only on the confirm button. */
export const ask = (opts: AskOptions) => show('ask', opts);
/** Information with a single OK button. */
export const notice = (opts: Omit<AskOptions, 'cancelLabel' | 'destructive'>) =>
	show('notice', opts).then(() => undefined);
