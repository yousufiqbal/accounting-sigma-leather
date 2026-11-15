<script lang="ts">
	/**
	 * Phones: the sidebar is an overlay. Close it the moment a link in it is tapped — not after the
	 * next page has loaded (that can take a few seconds), and also when tapping the current page.
	 */
	import { useSidebar } from '#lib/components/ui/sidebar/index.js';

	const sidebar = useSidebar();

	function onclick(e: MouseEvent) {
		if (!sidebar.openMobile) return;
		const link = (e.target as Element | null)?.closest('a[href]');
		if (link && link.closest('[data-sidebar="sidebar"][data-mobile="true"]'))
			sidebar.setOpenMobile(false);
	}
</script>

<svelte:document {onclick} />
