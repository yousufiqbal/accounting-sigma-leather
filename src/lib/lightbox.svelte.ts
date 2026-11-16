/** Panel-wide image lightbox. Rendered once by <Lightbox /> in the app layout. */
export type LightboxItem = { src: string; title: string; caption?: string };

class LightboxState {
	items = $state<LightboxItem[]>([]);
	index = $state(0);
	open = $state(false);
	/** Last move: 1 = forward, -1 = back (which side the image flies in from). */
	dir = $state(1);
	get current(): LightboxItem | null {
		return this.items[this.index] ?? null;
	}
	go(step: number) {
		const n = this.items.length;
		const next = this.index + step;
		if (n > 1 && next >= 0 && next < n) {
			this.dir = step > 0 ? 1 : -1;
			this.index = next; // stops at the ends (buttons dim), like the dispatcher panel
		}
	}
	jump(i: number) {
		if (i === this.index) return;
		this.dir = i > this.index ? 1 : -1;
		this.index = i;
	}
}
export const lightbox = new LightboxState();

/** Open one image, or a gallery starting at `index`. */
export function openLightbox(items: LightboxItem | LightboxItem[], index = 0) {
	lightbox.items = Array.isArray(items) ? items : [items];
	lightbox.index = Math.min(Math.max(0, index), lightbox.items.length - 1);
	lightbox.open = true;
}

/**
 * Open from a clicked thumbnail: every zoomable thumbnail on the page (in page order) becomes the
 * gallery, so ← → walk through the rows around it.
 */
export function openFromThumb(el: HTMLElement) {
	const root =
		el.closest('[data-gallery]') ??
		el.closest('[role="dialog"]') ??
		document.querySelector('main') ??
		document.body;
	let nodes = [...root.querySelectorAll<HTMLElement>('[data-lb-src]')];
	if (!nodes.includes(el)) nodes = [el];
	const items = nodes.map((n) => ({
		src: n.dataset.lbSrc!,
		title: n.dataset.lbTitle ?? '',
		caption: n.dataset.lbCaption || undefined
	}));
	openLightbox(items, Math.max(0, nodes.indexOf(el)));
}

/** Shopify CDN image at a given width (the CDN resizes on the fly). */
export function sizedImage(url: string, width: number) {
	if (!/cdn\.shopify\.com/.test(url)) return url;
	const u = new URL(url);
	u.searchParams.set('width', String(Math.round(width)));
	return u.toString();
}

/** Big-view width: enough for the screen, never the full original. */
export function viewWidth() {
	if (typeof window === 'undefined') return 900;
	const px = Math.min(window.innerWidth, window.innerHeight * 1.2) * (window.devicePixelRatio || 1);
	return Math.min(1200, Math.max(500, Math.ceil(px / 100) * 100));
}
