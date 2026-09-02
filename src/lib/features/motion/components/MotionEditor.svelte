<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { check, createProject, demoProject, type Layer, type Project } from '../model';
	import { MotionSession } from '../session.svelte';
	import { loadMotion } from '../storage';
	import { fromTemplate } from '../templates';
	import { registerMotionTools } from '../webmcp';
	import { loadProjectFonts } from '../fonts';
	import { exportProject, importArtworkFiles, type ExportFormat } from '../project-files';
	import MotionInspector from './MotionInspector.svelte';
	import LayerPanel from './LayerPanel.svelte';
	import MotionStage from './MotionStage.svelte';
	import MotionToolbar from './MotionToolbar.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { X } from '@lucide/svelte';
	import MotionTimeline from './MotionTimeline.svelte';
	let { id }: { id: string } = $props();
	let session = $state<MotionSession | null>(null),
		loadError = $state(''),
		fontError = $state(''),
		busy = $state(false),
		exportProgress = $state<number | null>(null);
	let picker = $state<HTMLInputElement>() as HTMLInputElement;
	let sidebarOpen = $state(true);
	let activeTool = $state<'move' | 'pen'>('move');
	let timelineHeight = $state(254);
	let timelineExpanded = $state(false);
	let resizingTimeline = $state(false);

	// onMount runs only in the browser. Its returned function cleans up playback and WebMCP.
	onMount(() => {
		let closed = false,
			disposeTools = () => {},
			raf = 0,
			last = 0,
			accumulator = 0;
		(async () => {
			try {
				let p: Project | undefined;
				if (id === 'new') p = createProject();
				else if (id === 'demo') p = demoProject();
				else if (id.startsWith('template-')) p = fromTemplate(id.slice(9));
				else p = await loadMotion(id);
				check(p, 'Project not found on this device');
				if (closed) return;
				const s = new MotionSession(p);
				session = s;
				s.save();
				if (id === 'new' || id === 'demo' || id.startsWith('template-'))
					await goto(resolve('/motion/[id]', { id: p.id }), {
						replaceState: true,
						keepFocus: true,
						noScroll: true
					});
				if (closed) return;
				const cleanup = await registerMotionTools(s);
				if (closed) cleanup();
				else disposeTools = cleanup;
			} catch (e) {
				loadError = String(e);
			}
		})();
		function tick(now: number) {
			const s = session;
			if (s?.playing) {
				accumulator += Math.min(now - last, 100);
				const step = 1000 / s.project.composition.fps;
				if (accumulator >= step) {
					s.seek(
						(s.context.currentFrame + Math.floor(accumulator / step)) %
							s.project.composition.durationFrames
					);
					accumulator %= step;
				}
			} else accumulator = 0;
			last = now;
			raf = requestAnimationFrame(tick);
		}
		raf = requestAnimationFrame(tick);
		return () => {
			closed = true;
			cancelAnimationFrame(raf);
			disposeTools();
			session?.dispose();
		};
	});
	// $effect reruns when a referenced reactive value changes, here when the project changes.
	$effect(() => {
		const p = session?.project;
		if (!p) return;
		let active = true;
		loadProjectFonts(p.layers).catch((e) => {
			if (active) fontError = String(e);
		});
		return () => {
			active = false;
		};
	});
	function safe(fn: () => unknown) {
		try {
			fn();
			if (session) session.error = '';
		} catch (e) {
			if (session) session.error = String(e);
		}
	}
	function create(type: Layer['type']) {
		safe(() => {
			const result = session!.run('create_layer', { type }, `Created ${type}`);
			const created = result.data[0] as { layerId: string };
			session!.select([created.layerId]);
		});
	}
	function groupSelected() {
		const layerIds = session?.context.selectedLayerIds ?? [];
		if (layerIds.length < 2) return;
		safe(() => {
			const result = session!.run('group_layers', { layerIds }, 'Grouped layers');
			const group = result.data[0] as { layerId: string };
			session!.select([group.layerId]);
		});
	}
	async function imported(files: FileList | null) {
		if (!files || !session) return;
		busy = true;
		try {
			await importArtworkFiles(session, files);
		} catch (e) {
			session.error = String(e);
		} finally {
			busy = false;
			if (picker) picker.value = '';
		}
	}
	async function exportFile(format: ExportFormat) {
		const s = session;
		if (!s) return;
		busy = true;
		exportProgress = format === 'mp4' ? 0 : null;
		try {
			await exportProject(s, format, (progress) => (exportProgress = progress));
		} catch (e) {
			s.error = String(e);
		} finally {
			busy = false;
			exportProgress = null;
		}
	}
	function keyboard(e: KeyboardEvent) {
		if (
			!session ||
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement ||
			e.target instanceof HTMLSelectElement ||
			(e.target as HTMLElement)?.isContentEditable
		)
			return;
		if (activeTool === 'pen' && e.key === 'Enter') {
			e.preventDefault();
			window.dispatchEvent(new CustomEvent('motion:finish-pen'));
		} else if (activeTool === 'pen' && e.key === 'Escape') {
			e.preventDefault();
			window.dispatchEvent(new CustomEvent('motion:cancel-pen'));
			activeTool = 'move';
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			safe(() => (e.shiftKey ? session!.redo() : session!.undo()));
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
			e.preventDefault();
			groupSelected();
		} else if (e.code === 'Space') {
			e.preventDefault();
			session.playing = !session.playing;
		} else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
			e.preventDefault();
			const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
			safe(() =>
				session!.context.selectedKeyframeIds.length
					? session!.run('move_keyframes', {
							keyframeIds: session!.context.selectedKeyframeIds,
							frames: delta
						})
					: session!.seek(
							Math.max(
								0,
								Math.min(
									session!.project.composition.durationFrames - 1,
									session!.context.currentFrame + delta
								)
							)
						)
			);
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			safe(() => {
				if (session!.context.selectedKeyframeIds.length)
					session!.run('delete_keyframes', { keyframeIds: session!.context.selectedKeyframeIds });
				else if (session!.context.selectedLayerIds.length)
					session!.commit(
						session!.context.selectedLayerIds.map((layerId) => ({
							name: 'delete_layer',
							input: { layerId }
						})),
						'Deleted layers'
					);
			});
		}
	}
	function resizeTimeline(e: PointerEvent) {
		if (!resizingTimeline) return;
		timelineHeight = Math.max(
			180,
			Math.min(window.innerHeight - 140, window.innerHeight - e.clientY)
		);
		timelineExpanded = timelineHeight > window.innerHeight * 0.55;
	}
	function toggleTimelineView() {
		timelineExpanded = !timelineExpanded;
		timelineHeight = timelineExpanded ? Math.round(window.innerHeight * 0.75) : 254;
	}
</script>

<svelte:head><title>AniMCP — Motion studio</title></svelte:head>
<svelte:window
	onkeydown={keyboard}
	onpointermove={resizeTimeline}
	onpointerup={() => (resizingTimeline = false)}
	onpointercancel={() => (resizingTimeline = false)}
/>
{#if session}{@const s = session}
	<main class="studio dark">
		<Sidebar.Provider
			bind:open={sidebarOpen}
			class="editor-workspace"
			style="--sidebar-width:230px;--sidebar-width-icon:46px;"
			><LayerPanel session={s} open={sidebarOpen} />
			<section class="center" aria-label="Composition workspace">
				<div class="mobile-sidebar"><Sidebar.Trigger class="editor-icon" /></div>
				<MotionToolbar
					session={s}
					{busy}
					{activeTool}
					onToolChange={(tool) => (activeTool = tool)}
					onCreate={create}
					onGroup={groupSelected}
					onImport={() => picker.click()}
					onExport={(format) => void exportFile(format)}
					onUndo={() => safe(() => s.undo())}
					onRedo={() => safe(() => s.redo())}
				/>
				<input
					type="file"
					multiple
					accept="image/svg+xml,image/png,.svg,.png"
					bind:this={picker}
					onchange={(e) => imported(e.currentTarget.files)}
					hidden
				/>{#if s.error || fontError}<div class="notice" role="alert">
						<span>{s.error || fontError}</span><Button
							variant="ghost"
							size="icon-xs"
							aria-label="Dismiss error"
							onclick={() => {
								s.error = '';
								fontError = '';
							}}><X /></Button
						>
					</div>{/if}
				{#if exportProgress !== null}<div class="export-status" role="status" aria-live="polite">
						<span>Recording MP4</span>
						<strong>{Math.round(exportProgress * 100)}%</strong>
					</div>{/if}
				<MotionStage
					session={s}
					{activeTool}
					onToolChange={(tool) => (activeTool = tool)}
					onImport={(files) => void imported(files)}
				/>
			</section>
			<MotionInspector session={s} /></Sidebar.Provider
		>
		<button
			type="button"
			class="timeline-resizer"
			class:active={resizingTimeline}
			aria-label="Resize timeline and stage"
			onpointerdown={(event) => {
				event.preventDefault();
				resizingTimeline = true;
				(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			}}
			onkeydown={(event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				timelineHeight = Math.max(
					180,
					Math.min(window.innerHeight - 140, timelineHeight + (event.key === 'ArrowUp' ? 24 : -24))
				);
			}}
		>
			<span></span>
		</button>
		<MotionTimeline
			session={s}
			height={timelineHeight}
			expanded={timelineExpanded}
			resizing={resizingTimeline}
			onToggleView={toggleTimelineView}
		/>
	</main>{:else}<div class="loading">
		<a href={resolve('/')}>← AniMCP</a>
		<p>{loadError || 'Opening motion studio…'}</p>
	</div>{/if}

<style>
	:global(body) {
		margin: 0;
	}
	.studio {
		width: 100%;
		max-width: 100vw;
		height: 100dvh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: var(--ink);
		color: var(--paper);
		font: var(--type-label) / var(--leading-compact) var(--sans);
		color-scheme: dark;
		/* Keep the operating surfaces in the landing page's blue-gray palette. */
		--ink: #0d1522;
		--panel: #162337;
		--panel-raised: #1b2a3e;
		--line: #31445a;
		--line-bright: #496989;
		--acid: #8fcad8;
		--sidebar: var(--panel);
		--sidebar-foreground: var(--paper);
		--sidebar-border: var(--line);
		--primary: var(--acid);
		--primary-foreground: var(--acid-ink);
		--muted: var(--panel-raised);
		--muted-foreground: #a7b8cd;
		--accent: #20344c;
		--accent-foreground: var(--paper);
		--border: var(--line);
		--input: var(--line-bright);
		--ring: var(--acid);
	}
	:global(.editor-workspace) {
		position: relative !important;
		min-height: 0 !important;
		min-width: 0 !important;
		flex: 1 !important;
		overflow: hidden;
	}
	:global(.editor-sidebar) {
		position: absolute !important;
		height: 100% !important;
		border-color: var(--line) !important;
	}
	:global(.editor-workspace [data-slot='sidebar-gap']) {
		height: 100%;
	}
	:global(.editor-workspace [data-slot='sidebar-inner']) {
		background: var(--panel) !important;
	}
	:global(.editor-icon) {
		width: 30px !important;
		height: 30px !important;
		min-width: 30px;
		padding: 6px !important;
		border: 0 !important;
		border-radius: 6px !important;
		background: transparent;
		color: var(--muted-foreground) !important;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: none !important;
	}
	:global(.editor-icon svg) {
		width: 16px;
		height: 16px;
	}
	:global(.editor-icon:hover) {
		background: var(--panel-raised) !important;
		color: var(--paper) !important;
	}
	:global(.editor-icon:disabled) {
		opacity: 0.3;
		cursor: default;
	}
	:global(.editor-icon.tool-active) {
		background: var(--accent) !important;
		color: var(--acid) !important;
	}
	.center {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background-color: var(--ink);
		background-image: radial-gradient(#49698932 0.7px, transparent 0.7px);
		background-size: 16px 16px;
	}
	.timeline-resizer {
		position: relative;
		z-index: 20;
		height: 7px;
		min-height: 7px;
		margin-top: -3px;
		cursor: ns-resize;
		background: transparent;
		border: 0;
		padding: 0;
		touch-action: none;
	}
	.timeline-resizer::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 3px;
		height: 1px;
		background: var(--line);
		transition: background 140ms ease-out;
	}
	.timeline-resizer span {
		position: absolute;
		left: 50%;
		top: 1px;
		width: 42px;
		height: 5px;
		transform: translateX(-50%);
		border-radius: 3px;
		background: var(--line-bright);
		opacity: 0;
		transition: opacity 140ms ease-out;
	}
	.timeline-resizer:hover span,
	.timeline-resizer:focus-visible span,
	.timeline-resizer.active span {
		opacity: 1;
	}
	.timeline-resizer:hover::before,
	.timeline-resizer.active::before {
		background: var(--acid);
	}
	.timeline-resizer:focus-visible {
		outline: 2px solid var(--acid);
		outline-offset: -2px;
	}
	.notice {
		position: absolute;
		z-index: 10;
		left: 16px;
		right: 16px;
		top: 69px;
		display: flex;
		gap: 10px;
		align-items: center;
		background: #4b3529;
		color: #f1c19a;
		border: 1px solid #735039;
		border-radius: 6px;
		padding: 7px 10px;
		font-size: var(--type-label);
		line-height: 1.6;
	}
	.export-status {
		position: absolute;
		z-index: 10;
		right: 16px;
		top: 16px;
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--line-bright);
		border-radius: 6px;
		background: var(--panel);
		color: var(--paper);
		padding: 7px 10px;
		font-size: var(--type-label);
		box-shadow: 0 8px 24px #0005;
	}
	.export-status strong {
		color: var(--acid);
		font-variant-numeric: tabular-nums;
	}
	.notice span {
		flex: 1;
	}
	.notice :global(button) {
		color: #f1c19a;
	}
	.mobile-sidebar {
		display: none;
	}
	.loading {
		padding: 40px;
		color: var(--acid);
		background: var(--ink);
		min-height: 100vh;
	}
	:global(.studio *) {
		scrollbar-width: thin;
		scrollbar-color: var(--line-bright) var(--panel);
	}
	:global(.studio ::-webkit-scrollbar) {
		width: 8px;
		height: 8px;
	}
	:global(.studio ::-webkit-scrollbar-track) {
		background: var(--panel);
	}
	:global(.studio ::-webkit-scrollbar-thumb) {
		background: var(--line-bright);
		border-radius: 8px;
		border: 2px solid var(--panel);
	}
	:global(.studio ::-webkit-scrollbar-corner) {
		background: var(--panel);
	}
	@media (max-width: 767px) {
		.mobile-sidebar {
			display: block;
			position: absolute;
			top: 12px;
			left: 8px;
			z-index: 12;
		}
		.notice {
			top: 94px;
		}
		.export-status {
			top: 50px;
		}
	}
</style>
