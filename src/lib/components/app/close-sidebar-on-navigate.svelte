<script lang="ts">
	/** Phones: the sidebar is an overlay — close it once a link has taken you to another page. */
	import { afterNavigate } from '$app/navigation';
	import { useSidebar } from '#lib/components/ui/sidebar/index.js';

	const sidebar = useSidebar();
	afterNavigate(({ type }) => {
		if (type !== 'enter' && sidebar.openMobile) sidebar.setOpenMobile(false);
	});
</script>
