<script lang="ts">
	import { navigating, page } from '$app/state';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { mode, toggleMode } from 'mode-watcher';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import ConfirmDialog from '#lib/components/app/confirm-dialog.svelte';
	import Lightbox from '#lib/components/app/lightbox.svelte';
	import SyncButton from '#lib/components/app/sync-button.svelte';
	import { toast } from 'svelte-sonner';
	import { replaceState } from '$app/navigation';
	import { untrack } from 'svelte';
	import { nav, settingsNav } from '#lib/nav.js';
	import { currentMonth, monthLabel, shiftMonth } from '#lib/month.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let logoutForm = $state<HTMLFormElement>();

	/** Panel-wide toasts: every form action answers with { saved } or { error }. */
	let lastForm: unknown = null;
	$effect(() => {
		const f = page.form as { saved?: unknown; error?: unknown } | null;
		if (!f || f === lastForm) return;
		lastForm = f;
		if (typeof f.error === 'string' && f.error) toast.error(f.error);
		else if (typeof f.saved === 'string' && f.saved) toast.success(f.saved);
	});

	/**
	 * Courier file import redirects with ?imported=new-updated-same-conflicts.
	 * Toast once, then drop the param. Only page.url is tracked (reading page.state here
	 * re-triggered the effect after replaceState → endless loop that froze the tab).
	 */
	let shownImport = '';
	$effect(() => {
		const imp = page.url.searchParams.get('imported');
		if (!imp || imp === shownImport) return;
		shownImport = imp;
		const [n, u, same, c] = imp.split('-').map(Number);
		toast.success(
			`File imported: ${n} new · ${u} updated · ${same} already up to date${c ? ` · ${c} conflicts (see Needs attention)` : ''}`
		);
		const url = new URL(page.url.href);
		url.searchParams.delete('imported');
		untrack(() => replaceState(url, {}));
	});

	/** Same path, different month — keeps the month picker global. */
	function monthHref(delta: number) {
		const params = new URLSearchParams(page.url.searchParams.toString());
		params.set('m', shiftMonth(data.month, delta));
		return `${page.url.pathname}?${params}`;
	}

	/** Nav links carry the selected month along. */
	const navHref = (href: string) => `${href}?m=${data.month}`;
	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	const initials = (s: string) =>
		s
			.split(/[\s@._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0].toUpperCase())
			.join('');

	/** What each sidebar bubble counts (shown on hover). */
	const BADGE_HINT: Record<string, string> = {
		couriers:
			'parcel(s) need a decision (conflicting data or not linked to an order) — see Needs attention',
		inventory: 'stock change(s) made in Shopify need a reason'
	};
	const hint = (key: string, n: number) => `${n} ${BADGE_HINT[key] ?? 'to check'}`;

	/** Roomy rows, muted icons, active = filled pill with a primary icon. */
	const item =
		'h-9 gap-3 px-2.5 text-[13.5px] text-sidebar-foreground/75 hover:text-sidebar-foreground [&_svg]:text-sidebar-foreground/50 data-active:bg-sidebar-accent data-active:text-sidebar-foreground data-active:shadow-xs data-active:[&_svg]:text-sidebar-primary hover:[&_svg]:text-sidebar-foreground';
</script>

<form bind:this={logoutForm} method="POST" action="/logout" hidden></form>
<ConfirmDialog />
<Lightbox />

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header class="h-14 justify-center border-b border-sidebar-border px-2">
			<a
				href={navHref('/')}
				class="flex items-center gap-2.5 rounded-md px-1.5 py-1 outline-hidden group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
			>
				<span
					class="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
				>
					{initials(data.storeName)}
				</span>
				<span class="grid min-w-0 leading-none group-data-[collapsible=icon]:hidden">
					<span class="truncate text-sm font-semibold tracking-tight">{data.storeName}</span>
					<span class="mt-1 truncate text-[11px] text-muted-foreground">Accounts</span>
				</span>
			</a>
		</Sidebar.Header>

		<Sidebar.Content class="px-2 py-3">
			<Sidebar.Menu class="gap-1">
				{#each nav as n (n.href)}
					{@const count = 'badge' in n ? data.attention[n.badge] : 0}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={isActive(n.href)}
							tooltipContent={count
								? `${n.label} · ${hint('badge' in n ? n.badge : '', count)}`
								: n.label}
							class={item}
						>
							{#snippet child({ props })}
								<a
									href={navHref(n.href)}
									{...props}
									title={count ? hint('badge' in n ? n.badge : '', count) : undefined}
								>
									<n.icon />
									<span>{n.label}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
						{#if count}
							<Sidebar.MenuBadge
								class="top-2! right-2 h-5 rounded-full bg-warning-soft px-1.5 text-[11px] text-warning peer-hover/menu-button:text-warning peer-data-active/menu-button:text-warning"
							>
								{count > 99 ? '99+' : count}
							</Sidebar.MenuBadge>
						{/if}
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Content>

		<Sidebar.Footer class="gap-1 border-t border-sidebar-border p-2">
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						isActive={isActive(settingsNav.href)}
						tooltipContent={settingsNav.label}
						class={item}
					>
						{#snippet child({ props })}
							<a href={navHref(settingsNav.href)} {...props}>
								<settingsNav.icon />
								<span>{settingsNav.label}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
				<Sidebar.MenuItem>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Sidebar.MenuButton
									size="lg"
									{...props}
									class="h-11 gap-2.5 px-1.5 data-[state=open]:bg-sidebar-accent"
								>
									<span
										class="grid size-7 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[11px] font-semibold ring-1 ring-sidebar-border"
									>
										{initials(data.email)}
									</span>
									<span class="grid min-w-0 flex-1 leading-none">
										<span class="truncate text-[13px] font-medium">Admin</span>
										<span class="mt-1 truncate text-[11px] text-muted-foreground">{data.email}</span
										>
									</span>
									<ChevronsUpDown class="ml-auto size-3.5! text-muted-foreground" />
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content side="top" align="start" sideOffset={6} class="min-w-56">
							<DropdownMenu.Label class="truncate text-xs font-normal text-muted-foreground">
								{data.email}
							</DropdownMenu.Label>
							<DropdownMenu.Separator />
							<DropdownMenu.Item onSelect={toggleMode}>
								{#if mode.current === 'dark'}<Sun /> Light mode{:else}<Moon /> Dark mode{/if}
							</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => logoutForm?.requestSubmit()}>
								<LogOut /> Sign out
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>
		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset>
		{#if navigating.to}
			<!-- Page / month loading: indeterminate bar along the top. -->
			<div
				class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
				role="progressbar"
				aria-label="Loading"
			>
				<div class="nav-progress h-full w-1/3 bg-primary"></div>
			</div>
		{/if}
		<header
			class="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur"
		>
			<Sidebar.Trigger class="-ml-1 text-muted-foreground" />
			<div class="ml-auto">
				<SyncButton last={data.sync.last} lastDex={data.sync.lastDex} />
			</div>
			<div class="flex items-center rounded-lg border bg-card p-0.5 shadow-xs">
				<Button variant="ghost" size="icon-sm" href={monthHref(-1)} aria-label="Previous month">
					<ChevronLeft />
				</Button>
				<span class="flex min-w-36 items-center justify-center gap-1.5 text-sm font-medium">
					{#if navigating.to && navigating.to.url.searchParams.get('m') !== data.month}
						<LoaderCircle class="size-3.5 animate-spin text-muted-foreground" />
						{monthLabel(navigating.to.url.searchParams.get('m') ?? data.month)}
					{:else}
						{monthLabel(data.month)}
					{/if}
					{#if !navigating.to && data.month === currentMonth()}
						<span class="size-1.5 rounded-full bg-success" title="Current month"></span>
					{/if}
				</span>
				<Button variant="ghost" size="icon-sm" href={monthHref(1)} aria-label="Next month">
					<ChevronRight />
				</Button>
			</div>
		</header>
		<main
			class={[
				'mx-auto w-full max-w-7xl p-4 transition-opacity md:p-6',
				navigating.to ? 'pointer-events-none opacity-55 delay-150 duration-200' : 'duration-100'
			]}
			aria-busy={!!navigating.to}
		>
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
