<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		MousePointer2,
		Pencil,
		PenTool,
		Hand,
		Plus,
		Play,
		Pause,
		RotateCcw,
		Undo2,
		Redo2,
		Download,
		ChevronLeft,
		Eye,
		EyeOff,
		Lock,
		Unlock,
		Trash2,
		ArrowUp,
		ArrowDown,
		Upload,
		ZoomIn,
		ZoomOut,
		Maximize,
		X
	} from '@lucide/svelte';
	import FabricCanvas from '../canvas/FabricCanvas.svelte';
	import Timeline from '../timeline/Timeline.svelte';
	import { VectorSession } from '../animation/state.svelte';
	import { takeDraft } from '../animation/drafts';
	import {
		identityTransform,
		type ShapeKeyframe,
		type PathData,
		type Transform,
		type LayerStyle,
		type AssetRecord
	} from '../animation/model';
	import { evaluateLayer } from '../animation/interpolation';
	import { loadProject, putAsset, getAsset, deleteAsset } from '../persistence/vector-storage';
	import { projectBlob, exportSvg, exportLottie, downloadBlob } from '../export/vector';
	import { registerVectorTools } from '../webmcp/vector-tools';
	import { prepareRasterAsset, decodeBase64Asset } from '../assets/raster';
	import { traceRaster } from '../assets/trace';
	import AssetThumbnail from '../assets/AssetThumbnail.svelte';

	let { id } = $props<{ id: string }>();
	let session = $state<VectorSession>();
	let loadError = $state('');
	let assetPicker = $state<HTMLInputElement>(null!);
	let canvasView = $state<FabricCanvas>();
	let exportOpen = $state(false);
	let sidebarTab = $state<'layers' | 'assets'>('layers');
	let tracing = $state(false);
	let traceProgress = $state(0);
	let traceController: AbortController | undefined;
	let pointIndex = $state(0);
	const selected = $derived(session?.selectedLayer);
	const snapshot = $derived(
		selected && session
			? evaluateLayer({ ...selected, visible: true }, session.currentFrame)
			: undefined
	);
	const point = $derived(
		snapshot?.paths[0]?.[Math.min(pointIndex, (snapshot?.paths[0]?.length ?? 1) - 1)]
	);
	const tools = [
		{ id: 'select' as const, icon: MousePointer2, label: 'Select (V)' },
		{ id: 'pencil' as const, icon: Pencil, label: 'Pencil (B)' },
		{ id: 'pen' as const, icon: PenTool, label: 'Pen / edit path (P)' },
		{ id: 'hand' as const, icon: Hand, label: 'Pan (H)' }
	];
	function report(error: unknown) {
		const text = error instanceof Error ? error.message : String(error);
		if (session) session.error = text;
		else loadError = text;
	}
	function safe(action: () => unknown) {
		try {
			const result = action();
			if (result instanceof Promise) void result.catch(report);
		} catch (error) {
			report(error);
		}
	}
	function command(name: string, input: Record<string, unknown> = {}) {
		session!.playing = false;
		return session!.execute(name, input);
	}
	function selectTool(tool: VectorSession['tool']) {
		session!.tool = tool;
		session!.playing = false;
	}
	function createPath(paths: PathData[]) {
		const result = command('add_layer', {
			name: `Path ${session!.project.layers.length + 1}`,
			paths,
			frame: session!.currentFrame,
			style: { stroke: session!.stroke, strokeWidth: session!.strokeWidth }
		});
		session!.select(result.changed[0]);
	}
	function updateShape(changes: Partial<ShapeKeyframe>, layerId = selected?.id) {
		if (!layerId || !session) return;
		const layer = session.project.layers.find((l) => l.id === layerId)!;
		const value = evaluateLayer({ ...layer, visible: true }, session.currentFrame);
		if (!value) throw new Error('Create a path at this frame first.');
		const next = { ...value, ...changes };
		command(layer.keyframes[session.currentFrame] ? 'update_keyframe' : 'add_keyframe', {
			layerId,
			frame: session.currentFrame,
			paths: next.paths,
			transform: next.transform,
			easing: next.easing,
			opacity: next.opacity ?? 1
		});
	}
	function setTransform(key: keyof Transform, value: number) {
		if (snapshot) updateShape({ transform: { ...snapshot.transform, [key]: value } });
	}
	function setStyle(style: Partial<LayerStyle>) {
		if (selected) command('set_layer_style', { layerId: selected.id, style });
	}
	function addKeyframe() {
		if (selected) command('add_keyframe', { layerId: selected.id, frame: session!.currentFrame });
	}
	function deleteKeyframe() {
		if (selected)
			command('delete_keyframe', { layerId: selected.id, frame: session!.currentFrame });
	}
	function removeLayer() {
		if (selected) command('remove_layer', { layerId: selected.id });
	}
	function reorder(direction: number) {
		if (!selected || !session) return;
		const ordered = [...session.project.layers].sort((a, b) => a.zIndex - b.zIndex);
		command('reorder_layer', {
			layerId: selected.id,
			zIndex: Math.max(
				0,
				Math.min(ordered.length - 1, ordered.findIndex((l) => l.id === selected.id) + direction)
			)
		});
	}
	function editPoint(field: string, value: number) {
		if (!snapshot) return;
		const paths = structuredClone(snapshot.paths);
		const command = paths[0][pointIndex];
		if (!command || command.type === 'Z' || !Object.hasOwn(command, field)) return;
		Object.assign(command, { [field]: value });
		updateShape({ paths });
	}
	function addPoint() {
		if (!snapshot) return;
		const paths = structuredClone(snapshot.paths);
		const path = paths[0];
		const at = path.at(-1)?.type === 'Z' ? path.length - 1 : path.length;
		const last = path[at - 1];
		if (!last || last.type === 'Z') return;
		path.splice(at, 0, {
			type: 'C',
			x1: last.x + 20,
			y1: last.y,
			x2: last.x + 40,
			y2: last.y + 20,
			x: last.x + 60,
			y: last.y
		});
		updateShape({ paths });
		pointIndex = at;
	}
	function deletePoint() {
		if (!snapshot || !point || point.type === 'Z') return;
		if (!confirm(`Delete path point ${pointIndex}? You can undo this edit.`)) return;
		const paths = structuredClone(snapshot.paths);
		const path = paths[0];
		if (path.length <= 2)
			throw new Error('A path needs at least two points. Delete the layer instead.');
		const removed = path.splice(pointIndex, 1)[0];
		if (removed.type === 'M') {
			const next = path[pointIndex];
			if (!next || next.type === 'Z') throw new Error('Cannot leave an empty subpath.');
			path[pointIndex] = { type: 'M', x: next.x, y: next.y };
		}
		updateShape({ paths });
		pointIndex = Math.max(0, pointIndex - 1);
	}
	function exportFile(format: 'project' | 'svg' | 'lottie') {
		const s = session!;
		const name = s.project.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 100) || 'animation';
		const blob =
			format === 'project'
				? projectBlob(s.project)
				: format === 'svg'
					? new Blob([exportSvg(s.project, s.currentFrame)], { type: 'image/svg+xml' })
					: new Blob([JSON.stringify(exportLottie(s.project))], { type: 'application/json' });
		downloadBlob(
			blob,
			`${name}.${format === 'project' ? 'animcp.json' : format === 'svg' ? 'svg' : 'lottie.json'}`
		);
		exportOpen = false;
		return { format, bytes: blob.size, revision: s.project.revision };
	}
	async function importBlob(
		blob: Blob,
		name: string,
		source: 'file' | 'webmcp',
		expectedRevision = session!.project.revision
	) {
		const s = session!;
		const prepared = await prepareRasterAsset(blob, name, source);
		await putAsset(s.project.id, prepared.asset.id, prepared.blob);
		try {
			s.execute('add_asset', { asset: prepared.asset }, expectedRevision);
		} catch (error) {
			await deleteAsset(s.project.id, prepared.asset.id);
			throw error;
		}
		sidebarTab = 'assets';
		return {
			assetId: prepared.asset.id,
			width: prepared.asset.width,
			height: prepared.asset.height,
			revision: s.project.revision
		};
	}
	async function importFile(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (file) await importBlob(file, file.name, 'file');
		assetPicker.value = '';
	}
	async function traceAsset(asset: AssetRecord, expectedRevision = session!.project.revision) {
		if (tracing) throw new Error('A trace is already running.');
		const s = session!;
		traceController = new AbortController();
		tracing = true;
		traceProgress = 0;
		try {
			const blob = await getAsset(s.project.id, asset.id);
			if (!blob) throw new Error('Source image is not on this device. Import it again to trace.');
			const paths = await traceRaster(blob, {}, traceController.signal, (value) => {
				traceProgress = value;
			});
			const scale =
				Math.min(s.project.canvas.width / asset.width, s.project.canvas.height / asset.height) *
				0.7;
			const result = s.execute(
				'add_layer',
				{
					name: `${asset.name.slice(0, 180)} trace`,
					paths: [paths],
					frame: s.currentFrame,
					transform: { ...identityTransform(), scaleX: scale, scaleY: scale, x: 40, y: 40 },
					style: { stroke: '#dfff4f', strokeWidth: 0, fill: '#dfff4f' }
				},
				expectedRevision
			);
			s.select(result.changed[0]);
			sidebarTab = 'layers';
			return { layerId: result.changed[0], revision: result.revision };
		} finally {
			tracing = false;
			traceController = undefined;
		}
	}
	onMount(() => {
		let disposed = false;
		let disposeTools: (() => void) | undefined;
		const controller = new AbortController();
		void (async () => {
			try {
				const draft = takeDraft(id);
				const project = draft ?? (await loadProject(id));
				if (disposed) return;
				if (!project)
					throw new Error(
						'This project was not found on this device. Return to your library or import a backup.'
					);
				const s = new VectorSession(project);
				session = s;
				if (draft) s.saver.schedule(project);
				s.select(project.layers[0]?.id ?? null);
				const registered = await registerVectorTools(
					{
						getProject: () => s.project,
						getSession: () => ({
							currentFrame: s.currentFrame,
							selectedLayerId: s.selectedLayerId,
							playing: s.playing
						}),
						execute: (name, input, revision) => s.execute(name, input, revision),
						seek: (frame) => {
							s.playing = false;
							s.seek(frame);
						},
						select: (layerId) => s.select(layerId),
						play: (action) => s.play(action),
						undo: () => s.undo(),
						redo: () => s.redo(),
						exportFile,
						importAsset: async (input) => {
							const decoded = decodeBase64Asset(input);
							return importBlob(
								decoded.blob,
								decoded.name,
								'webmcp',
								input.expectedRevision as number
							);
						},
						vectorizeAsset: async (input) => {
							const asset = s.project.assets.find((a) => a.id === input.assetId);
							if (!asset) throw new Error('Asset not found.');
							return traceAsset(asset, input.expectedRevision as number);
						}
					},
					controller.signal
				);
				disposeTools = registered.dispose;
				s.webmcp = registered.message;
			} catch (error) {
				if (!disposed) report(error);
			}
		})();
		return () => {
			disposed = true;
			controller.abort();
			disposeTools?.();
			traceController?.abort();
			if (session) void session.saver.dispose().catch(report);
		};
	});
	$effect(() => {
		const s = session;
		if (!s?.playing) return;
		const { fps, frameCount } = s.project.timeline;
		const origin = performance.now() - (untrack(() => s.currentFrame) / fps) * 1000;
		let request = 0;
		function tick(now: number) {
			s!.currentFrame = Math.floor(((now - origin) / 1000) * fps) % frameCount;
			request = requestAnimationFrame(tick);
		}
		request = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(request);
	});
	function keydown(event: KeyboardEvent) {
		if (
			!session ||
			(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')
		)
			return;
		const key = event.key.toLowerCase();
		const modifier = event.metaKey || event.ctrlKey;
		if (modifier && (key === 'z' || key === 'y')) {
			event.preventDefault();
			safe(() => (key === 'y' || event.shiftKey ? session!.redo() : session!.undo()));
			return;
		}
		if (event.code === 'Space') {
			event.preventDefault();
			session.playing = !session.playing;
		} else if (['v', 'b', 'p', 'h'].includes(key))
			selectTool(
				({ v: 'select', b: 'pencil', p: 'pen', h: 'hand' } as const)[key as 'v' | 'b' | 'p' | 'h']
			);
		else if (key === 'arrowleft' || key === 'arrowright') {
			event.preventDefault();
			session.playing = false;
			session.seek(
				Math.max(
					0,
					Math.min(
						session.project.timeline.frameCount - 1,
						session.currentFrame + (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 10 : 1)
					)
				)
			);
		} else if (key === 'delete' || key === 'backspace') {
			event.preventDefault();
			safe(() => (session!.tool === 'pen' ? deletePoint() : removeLayer()));
		}
	}
</script>

<svelte:window onkeydown={keydown} />
<svelte:head><title>{session?.project.name ?? 'Animation'} · AniMCP</title></svelte:head>

{#if session}
	<main class="vector-editor">
		<header class="editor-header">
			<a href="/" class="back" aria-label="Project library"><ChevronLeft size={18} /></a><a
				href="/"
				class="brand-vector">ani<span>MCP</span></a
			><span class="header-divider"></span><input
				class="name-input"
				aria-label="Project name"
				value={session.project.name}
				onchange={(e) => safe(() => command('rename_project', { name: e.currentTarget.value }))}
			/><span class="save-state" aria-live="polite"
				>{session.saveStatus?.state === 'error'
					? 'Save failed'
					: session.saveStatus?.state === 'pending' || session.saveStatus?.state === 'saving'
						? 'Saving…'
						: 'Saved locally'}</span
			>
			<div class="header-actions">
				<button
					aria-label="Undo"
					disabled={!session.canUndo}
					onclick={() => safe(() => session!.undo())}><Undo2 size={16} /></button
				><button
					aria-label="Redo"
					disabled={!session.canRedo}
					onclick={() => safe(() => session!.redo())}><Redo2 size={16} /></button
				><span class="header-divider"></span><button
					aria-label="Restart"
					onclick={() => session!.play('restart')}><RotateCcw size={15} /></button
				><button
					class="play-button"
					onclick={() => session!.play(session!.playing ? 'pause' : 'play')}
					>{#if session.playing}<Pause size={15} /> Pause{:else}<Play size={15} /> Play{/if}</button
				>
				<div class="export-anchor">
					<button class="export-button" onclick={() => (exportOpen = !exportOpen)}
						><Download size={15} /> Export</button
					>{#if exportOpen}<div class="export-menu">
							<button onclick={() => safe(() => exportFile('project'))}
								>Editable project · JSON</button
							><button onclick={() => safe(() => exportFile('svg'))}>Current frame · SVG</button
							><button onclick={() => safe(() => exportFile('lottie'))}>Animation · Lottie</button
							><small>Source raster assets stay on this device.</small>
						</div>{/if}
				</div>
			</div>
		</header>
		{#if session.error || session.saveStatus?.state === 'error'}<div
				class="error-banner"
				role="alert"
			>
				{session.error || session.saveStatus?.error?.message}<button
					onclick={() => safe(() => session!.saver.flush())}>Retry save</button
				><button aria-label="Dismiss error" onclick={() => (session!.error = '')}
					><X size={14} /></button
				>
			</div>{/if}
		<div class="workspace">
			<aside class="tool-rail" aria-label="Drawing tools">
				{#each tools as item (item.id)}<button
						class:active={session.tool === item.id}
						aria-label={item.label}
						title={item.label}
						aria-pressed={session.tool === item.id}
						onclick={() => selectTool(item.id)}><item.icon size={19} /></button
					>{/each}
				<div class="rail-rule"></div>
				<button
					aria-label="Deselect / new path"
					title="Deselect / new path"
					onclick={() => session!.select(null)}><Plus size={19} /></button
				><button
					aria-label="Delete selected layer"
					title="Delete selected layer"
					disabled={!selected || selected.locked}
					onclick={() => safe(removeLayer)}><Trash2 size={17} /></button
				>
				<div class="rail-spacer"></div>
				<input
					class="stroke-swatch"
					aria-label="Drawing stroke color"
					type="color"
					bind:value={session.stroke}
				/>
			</aside>
			<section class="canvas-panel" aria-label="Canvas workspace">
				<div class="canvas-topline">
					<span
						>{session.project.canvas.width} × {session.project.canvas.height} <b>·</b>
						{session.project.timeline.fps} FPS</span
					><span>FRAME {String(session.currentFrame).padStart(3, '0')}</span>
				</div>
				<div class="canvas-stage">
					<FabricCanvas
						bind:this={canvasView}
						project={session.project}
						currentFrame={session.currentFrame}
						selectedLayerId={session.selectedLayerId}
						tool={session.tool}
						stroke={session.stroke}
						strokeWidth={session.strokeWidth}
						zoom={session.zoom}
						fitToken={session.fitToken}
						onzoom={(zoom) => (session!.zoom = zoom)}
						onselect={(id) => session!.select(id)}
						oncreate={createPath}
						onchange={(id, changes) => updateShape(changes, id)}
						onpointselect={(index) => (pointIndex = index)}
						onerror={report}
					/>
				</div>
				<div class="canvas-bottomline">
					<span class="agent-status"><i></i> WEBMCP · {session.webmcp}</span>
					<div class="zoom-controls">
						<button
							aria-label="Zoom out"
							onclick={() => (session!.zoom = Math.max(0.05, session!.zoom / 1.2))}
							><ZoomOut size={14} /></button
						><span>{Math.round(session.zoom * 100)}%</span><button
							aria-label="Zoom in"
							onclick={() => (session!.zoom = Math.min(8, session!.zoom * 1.2))}
							><ZoomIn size={14} /></button
						><button aria-label="Fit canvas" onclick={() => session!.fitToken++}
							><Maximize size={14} /></button
						>
					</div>
				</div>
			</section>
			<aside class="inspector" aria-label="Layers and properties">
				<div class="inspector-tabs">
					<button class:active={sidebarTab === 'layers'} onclick={() => (sidebarTab = 'layers')}
						>Layers <span>{session.project.layers.length}</span></button
					><button class:active={sidebarTab === 'assets'} onclick={() => (sidebarTab = 'assets')}
						>Assets <span>{session.project.assets.length}</span></button
					>
				</div>
				{#if sidebarTab === 'layers'}<div class="layer-list">
						{#each [...session.project.layers].sort((a, b) => b.zIndex - a.zIndex) as layer (layer.id)}<div
								class:selected={layer.id === selected?.id}
								class="layer-row"
							>
								<button class="layer-name" onclick={() => session!.select(layer.id)}
									><span style:background={layer.style.stroke}></span>{layer.name}</button
								><button
									aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
									onclick={() =>
										safe(() =>
											command('set_layer_visibility', {
												layerId: layer.id,
												visible: !layer.visible
											})
										)}
									>{#if layer.visible}<Eye size={13} />{:else}<EyeOff size={13} />{/if}</button
								><button
									aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
									onclick={() =>
										safe(() =>
											command('set_layer_lock', { layerId: layer.id, locked: !layer.locked })
										)}
									>{#if layer.locked}<Lock size={12} />{:else}<Unlock size={12} />{/if}</button
								>
							</div>{:else}<p class="empty-panel">
								Your canvas is waiting.<br />Pick the pencil and draw a line.
							</p>{/each}
					</div>
				{:else}<div class="asset-list">
						<button class="wide-button" onclick={() => assetPicker.click()}
							><Upload size={14} /> Import image</button
						><input
							type="file"
							accept="image/png,image/jpeg,image/webp"
							hidden
							bind:this={assetPicker}
							onchange={(event) => safe(() => importFile(event))}
						/>
						<p class="fine-print">
							PNG, JPEG, WebP · up to 10 MiB.<br />Trace dark line art into editable monochrome
							paths.
						</p>
						{#if tracing}<progress max="1" value={traceProgress}></progress><button
								onclick={() => traceController?.abort()}>Cancel trace</button
							>{/if}{#each session.project.assets as asset (asset.id)}<div class="asset-card">
								<AssetThumbnail
									projectId={session.project.id}
									assetId={asset.id}
									name={asset.name}
								/><span>{asset.name}</span><button
									disabled={tracing}
									onclick={() => safe(() => traceAsset(asset))}>Trace to vector</button
								>
							</div>{/each}
					</div>{/if}
				<section class="properties">
					<h2>{selected ? 'Layer properties' : 'Drawing'}</h2>
					{#if selected}<div class="property-row">
							<input
								aria-label="Layer name"
								value={selected.name}
								disabled={selected.locked}
								onchange={(event) =>
									safe(() =>
										command('rename_layer', {
											layerId: selected!.id,
											name: event.currentTarget.value
										})
									)}
							/><button
								aria-label="Move layer up"
								disabled={selected.locked}
								onclick={() => safe(() => reorder(1))}><ArrowUp size={14} /></button
							><button
								aria-label="Move layer down"
								disabled={selected.locked}
								onclick={() => safe(() => reorder(-1))}><ArrowDown size={14} /></button
							>
						</div>
						<fieldset disabled={selected.locked}>
							<div class="property-grid">
								<label
									>Stroke<input
										aria-label="Layer stroke"
										type="color"
										value={selected.style.stroke}
										onchange={(e) => safe(() => setStyle({ stroke: e.currentTarget.value }))}
									/></label
								><label
									>Width<input
										aria-label="Layer stroke width"
										type="number"
										min="0"
										max="1000"
										step=".5"
										value={selected.style.strokeWidth}
										onchange={(e) =>
											safe(() => setStyle({ strokeWidth: Number(e.currentTarget.value) }))}
									/></label
								><label
									>Fill<input
										aria-label="Layer fill color"
										type="color"
										value={selected.style.fill ?? '#dfff4f'}
										onchange={(e) => safe(() => setStyle({ fill: e.currentTarget.value }))}
									/></label
								><label class="check-label"
									><input
										type="checkbox"
										checked={selected.style.fill !== null}
										onchange={(e) =>
											safe(() => setStyle({ fill: e.currentTarget.checked ? '#dfff4f' : null }))}
									/> Filled</label
								>
							</div>
							{#if snapshot}<h3>Transform · frame {session.currentFrame}</h3>
								<div class="property-grid">
									{#each ['x', 'y', 'scaleX', 'scaleY', 'rotation'] as field (field)}<label
											>{field}<input
												aria-label={`Transform ${field}`}
												type="number"
												step={field.startsWith('scale') ? '.05' : '1'}
												value={Number(snapshot.transform[field as keyof Transform].toFixed(3))}
												onchange={(e) =>
													safe(() =>
														setTransform(field as keyof Transform, Number(e.currentTarget.value))
													)}
											/></label
										>{/each}<label
										>Opacity<input
											aria-label="Keyframe opacity"
											type="number"
											min="0"
											max="1"
											step=".05"
											value={snapshot.opacity ?? 1}
											onchange={(e) =>
												safe(() => updateShape({ opacity: Number(e.currentTarget.value) }))}
										/></label
									>
								</div>
								<label class="full-label"
									>Easing<select
										aria-label="Keyframe easing"
										value={snapshot.easing.type}
										onchange={(e) =>
											safe(() =>
												updateShape({
													easing:
														e.currentTarget.value === 'bezier'
															? { type: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
															: { type: e.currentTarget.value as 'linear' | 'hold' }
												})
											)}
										><option value="linear">Linear</option><option value="hold">Hold</option><option
											value="bezier">Ease in / out</option
										></select
									></label
								>
								{#if session.tool === 'pen'}<h3>Path points</h3>
									<select aria-label="Selected path point" bind:value={pointIndex}
										>{#each snapshot.paths[0] as c, index}<option value={index}
												>{index} · {c.type === 'C'
													? 'Curve'
													: c.type === 'M'
														? 'Move'
														: c.type === 'Z'
															? 'Close'
															: 'Line'}</option
											>{/each}</select
									>{#if point && point.type !== 'Z'}<div class="property-grid">
											{#each Object.entries(point).filter(([key]) => key !== 'type') as [field, value] (field)}<label
													>{field}<input
														aria-label={`Point ${field}`}
														type="number"
														value={Number(Number(value).toFixed(3))}
														onchange={(e) =>
															safe(() => editPoint(field, Number(e.currentTarget.value)))}
													/></label
												>{/each}
										</div>{/if}
									<div class="property-row">
										<button onclick={() => safe(addPoint)}>Add curve point</button><button
											onclick={() => safe(deletePoint)}>Delete point</button
										>
									</div>{/if}
							{:else}<p class="fine-print">
									No geometry at this frame. Seek to a keyframe to edit.
								</p>{/if}
						</fieldset>
					{:else}<div class="property-grid">
							<label
								>Stroke<input
									type="color"
									aria-label="New stroke color"
									bind:value={session.stroke}
								/></label
							><label
								>Width<input
									type="number"
									aria-label="New stroke width"
									min=".5"
									max="100"
									bind:value={session.strokeWidth}
								/></label
							>
						</div>
						{#if session.tool === 'pen'}<button
								class="wide-button"
								onclick={() => canvasView?.finishPath()}>Finish pen path ↵</button
							>{/if}{/if}
				</section>
				<details class="composition">
					<summary>Composition settings</summary>
					<div class="property-grid">
						<label
							>Width<input
								aria-label="Canvas width"
								type="number"
								min="240"
								max="1920"
								value={session.project.canvas.width}
								onchange={(e) =>
									safe(() => command('update_canvas', { width: Number(e.currentTarget.value) }))}
							/></label
						><label
							>Height<input
								aria-label="Canvas height"
								type="number"
								min="240"
								max="1080"
								value={session.project.canvas.height}
								onchange={(e) =>
									safe(() => command('update_canvas', { height: Number(e.currentTarget.value) }))}
							/></label
						><label
							>Background<input
								aria-label="Canvas background"
								type="color"
								value={session.project.canvas.background}
								onchange={(e) =>
									safe(() => command('update_canvas', { background: e.currentTarget.value }))}
							/></label
						><label
							>FPS<select
								aria-label="Frame rate"
								value={session.project.timeline.fps}
								onchange={(e) =>
									safe(() => command('update_timeline', { fps: Number(e.currentTarget.value) }))}
								>{#each [12, 15, 24, 30] as fps}<option value={fps}>{fps}</option>{/each}</select
							></label
						><label
							>Frames<input
								aria-label="Frame count"
								type="number"
								min={session.project.timeline.fps}
								max={session.project.timeline.fps * 60}
								value={session.project.timeline.frameCount}
								onchange={(e) =>
									safe(() =>
										command('update_timeline', { frameCount: Number(e.currentTarget.value) })
									)}
							/></label
						>
					</div>
				</details>
			</aside>
		</div>
		<Timeline
			{session}
			onadd={() => safe(addKeyframe)}
			ondelete={() => safe(deleteKeyframe)}
			ongenerate={(start, end) =>
				safe(() =>
					command('generate_inbetweens', {
						layerId: selected?.id,
						startFrame: start,
						endFrame: end
					})
				)}
			onerror={report}
		/>
	</main>
{:else}<main class="loading-editor">
		<a href="/">← Project library</a>
		<h1>{loadError ? 'Could not open animation' : 'Opening your canvas…'}</h1>
		{#if loadError}<p role="alert">{loadError}</p>
			<button onclick={() => location.reload()}>Retry</button>{/if}
	</main>{/if}

<style>
	.vector-editor {
		height: 100dvh;
		min-height: 640px;
		display: grid;
		grid-template-rows: 62px minmax(330px, 1fr) 230px;
		color: #e1e9ed;
		background: #11191e;
		overflow: hidden;
	}
	.vector-editor:has(.error-banner) {
		grid-template-rows: 62px auto minmax(300px, 1fr) 230px;
	}
	.editor-header {
		display: flex;
		align-items: center;
		padding: 0 17px 0 10px;
		gap: 14px;
		background: #141d23;
		border-bottom: 1px solid #2d393f;
		z-index: 5;
	}
	.brand-vector {
		text-decoration: none;
		letter-spacing: -1px;
		font-size: 19px;
		font-weight: 800;
	}
	.brand-vector span {
		color: #dfff4f;
	}
	.back {
		display: flex;
		color: #95a7b1;
	}
	.header-divider {
		width: 1px;
		height: 20px;
		background: #34434a;
	}
	.name-input {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		font-size: 12px;
		width: clamp(120px, 16vw, 230px);
		padding: 6px;
	}
	.name-input:focus {
		border-color: #54666f;
		outline: none;
	}
	.save-state {
		color: #81949f;
		font: 9px var(--mono);
		white-space: nowrap;
	}
	.header-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1px solid #35434c;
		border-radius: 5px;
		background: #1e2a32;
		color: #c5d0d8;
		font-size: 11px;
		min-height: 28px;
		padding: 5px 8px;
	}
	button:hover:not(:disabled) {
		border-color: #7b929f;
		background: #2b3a44;
	}
	button:disabled {
		opacity: 0.32;
		cursor: default;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid #dfff4f;
		outline-offset: 2px;
	}
	.header-actions button {
		height: 31px;
	}
	.header-actions .play-button {
		min-width: 76px;
	}
	.header-actions .export-button {
		background: #dfff4f;
		border-color: #dfff4f;
		color: #172211;
		font-weight: 700;
		margin-left: 7px;
	}
	.export-anchor {
		position: relative;
	}
	.export-menu {
		position: absolute;
		right: 0;
		top: 40px;
		padding: 7px;
		width: 224px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: #1d2b33;
		border: 1px solid #465b66;
		border-radius: 7px;
		box-shadow: 0 12px 30px #0008;
	}
	.export-menu button {
		justify-content: flex-start;
		border: 0;
	}
	.export-menu small {
		color: #9baeb8;
		font-size: 10px;
		padding: 6px;
	}
	.error-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 18px;
		background: #523528;
		color: #ffd7bc;
		font-size: 12px;
	}
	.error-banner button:first-of-type {
		margin-left: auto;
	}
	.workspace {
		display: grid;
		grid-template-columns: 56px minmax(200px, 1fr) 286px;
		min-height: 0;
	}
	.tool-rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 9px;
		padding: 16px 7px;
		background: #151f26;
		border-right: 1px solid #2c3941;
	}
	.tool-rail > button {
		border-color: transparent;
		width: 36px;
		height: 36px;
		background: transparent;
		color: #93a6b1;
	}
	.tool-rail > button.active {
		background: #dfff4f;
		color: #1b2910;
		border-color: #dfff4f;
	}
	.rail-rule {
		height: 1px;
		background: #34414a;
		width: 26px;
		margin: 5px 0;
	}
	.rail-spacer {
		flex: 1;
	}
	.stroke-swatch {
		width: 29px;
		height: 29px;
		padding: 0;
		border: 1px solid #778e9b;
		background: transparent;
		border-radius: 50%;
		overflow: hidden;
	}
	.canvas-panel {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: #0b1014;
	}
	.canvas-topline,
	.canvas-bottomline {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 18px;
		color: #798d99;
		font: 9px var(--mono);
		background: #111a20;
	}
	.canvas-topline b {
		padding: 0 8px;
		color: #445862;
	}
	.canvas-stage {
		flex: 1;
		min-height: 0;
	}
	.canvas-bottomline {
		padding: 6px 14px;
		border-top: 1px solid #26343d;
		min-height: 37px;
	}
	.agent-status {
		font-size: 8px;
		max-width: 65%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.agent-status i {
		display: inline-block;
		width: 5px;
		height: 5px;
		background: #77938d;
		border-radius: 50%;
		margin-right: 6px;
	}
	.zoom-controls {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.zoom-controls button {
		background: transparent;
		border: 0;
		padding: 3px;
		min-height: 22px;
	}
	.zoom-controls span {
		min-width: 35px;
		text-align: center;
	}
	.inspector {
		background: #172128;
		border-left: 1px solid #2d3b44;
		overflow-y: auto;
		font-size: 11px;
	}
	.inspector-tabs {
		display: flex;
		position: sticky;
		top: 0;
		background: #172128;
		z-index: 2;
		border-bottom: 1px solid #34424b;
		padding: 7px 12px 0;
		gap: 12px;
	}
	.inspector-tabs button {
		border: 0;
		background: transparent;
		border-radius: 0;
		padding: 8px 4px 12px;
		color: #8296a3;
	}
	.inspector-tabs button.active {
		border-bottom: 2px solid #dfff4f;
		color: #e8eef1;
	}
	.inspector-tabs span {
		font: 9px var(--mono);
		color: #7e949f;
	}
	.layer-list {
		min-height: 94px;
		max-height: 220px;
		overflow-y: auto;
		padding: 8px 0;
	}
	.layer-row {
		display: flex;
		align-items: center;
		padding: 3px 10px;
		gap: 2px;
	}
	.layer-row.selected {
		background: #2a3943;
	}
	.layer-row button {
		border: 0;
		background: transparent;
		min-height: 27px;
		padding: 3px 5px;
	}
	.layer-name {
		flex: 1;
		justify-content: flex-start;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-align: left;
	}
	.layer-name span {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex-shrink: 0;
		margin-right: 4px;
	}
	.empty-panel {
		padding: 15px;
		color: #8197a3;
		line-height: 1.7;
		font-size: 11px;
	}
	.properties {
		border-top: 1px solid #34424b;
		padding: 15px;
	}
	.properties h2 {
		font-size: 11px;
		font-weight: 600;
		margin: 0 0 13px;
	}
	.properties h3 {
		font-size: 10px;
		font-weight: 500;
		color: #94a8b3;
		margin: 18px 0 10px;
	}
	.property-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin: 10px 0;
	}
	.property-grid label,
	.full-label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 10px;
		color: #96a9b4;
	}
	.property-row {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.property-row > input {
		flex: 1;
		min-width: 0;
	}
	.property-row button {
		font-size: 9px;
	}
	.properties input,
	.properties select,
	.composition input,
	.composition select {
		width: 100%;
		min-width: 0;
		background: #10191f;
		color: #d2e0e8;
		border: 1px solid #334751;
		border-radius: 4px;
		padding: 6px 7px;
		font: 11px var(--mono);
		height: 30px;
	}
	.properties input[type='color'],
	.composition input[type='color'] {
		padding: 3px;
	}
	.properties .check-label {
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
		padding-top: 14px;
	}
	.properties .check-label input {
		width: 14px;
		accent-color: #dfff4f;
	}
	.properties fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	.properties fieldset:disabled {
		opacity: 0.45;
	}
	.composition {
		padding: 15px;
		border-top: 1px solid #34424b;
	}
	.composition summary {
		cursor: pointer;
		color: #9aafb9;
		font-size: 10px;
	}
	.wide-button {
		width: 100%;
	}
	.asset-list {
		padding: 15px;
	}
	.fine-print {
		color: #8ca3ae;
		font-size: 10px;
		line-height: 1.6;
		margin: 10px 0;
	}
	.asset-card {
		margin-top: 14px;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.asset-card span {
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.asset-list progress {
		width: 100%;
		accent-color: #dfff4f;
	}
	.loading-editor {
		padding: 60px 30px;
		color: #c6d3db;
	}
	.loading-editor h1 {
		font-size: 25px;
		margin: 30px 0;
	}
	@media (max-width: 1050px) {
		.save-state {
			display: none;
		}
		.workspace {
			grid-template-columns: 48px minmax(180px, 1fr) 248px;
		}
		.editor-header {
			gap: 8px;
			padding-right: 8px;
		}
		.name-input {
			width: 140px;
		}
		.header-actions .header-divider {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.vector-editor {
			height: auto;
			min-height: 100dvh;
			overflow: visible;
			grid-template-rows: auto auto 240px;
		}
		.vector-editor:has(.error-banner) {
			grid-template-rows: auto auto auto 240px;
		}
		.editor-header {
			min-height: 62px;
			flex-wrap: wrap;
			padding: 10px;
			gap: 8px;
		}
		.header-actions {
			margin-left: 0;
			flex: 1;
			justify-content: flex-end;
		}
		.name-input {
			flex: 1;
			width: 100px;
		}
		.header-divider {
			display: none;
		}
		.workspace {
			grid-template-columns: 44px minmax(0, 1fr);
			grid-template-rows: 420px auto;
		}
		.tool-rail {
			grid-column: 1;
			grid-row: 1;
		}
		.canvas-panel {
			grid-column: 2;
			grid-row: 1;
		}
		.inspector {
			grid-column: 1/-1;
			grid-row: 2;
			max-height: 350px;
			border-top: 1px solid #34424b;
		}
		.properties {
			max-width: 600px;
		}
		.canvas-bottomline {
			padding: 6px;
		}
		.agent-status {
			font-size: 7px;
		}
		.canvas-topline {
			padding: 10px;
			font-size: 8px;
		}
	}
</style>
