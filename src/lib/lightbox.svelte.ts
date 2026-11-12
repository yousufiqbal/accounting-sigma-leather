/** Panel-wide image lightbox. Rendered once by <Lightbox /> in the app layout. */
class LightboxState {
	src = $state<string | null>(null);
	alt = $state('');
	open = $state(false);
}
export const lightbox = new LightboxState();

export function openLightbox(src: string, alt = '') {
	lightbox.src = src;
	lightbox.alt = alt;
	lightbox.open = true;
}

/** Shopify CDN image at a given width (the CDN resizes on the fly). */
export function sizedImage(url: string, width: number) {
	if (!/cdn\.shopify\.com/.test(url)) return url;
	const u = new URL(url);
	u.searchParams.set('width', String(width));
	return u.toString();
}
