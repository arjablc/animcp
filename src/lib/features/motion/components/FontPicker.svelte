<script lang="ts">
	import { onMount } from 'svelte';
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { ChevronsUpDown, Search, Check, LoaderCircle } from '@lucide/svelte';
	import { catalog, loadFont, type FontFamily } from '../fonts';
	import type { Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	let { session, layer }: { session: MotionSession; layer: Layer } = $props();
	let open = $state(false),
		query = $state(''),
		fonts = $state<FontFamily[]>([]),
		busy = $state(false),
		error = $state('');
	const popular = [
		'Inter',
		'Roboto',
		'Open Sans',
		'Lato',
		'Montserrat',
		'Poppins',
		'DM Sans',
		'Manrope',
		'Outfit',
		'Space Grotesk',
		'Playfair Display',
		'Lora',
		'Merriweather',
		'Bebas Neue',
		'Oswald',
		'Fira Code'
	];
	const matches = $derived(
		query.trim()
			? fonts
					.filter((f) => f.family.toLowerCase().includes(query.trim().toLowerCase()))
					.slice(0, 80)
					.map((f) => f.family)
			: popular
	);
	onMount(() => {
		let alive = true;
		catalog()
			.then((f) => {
				if (alive) fonts = f;
			})
			.catch((e) => {
				if (alive) error = String(e);
			});
		return () => {
			alive = false;
		};
	});
	async function choose(family: string) {
		if (busy) return;
		const s = session,
			l = layer,
			revision = s.project.revision;
		busy = true;
		error = '';
		try {
			const font = fonts.find((f) => f.family === family),
				weight = font?.weights.includes(l.fontWeight) ? l.fontWeight : (font?.weights[0] ?? 400);
			await loadFont(family, weight, 'normal', l.text);
			s.commit(
				[
					{
						name: 'set_layer',
						input: {
							layerId: l.id,
							changes: { fontFamily: family, fontWeight: weight, fontStyle: 'normal' }
						}
					}
				],
				'Changed font',
				'human',
				revision
			);
			open = false;
			query = '';
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<Popover.Root bind:open
	><Popover.Trigger class="font-trigger" aria-label="Font family" disabled={layer.locked}
		><span>{layer.fontFamily}</span><ChevronsUpDown size={13} /></Popover.Trigger
	><Popover.Content class="motion-popover font-popover" align="end" sideOffset={8}
		><div class="font-search">
			<Search size={14} /><Input
				aria-label="Search Google Fonts"
				placeholder="Search all Google Fonts…"
				bind:value={query}
			/>
		</div>
		<div class="font-list" role="listbox" aria-label="Google Fonts">
			{#each matches as family}<button
					role="option"
					aria-selected={family === layer.fontFamily}
					disabled={busy}
					onclick={() => choose(family)}
					>{family}{#if family === layer.fontFamily}<Check size={13} />{/if}</button
				>{/each}{#if query.trim() && !matches.some((f) => f.toLowerCase() === query
							.trim()
							.toLowerCase())}<button
					role="option"
					aria-selected="false"
					disabled={busy}
					onclick={() => choose(query.trim())}>Load “{query.trim()}”</button
				>{/if}
		</div>
		<small
			>{#if busy}<LoaderCircle size={12} class="animate-spin" /> Loading font…{:else}{query
					? 'Search results'
					: 'Popular families · 16 fonts'} · loaded on demand{/if}</small
		>{#if error}<p role="alert">{error}</p>{/if}</Popover.Content
	></Popover.Root
>

<style>
	:global(.font-trigger) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid #333c48;
		border-radius: 6px;
		background: #232a34;
		color: #e0e8f0;
		font-size: var(--type-label);
		cursor: pointer;
	}
	:global(.font-popover) {
		width: 280px;
		gap: 8px !important;
		padding: 10px !important;
	}
	.font-search {
		display: flex;
		align-items: center;
		gap: 7px;
		color: #8495ac;
	}
	.font-search :global(input) {
		background: #252c37;
		border: 0;
		border-radius: 5px;
		height: 32px;
		font-size: var(--type-label);
		box-shadow: none;
		color: #e2e8f0;
	}
	.font-list {
		max-height: 280px;
		overflow-y: auto;
	}
	.font-list button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: #c8d2df;
		text-align: left;
		font-size: var(--type-control);
		cursor: pointer;
	}
	.font-list button:hover,
	.font-list button[aria-selected='true'] {
		background: #303c2f;
		color: #d6efae;
	}
	.font-list button:disabled {
		opacity: 0.5;
	}
	small {
		display: flex;
		gap: 5px;
		align-items: center;
		font-size: var(--type-meta);
		color: #8b9aaf;
	}
	p {
		font-size: var(--type-label);
		color: #efb08a;
	}
</style>
