<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { check, createProject, demoProject, value, type Layer, type Project } from './model';
	import { MotionSession } from './session.svelte';
	import { loadMotion } from './storage';
	import { fromTemplate } from './templates';
	import { createMotionTools, registerMotionTools } from './webmcp';
	import { importArtwork } from './assets';
	import { download, exportSvg, layerSvg, transform } from './render';
	import { loadProjectFonts } from './fonts';
	import { exportLottie } from './lottie';
	import MotionInspector from './MotionInspector.svelte';
	import LayerPanel from './LayerPanel.svelte';
	import { propertyEdits, previewLayer } from './editing';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import {
		Move,
		Square,
		Circle,
		Type,
		Import,
		Undo2,
		Redo2,
		Bot,
		Download,
		X
	} from '@lucide/svelte';
	import GradientHandles from './GradientHandles.svelte';
	import MotionTimeline from './MotionTimeline.svelte';
	import WebMcpToolCatalog from './WebMcpToolCatalog.svelte';
	let { id }: { id: string } = $props();
	let session = $state<MotionSession | null>(null),
		loadError = $state(''),
		fontError = $state(''),
		busy = $state(false);
	let picker = $state<HTMLInputElement>() as HTMLInputElement;
	let stage = $state<SVGSVGElement>() as SVGSVGElement;
	let sidebarOpen = $state(true);
	let dragging = $state<{
		id: string;
		startX: number;
		startY: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		revision: number;
		frame: number;
	} | null>(null);
	const selected = $derived(
		session?.project.layers.find((l) => l.id === session?.context.selectedLayerIds[0])
	);
	const webmcpTools = $derived(session ? createMotionTools(session) : []);
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
					await goto(`/motion/${p.id}`, { replaceState: true, keepFocus: true, noScroll: true });
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
	async function imported(files: FileList | null) {
		if (!files || !session) return;
		busy = true;
		try {
			const s = session,
				revision = s.project.revision;
			const assets = await Promise.all([...files].map(importArtwork));
			const result = s.commit(
				assets.map((asset) => ({ name: 'import_asset', input: { asset } })),
				'Imported artwork',
				'human',
				revision
			);
			s.select(result.data.map((d) => (d as { layerId: string }).layerId));
		} catch (e) {
			session.error = String(e);
		} finally {
			busy = false;
			if (picker) picker.value = '';
		}
	}
	async function exportFile(format: string) {
		const s = session;
		if (!s) return;
		busy = true;
		try {
			const p = structuredClone(s.project),
				name = p.name.replace(/[^a-z0-9_-]/gi, '_');
			if (format === 'native') {
				const text = JSON.stringify(p, null, 2);
				check(new Blob([text]).size <= 50 * 1024 * 1024, 'Project exceeds 50 MiB export limit');
				download(text, `${name}.animcp.json`);
			} else {
				await loadProjectFonts(p.layers);
				if (format === 'svg') {
					download(exportSvg(p, s.context.currentFrame), `${name}.svg`, 'image/svg+xml');
					if (
						p.layers.some(
							(l) =>
								l.type === 'text' && !['sans-serif', 'serif', 'monospace'].includes(l.fontFamily)
						)
					)
						s.error =
							'SVG exported with live text. Other devices need the referenced Google Fonts.';
				} else download(JSON.stringify(await exportLottie(p)), `${name}.lottie.json`);
			}
		} catch (e) {
			s.error = String(e);
		} finally {
			busy = false;
		}
	}
	function point(e: PointerEvent) {
		const p = stage.createSVGPoint();
		p.x = e.clientX;
		p.y = e.clientY;
		return p.matrixTransform(stage.getScreenCTM()!.inverse());
	}
	function startDrag(e: PointerEvent, l: Layer) {
		if (!session || l.locked) return;
		e.stopPropagation();
		const p = point(e);
		session.playing = false;
		if (e.shiftKey) {
			const ids = session.context.selectedLayerIds;
			session.select(ids.includes(l.id) ? ids.filter((id) => id !== l.id) : [...ids, l.id]);
			return;
		}
		session.select([l.id]);
		const f = session.context.currentFrame;
		dragging = {
			id: l.id,
			startX: p.x,
			startY: p.y,
			x: value(l, 'positionX', f),
			y: value(l, 'positionY', f),
			dx: 0,
			dy: 0,
			revision: session.project.revision,
			frame: f
		};
		stage.setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		const p = point(e);
		dragging = { ...dragging, dx: p.x - dragging.startX, dy: p.y - dragging.startY };
	}
	function finish() {
		const d = dragging;
		dragging = null;
		if (!d || !session || Math.abs(d.dx) + Math.abs(d.dy) < 0.1) return;
		safe(() => {
			const l = session!.project.layers.find((l) => l.id === d.id)!;
			session!.commit(
				propertyEdits(
					l,
					{ positionX: d.x + d.dx, positionY: d.y + d.dy },
					d.frame,
					session!.autoKey
				),
				'Moved layer',
				'human',
				d.revision
			);
		});
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
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			safe(() => (e.shiftKey ? session!.redo() : session!.undo()));
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
</script>

<svelte:head><title>AniMCP — Motion studio</title></svelte:head>
<svelte:window onkeydown={keyboard} />
{#if session}{@const s = session}{@const p = s.project}{@const f = s.context.currentFrame}
	<main class="studio dark">
		<Sidebar.Provider
			bind:open={sidebarOpen}
			class="editor-workspace"
			style="--sidebar-width:230px;--sidebar-width-icon:46px;"
			><LayerPanel session={s} open={sidebarOpen} />
			<section class="center" aria-label="Composition workspace">
				<div class="mobile-sidebar"><Sidebar.Trigger class="editor-icon" /></div>
				<div class="floating-toolbar" role="toolbar" aria-label="Drawing tools">
					<Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon tool-active"
						aria-label="Move tool"
						title="Move / select · drag layers on canvas"
						onclick={() => s.select(s.context.selectedLayerIds)}><Move /></Button
					><span class="tool-divider"></span><Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon"
						aria-label="Rectangle"
						title="Rectangle"
						onclick={() => create('rectangle')}><Square /></Button
					><Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon"
						aria-label="Ellipse"
						title="Ellipse"
						onclick={() => create('ellipse')}><Circle /></Button
					><Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon"
						aria-label="Text"
						title="Text"
						onclick={() => create('text')}><Type /></Button
					><Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon"
						aria-label="Import SVG or PNG"
						title="Import SVG / PNG"
						disabled={busy}
						onclick={() => picker.click()}><Import /></Button
					><span class="tool-divider"></span><Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon"
						aria-label="Undo"
						title="Undo · Ctrl+Z"
						disabled={!s.history.length}
						onclick={() => safe(() => s.undo())}><Undo2 /></Button
					><Button
						variant="ghost"
						size="icon-sm"
						class="editor-icon"
						aria-label="Redo"
						title="Redo · Ctrl+Shift+Z"
						disabled={!s.future.length}
						onclick={() => safe(() => s.redo())}><Redo2 /></Button
					><span class="tool-divider"></span><Popover.Root
						><Popover.Trigger
							class="editor-icon webmcp-trigger"
							aria-label="WebMCP"
							title="WebMCP agent connection"
							><Bot size={17} /><i
								class:connected={s.webmcp.includes('registered') || s.webmcp.includes('ready')}
							></i></Popover.Trigger
						><Popover.Content class="motion-popover webmcp-popover" sideOffset={12}
							><p class="webmcp-status">{s.webmcp}</p>
							<WebMcpToolCatalog tools={webmcpTools} /></Popover.Content
						></Popover.Root
					><Popover.Root
						><Popover.Trigger class="editor-icon" aria-label="Export" title="Export"
							><Download size={16} /></Popover.Trigger
						><Popover.Content class="motion-popover export-menu" align="end" sideOffset={12}
							><div class="popover-heading">Export composition</div>
							<Button variant="ghost" disabled={busy} onclick={() => exportFile('native')}
								>Native project · all assets</Button
							><Button variant="ghost" disabled={busy} onclick={() => exportFile('svg')}
								>Current frame · SVG</Button
							><Button variant="ghost" disabled={busy} onclick={() => exportFile('lottie')}
								>Lottie animation</Button
							><small
								>Text and SVG are rasterized in Lottie. Native projects preserve all editable
								properties.</small
							></Popover.Content
						></Popover.Root
					>
				</div>
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
				<div
					class="stage-wrap"
					role="region"
					aria-label="Canvas artwork drop zone"
					ondragover={(e) => e.preventDefault()}
					ondrop={(e) => {
						e.preventDefault();
						if (e.dataTransfer?.files.length) void imported(e.dataTransfer.files);
					}}
				>
					<svg
						class="stage"
						bind:this={stage}
						viewBox={`0 0 ${p.composition.width} ${p.composition.height}`}
						style:background={p.composition.background}
						role="img"
						aria-label="Animation canvas"
						onpointermove={move}
						onpointerup={finish}
						onpointercancel={() => (dragging = null)}
						><title>Motion composition</title
						>{#each p.layers.filter((l) => l.visible) as raw (raw.id)}{@const l = previewLayer(
								raw,
								s.preview
							)}<g
								role="button"
								tabindex="0"
								aria-label={`Select ${l.name}`}
								onpointerdown={(e) => startDrag(e, raw)}
								onkeydown={(e) => {
									if (e.key === 'Enter') s.select([l.id]);
								}}
								transform={dragging?.id === l.id
									? `translate(${dragging.dx} ${dragging.dy})`
									: undefined}>{@html layerSvg(p, l, f)}</g
							>{/each}{#each p.layers.filter((l) => s.context.selectedLayerIds.includes(l.id) && l.visible) as raw}{@const l =
								previewLayer(raw, s.preview)}<g
								pointer-events="none"
								transform={dragging?.id === l.id
									? `translate(${dragging.dx} ${dragging.dy})`
									: undefined}
								><rect
									transform={transform(l, f)}
									width={Math.max(0.001, value(l, 'width', f))}
									height={Math.max(0.001, value(l, 'height', f))}
									fill="none"
									stroke="#cfeaa9"
									stroke-width="1"
									vector-effect="non-scaling-stroke"
								/></g
							>{/each}{#if selected && selected.paint.type !== 'solid' && !selected.locked && selected.visible}<GradientHandles
								session={s}
								layer={selected}
							/>{/if}</svg
					>
				</div>
				<div class="canvas-meta">
					<span>{p.composition.width} × {p.composition.height}</span><span
						>{(p.composition.durationFrames / p.composition.fps).toFixed(1)}s · {p.composition.fps} fps</span
					>
				</div>
			</section>
			<MotionInspector session={s} /></Sidebar.Provider
		><MotionTimeline session={s} />
	</main>{:else}<div class="loading">
		<a href="/">← AniMCP</a>
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
		background: #121820;
		color: #d2dde9;
		font:
			12px Inter,
			system-ui,
			sans-serif;
		color-scheme: dark;
		--sidebar: #1a1f27;
		--sidebar-foreground: #c2cddb;
		--sidebar-border: #303640;
		--primary: #cce5a7;
		--primary-foreground: #1c2419;
		--muted: #2a333f;
		--muted-foreground: #8c9db2;
		--accent: #303c31;
		--accent-foreground: #d6e8bf;
		--border: #34404e;
		--input: #3a4654;
		--ring: #afc98f;
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
		border-color: #303640 !important;
	}
	:global(.editor-workspace [data-slot='sidebar-gap']) {
		height: 100%;
	}
	:global(.editor-workspace [data-slot='sidebar-inner']) {
		background: #1a1f27 !important;
	}
	:global(.editor-icon) {
		width: 30px !important;
		height: 30px !important;
		min-width: 30px;
		padding: 6px !important;
		border: 0 !important;
		border-radius: 6px !important;
		background: transparent;
		color: #93a3b7 !important;
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
		background: #303a47 !important;
		color: #e3ecd9 !important;
	}
	:global(.editor-icon:disabled) {
		opacity: 0.3;
		cursor: default;
	}
	:global(.editor-icon.tool-active) {
		background: #3b4932 !important;
		color: #d7ecb6 !important;
	}
	.center {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background-color: #121820;
		background-image: radial-gradient(#53647b32 0.7px, transparent 0.7px);
		background-size: 16px 16px;
	}
	.floating-toolbar {
		position: absolute;
		z-index: 9;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		padding: 5px;
		display: flex;
		align-items: center;
		gap: 2px;
		background: #202732f2;
		border: 1px solid #3c4654;
		border-radius: 10px;
		box-shadow: 0 6px 22px #0005;
		white-space: nowrap;
		max-width: calc(100% - 20px);
	}
	.tool-divider {
		height: 17px;
		width: 1px;
		background: #3a4553;
		margin: 0 3px;
	}
	.floating-toolbar :global(.webmcp-trigger) {
		position: relative;
	}
	.floating-toolbar :global(.webmcp-trigger i) {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #d7bb6e;
		position: absolute;
		right: 4px;
		bottom: 4px;
	}
	.floating-toolbar :global(.webmcp-trigger i.connected) {
		background: #bde28e;
	}
	.stage-wrap {
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
		align-items: center;
		justify-content: center;
		padding: 82px 34px 24px;
		overflow: hidden;
	}
	.stage {
		width: 100%;
		height: 100%;
		max-height: 100%;
		min-height: 0;
		box-shadow: 0 18px 55px #0005;
		touch-action: none;
	}
	.stage :global(g[role='button']) {
		cursor: move;
	}
	.canvas-meta {
		height: 26px;
		min-height: 26px;
		display: flex;
		justify-content: space-between;
		padding: 0 18px;
		align-items: center;
		font: 9px monospace;
		color: #5f738c;
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
		font-size: 10px;
		line-height: 1.6;
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
		color: #dfffaf;
		background: #141b24;
		min-height: 100vh;
	}
	:global(.motion-popover) {
		background: #202833 !important;
		color: #c4d0df !important;
		border: 1px solid #3a4758 !important;
		border-radius: 9px !important;
		box-shadow: 0 10px 35px #0007 !important;
		font-family: Inter, system-ui, sans-serif;
		color-scheme: dark;
	}
	:global(.motion-popover .popover-heading) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #dfebcf;
	}
	:global(.motion-popover .popover-text) {
		font-size: 11px;
		line-height: 1.7;
		color: #93a8c1;
		margin: 0;
	}
	:global(.motion-popover.webmcp-popover) {
		width: min(390px, calc(100vw - 24px));
		gap: 9px;
		padding: 12px;
	}
	.webmcp-status {
		margin: 0;
		color: #94ab78;
		font:
			10px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
	:global(.motion-popover.export-menu) {
		gap: 4px;
	}
	:global(.export-menu button) {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		font-size: 11px;
		justify-content: flex-start;
		border-radius: 5px;
		color: #b6c8dd;
	}
	:global(.export-menu small) {
		font-size: 9px;
		line-height: 1.6;
		color: #8197b2;
		margin-top: 8px;
	}
	:global(.studio *),
	:global(.motion-popover),
	:global(.motion-popover *) {
		scrollbar-width: thin;
		scrollbar-color: #465365 #181e27;
	}
	:global(.studio ::-webkit-scrollbar),
	:global(.motion-popover ::-webkit-scrollbar) {
		width: 8px;
		height: 8px;
	}
	:global(.studio ::-webkit-scrollbar-track),
	:global(.motion-popover ::-webkit-scrollbar-track) {
		background: #181e27;
	}
	:global(.studio ::-webkit-scrollbar-thumb),
	:global(.motion-popover ::-webkit-scrollbar-thumb) {
		background: #465365;
		border-radius: 8px;
		border: 2px solid #181e27;
	}
	:global(.studio ::-webkit-scrollbar-corner) {
		background: #181e27;
	}
	@media (max-width: 1000px) {
		.stage-wrap {
			padding: 76px 20px 20px;
		}
		.floating-toolbar {
			gap: 0;
			padding: 4px;
		}
		.tool-divider {
			margin: 0 1px;
		}
		.floating-toolbar :global(.editor-icon) {
			width: 27px !important;
			min-width: 27px;
		}
	}
	@media (max-width: 767px) {
		.mobile-sidebar {
			display: block;
			position: absolute;
			top: 12px;
			left: 8px;
			z-index: 12;
		}
		.floating-toolbar {
			top: 50px;
			max-width: calc(100% - 8px);
			overflow-x: auto;
		}
		.stage-wrap {
			padding-top: 104px;
		}
		.notice {
			top: 94px;
		}
	}
</style>
