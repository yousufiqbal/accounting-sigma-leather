<script lang="ts">
	import { page } from '$app/state';
	import { toggleMode } from 'mode-watcher';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { nav } from '#lib/nav.js';
	import { monthLabel, shiftMonth } from '#lib/month.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/** Same path, different month — keeps the month picker global. */
	function monthHref(delta: number) {
		const params = new URLSearchParams(page.url.searchParams.toString());
		params.set('m', shiftMonth(data.month, delta));
		return `${page.url.pathname}?${params}`;
	}

	/** Nav links carry the selected month along. */
	function navHref(href: string) {
		return `${href}?m=${data.month}`;
	}

	function isActive(href: string) {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header>
			<div class="flex items-center gap-2 px-2 py-1.5">
				<div
					class="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
				>
					S
				</div>
				<div class="grid leading-tight group-data-[collapsible=icon]:hidden">
					<span class="text-sm font-semibold">Sigma Leather</span>
					<span class="text-xs text-muted-foreground">Accounts</span>
				</div>
			</div>
		</Sidebar.Header>
		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.Menu>
					{#each nav as item (item.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={item.label}>
								{#snippet child({ props })}
									<a href={navHref(item.href)} {...props}>
										<item.icon />
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.Group>
		</Sidebar.Content>
		<Sidebar.Footer>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<form method="POST" action="/logout">
						<Sidebar.MenuButton tooltipContent="Sign out">
							{#snippet child({ props })}
								<button type="submit" {...props}>
									<LogOut />
									<span>Sign out</span>
								</button>
							{/snippet}
						</Sidebar.MenuButton>
					</form>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>
		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset>
		<header
			class="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur"
		>
			<Sidebar.Trigger class="-ml-1" />
			<div class="ml-auto flex items-center gap-1">
				<Button variant="ghost" size="icon-sm" href={monthHref(-1)} aria-label="Previous month">
					<ChevronLeft />
				</Button>
				<span class="min-w-32 text-center text-sm font-medium">{monthLabel(data.month)}</span>
				<Button variant="ghost" size="icon-sm" href={monthHref(1)} aria-label="Next month">
					<ChevronRight />
				</Button>
				<Button variant="ghost" size="icon-sm" onclick={toggleMode} aria-label="Toggle theme">
					<Sun class="dark:hidden" />
					<Moon class="hidden dark:block" />
				</Button>
			</div>
		</header>
		<main class="mx-auto w-full max-w-7xl p-4 md:p-6">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
