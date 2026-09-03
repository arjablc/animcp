<script lang="ts">
	import { onMount } from 'svelte';
	import { copyPaths, value, type Layer, type PathData, type Value } from '../model';
	import type { MotionSession } from '../session.svelte';
	import { propertyEdits, previewLayer as sessionPreviewLayer } from '../editing';
	import {
		intersects,
		layerBounds,
		localPoint,
		rotatePoint,
		selectionBounds
	} from '../stage-geometry';
	import {
		editPathControl,
		normalizeDraft,
		pathDataString,
		penAnchor,
		previousPoint,
		subpathData,
		type DraftSubpath,
		type PathControl
	} from '../stage-path';
	import {
		ancestorOpacity,
		ancestorTransform,
		effectivelyVisible,
		layerSvg,
		transform
	} from '../render';
	import GradientHandles from './GradientHandles.svelte';

	let {
		session,
		onImport,
		activeTool,
		onToolChange
	}: {
		session: MotionSession;
		onImport: (files: FileList) => void;
		activeTool: 'move' | 'pen';
		onToolChange: (tool: 'move' | 'pen') => void;
	} = $props();
	type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
	type Viewport = { x: number; y: number; zoom: number };

	let stage: SVGSVGElement;
	let stageWrap: HTMLDivElement;
	let pathEditor = $state<SVGGElement>() as SVGGElement;
	let viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
	let spacePressed = $state(false);
	let panning = $state<{
		startClientX: number;
		startClientY: number;
		startViewport: Viewport;
		scaleX: number;
		scaleY: number;
	} | null>(null);
	let dragging = $state<{
		layers: { id: string; x: number; y: number }[];
		startX: number;
		startY: number;
		dx: number;
		dy: number;
		revision: number;
		frame: number;
	} | null>(null);
	let transforming = $state<{
		layerId: string;
		handle: TransformHandle;
		start: { x: number; y: number };
		startAngle: number;
		anchor: { x: number; y: number };
		base: Record<'positionX' | 'positionY' | 'width' | 'height' | 'rotation', number>;
		values: Record<'positionX' | 'positionY' | 'width' | 'height' | 'rotation', number>;
		revision: number;
		frame: number;
	} | null>(null);
	let marquee = $state<{
		startX: number;
		startY: number;
		endX: number;
		endY: number;
		additive: boolean;
	} | null>(null);
	let draftSubpaths = $state.raw<DraftSubpath[]>([]);
	let activeDraftIndex = $state<number | null>(null);
	let penGesture = $state<{ start: { x: number; y: number }; pointerId: number } | null>(null);
	let penPreview = $state<{ x: number; y: number } | null>(null);
	let pathEdit = $state.raw<{
		layerId: string;
		pathIndex: number;
		commandIndex: number;
		control: PathControl;
		start: { x: number; y: number };
		paths: PathData[];
		revision: number;
	} | null>(null);

	// $derived recalculates whenever the session selection or project changes.
	const selected = $derived(
		session.project.layers.find((layer) => layer.id === session.context.selectedLayerIds[0])
	);
	// SVG controls need more composition units as the canvas gets physically smaller,
	// otherwise their screen hit areas shrink below a usable target.
	const controlSize = $derived(12 / viewport.zoom);
	const controlOffset = $derived(40 / viewport.zoom);

	onMount(() => {
		fit();
		const complete = () => finishPen();
		const cancel = () => cancelPen();
		window.addEventListener('motion:finish-pen', complete);
		window.addEventListener('motion:cancel-pen', cancel);
		return () => {
			window.removeEventListener('motion:finish-pen', complete);
			window.removeEventListener('motion:cancel-pen', cancel);
		};
	});

	function point(event: PointerEvent) {
		const point = stage.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		return point.matrixTransform(stage.getScreenCTM()!.inverse());
	}

	function pathPoint(event: PointerEvent) {
		const svgPoint = stage.createSVGPoint();
		svgPoint.x = event.clientX;
		svgPoint.y = event.clientY;
		return svgPoint.matrixTransform(pathEditor.getScreenCTM()!.inverse());
	}

	function viewBox() {
		const { width, height } = session.project.composition;
		return `${viewport.x} ${viewport.y} ${(width * 2) / viewport.zoom} ${(height * 2) / viewport.zoom}`;
	}

	function fit() {
		const { width, height } = session.project.composition;
		viewport = { x: -width / 2, y: -height / 2, zoom: 1 };
	}

	function navigateWheel(event: WheelEvent) {
		if (!event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			const matrix = stage.getScreenCTM();
			if (event.shiftKey)
				viewport = {
					...viewport,
					x: viewport.x + (event.deltaY || event.deltaX) / Math.abs(matrix?.a || 1)
				};
			else
				viewport = {
					...viewport,
					y: viewport.y + event.deltaY / Math.abs(matrix?.d || 1)
				};
			return;
		}
		event.preventDefault();
		const bounds = stage.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		const current = point(event as unknown as PointerEvent);
		const { width, height } = session.project.composition;
		const currentWidth = (width * 2) / viewport.zoom,
			currentHeight = (height * 2) / viewport.zoom;
		const nextZoom = Math.max(0.25, Math.min(8, viewport.zoom * Math.exp(-event.deltaY * 0.0015)));
		if (nextZoom === viewport.zoom) return;
		const ratioX = (current.x - viewport.x) / currentWidth,
			ratioY = (current.y - viewport.y) / currentHeight;
		const nextWidth = (width * 2) / nextZoom,
			nextHeight = (height * 2) / nextZoom;
		viewport = {
			zoom: nextZoom,
			x: current.x - ratioX * nextWidth,
			y: current.y - ratioY * nextHeight
		};
	}

	function startsWithFormControl(target: EventTarget | null) {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target as HTMLElement | null)?.isContentEditable
		);
	}

	function keyboard(event: KeyboardEvent) {
		if (!stageWrap?.matches(':hover') || startsWithFormControl(event.target)) return;
		if (event.code === 'Space') {
			spacePressed = event.type === 'keydown';
			event.preventDefault();
			event.stopImmediatePropagation();
		} else if (event.type === 'keydown' && event.key === '0') {
			event.preventDefault();
			fit();
		}
	}

	function currentDraftSubpath() {
		return activeDraftIndex === null ? null : draftSubpaths[activeDraftIndex];
	}

	function gestureAnchor() {
		if (!penGesture) return null;
		return penAnchor(penGesture.start, penPreview ?? penGesture.start);
	}

	function draftD(subpath: DraftSubpath, preview = false) {
		const next = preview
			? (gestureAnchor() ?? (penPreview ? penAnchor(penPreview) : undefined))
			: undefined;
		return pathDataString(subpathData(subpath, next));
	}

	function startPen(event: PointerEvent) {
		if (event.button !== 0 || spacePressed) return;
		event.preventDefault();
		event.stopPropagation();
		session.playing = false;
		penGesture = { start: point(event), pointerId: event.pointerId };
		penPreview = penGesture.start;
		stage.setPointerCapture(event.pointerId);
	}

	function addPenPoint(event: PointerEvent) {
		const gesture = penGesture;
		penGesture = null;
		if (!gesture) return;
		const release = point(event);
		const subpath = currentDraftSubpath();
		if (
			subpath &&
			subpath.anchors.length >= 3 &&
			Math.hypot(gesture.start.x - subpath.anchors[0].x, gesture.start.y - subpath.anchors[0].y) <=
				12 / viewport.zoom
		) {
			draftSubpaths = draftSubpaths.map((candidate, index) =>
				index === activeDraftIndex ? { ...candidate, closed: true } : candidate
			);
			activeDraftIndex = null;
			penPreview = null;
			finishPen();
			return;
		}
		const anchor = penAnchor(gesture.start, release);
		if (!subpath) {
			draftSubpaths = [...draftSubpaths, { anchors: [anchor], closed: false }];
			activeDraftIndex = draftSubpaths.length - 1;
		} else {
			draftSubpaths = draftSubpaths.map((candidate, index) =>
				index === activeDraftIndex
					? { ...candidate, anchors: [...candidate.anchors, anchor] }
					: candidate
			);
		}
		penPreview = release;
	}

	function endSubpath() {
		const active = currentDraftSubpath();
		if (active) {
			if (active.anchors.length < 2) {
				session.error = 'Add at least two points before ending a subpath.';
				return;
			}
			activeDraftIndex = null;
			penPreview = null;
			session.error = '';
			return;
		}
		finishPen();
	}

	function finishPen() {
		const paths = draftSubpaths
			.filter((subpath) => subpath.anchors.length >= 2)
			.map((subpath) => subpathData(subpath));
		if (!paths.length) {
			session.error = 'Add at least two points before finishing a path.';
			return;
		}
		try {
			const geometry = normalizeDraft(paths);
			const result = session.run(
				'create_layer',
				{ type: 'path', name: 'Path', ...geometry },
				'Created path'
			);
			session.select([(result.data[0] as { layerId: string }).layerId]);
			draftSubpaths = [];
			activeDraftIndex = null;
			penPreview = null;
			onToolChange('move');
			session.error = '';
		} catch (error) {
			session.error = String(error);
		}
	}

	function cancelPen() {
		draftSubpaths = [];
		activeDraftIndex = null;
		penGesture = null;
		penPreview = null;
		onToolChange('move');
	}

	function startPathEdit(
		event: PointerEvent,
		layer: Layer,
		pathIndex: number,
		commandIndex: number,
		control: PathControl
	) {
		if (layer.locked || !layer.paths) return;
		event.preventDefault();
		event.stopPropagation();
		session.playing = false;
		pathEdit = {
			layerId: layer.id,
			pathIndex,
			commandIndex,
			control,
			start: pathPoint(event),
			paths: copyPaths(layer.paths),
			revision: session.project.revision
		};
		stage.setPointerCapture(event.pointerId);
	}

	function movePathEdit(event: PointerEvent) {
		const edit = pathEdit;
		if (!edit) return;
		const current = pathPoint(event);
		const command = edit.paths[edit.pathIndex]?.[edit.commandIndex];
		if (!command || command.type === 'Z') return;
		const dx = current.x - edit.start.x,
			dy = current.y - edit.start.y;
		const paths = editPathControl(
			edit.paths,
			edit.pathIndex,
			edit.commandIndex,
			edit.control,
			dx,
			dy
		);
		pathEdit = { ...edit, start: current, paths };
	}

	function finishPathEdit() {
		const edit = pathEdit;
		pathEdit = null;
		if (!edit) return;
		try {
			session.commit(
				[{ name: 'set_path', input: { layerId: edit.layerId, paths: edit.paths } }],
				'Edited path points',
				'human',
				edit.revision
			);
			session.error = '';
		} catch (error) {
			session.error = String(error);
		}
	}

	function displayLayer(layer: Layer) {
		const source = pathEdit?.layerId === layer.id ? { ...layer, paths: pathEdit.paths } : layer;
		if (!transforming || transforming.layerId !== layer.id)
			return sessionPreviewLayer(source, session.preview);
		return {
			...source,
			tracks: {
				...layer.tracks,
				...Object.fromEntries(
					Object.entries(transforming.values).map(([property, value]) => [
						property,
						{ defaultValue: value as Value, keys: [] }
					])
				)
			}
		};
	}

	function startDrag(event: PointerEvent, layer: Layer) {
		if (activeTool === 'pen') return;
		if (layer.locked) return;
		event.stopPropagation();
		const start = point(event);
		session.playing = false;
		if (event.shiftKey) {
			const ids = session.context.selectedLayerIds;
			session.select(
				ids.includes(layer.id) ? ids.filter((id) => id !== layer.id) : [...ids, layer.id]
			);
			return;
		}
		const frame = session.context.currentFrame;
		const selectedIds = session.context.selectedLayerIds.includes(layer.id)
			? session.context.selectedLayerIds
			: [layer.id];
		const movable = session.project.layers.filter(
			(item) => selectedIds.includes(item.id) && !item.locked
		);
		if (!movable.length) return;
		session.select(selectedIds);
		dragging = {
			layers: movable.map((item) => ({
				id: item.id,
				x: value(item, 'positionX', frame),
				y: value(item, 'positionY', frame)
			})),
			startX: start.x,
			startY: start.y,
			dx: 0,
			dy: 0,
			revision: session.project.revision,
			frame
		};
		stage.setPointerCapture(event.pointerId);
	}

	function startTransform(event: PointerEvent, layer: Layer, handle: TransformHandle) {
		if (layer.locked) return;
		event.preventDefault();
		event.stopPropagation();
		session.playing = false;
		session.select([layer.id]);
		const frame = session.context.currentFrame;
		const base = {
			positionX: value(layer, 'positionX', frame),
			positionY: value(layer, 'positionY', frame),
			width: Math.max(1, value(layer, 'width', frame)),
			height: Math.max(1, value(layer, 'height', frame)),
			rotation: value(layer, 'rotation', frame)
		};
		const center = { x: base.positionX + base.width / 2, y: base.positionY + base.height / 2 };
		const local = localPoint(point(event), base);
		const hasWest = handle.includes('w'),
			hasNorth = handle.includes('n');
		const anchorLocal = {
			x: hasWest ? base.width : handle.includes('e') ? 0 : base.width / 2,
			y: hasNorth ? base.height : handle.includes('s') ? 0 : base.height / 2
		};
		transforming = {
			layerId: layer.id,
			handle,
			start: local,
			startAngle: Math.atan2(point(event).y - center.y, point(event).x - center.x),
			anchor: rotatePoint(
				{ x: base.positionX + anchorLocal.x, y: base.positionY + anchorLocal.y },
				center,
				base.rotation
			),
			base,
			values: { ...base },
			revision: session.project.revision,
			frame
		};
		stage.setPointerCapture(event.pointerId);
	}

	function startMarquee(event: PointerEvent) {
		if (activeTool === 'pen') {
			startPen(event);
			return;
		}
		if (spacePressed || event.button === 1) {
			event.preventDefault();
			session.playing = false;
			const matrix = stage.getScreenCTM();
			panning = {
				startClientX: event.clientX,
				startClientY: event.clientY,
				startViewport: { ...viewport },
				scaleX: Math.abs(matrix?.a || 1),
				scaleY: Math.abs(matrix?.d || 1)
			};
			stage.setPointerCapture(event.pointerId);
			return;
		}
		if (event.target !== stage) return;
		const start = point(event);
		session.playing = false;
		marquee = {
			startX: start.x,
			startY: start.y,
			endX: start.x,
			endY: start.y,
			additive: event.shiftKey
		};
		stage.setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent) {
		if (pathEdit) {
			movePathEdit(event);
			return;
		}
		if (activeTool === 'pen') {
			penPreview = point(event);
			return;
		}
		if (panning) {
			viewport = {
				...panning.startViewport,
				x: panning.startViewport.x - (event.clientX - panning.startClientX) / panning.scaleX,
				y: panning.startViewport.y - (event.clientY - panning.startClientY) / panning.scaleY
			};
			return;
		}
		if (transforming) {
			const current = point(event),
				state = transforming,
				base = state.base;
			if (state.handle === 'rotate') {
				const center = { x: base.positionX + base.width / 2, y: base.positionY + base.height / 2 };
				const angle = Math.atan2(current.y - center.y, current.x - center.x);
				transforming = {
					...state,
					values: {
						...base,
						rotation: base.rotation + ((angle - state.startAngle) * 180) / Math.PI
					}
				};
				return;
			}
			const local = localPoint(current, base);
			const east = state.handle.includes('e'),
				west = state.handle.includes('w'),
				south = state.handle.includes('s'),
				north = state.handle.includes('n');
			let width = base.width,
				height = base.height;
			if (east) width = Math.max(8, base.width + (local.x - state.start.x));
			if (west) width = Math.max(8, base.width - (local.x - state.start.x));
			if (north) height = Math.max(8, base.height - (local.y - state.start.y));
			if (event.shiftKey && (east || west) && (north || south)) {
				const scale = Math.max(width / base.width, height / base.height);
				width = Math.max(8, base.width * scale);
				height = Math.max(8, base.height * scale);
			}
			const anchorLocal = {
				x: west ? width : east ? 0 : width / 2,
				y: north ? height : south ? 0 : height / 2
			};
			const centerOffset = { x: width / 2, y: height / 2 };
			const rotatedAnchorOffset = rotatePoint(anchorLocal, centerOffset, base.rotation);
			transforming = {
				...state,
				values: {
					...base,
					width,
					height,
					positionX: state.anchor.x - centerOffset.x - (rotatedAnchorOffset.x - centerOffset.x),
					positionY: state.anchor.y - centerOffset.y - (rotatedAnchorOffset.y - centerOffset.y)
				}
			};
			return;
		}
		const current = point(event);
		if (dragging)
			dragging = {
				...dragging,
				dx: current.x - dragging.startX,
				dy: current.y - dragging.startY
			};
		else if (marquee) marquee = { ...marquee, endX: current.x, endY: current.y };
	}

	function dragOffset(id: string) {
		return dragging?.layers.some((layer) => layer.id === id) ? dragging : null;
	}

	function finish(event: PointerEvent) {
		if (pathEdit) {
			finishPathEdit();
			return;
		}
		if (activeTool === 'pen' && penGesture) {
			addPenPoint(event);
			return;
		}
		if (panning) {
			panning = null;
			return;
		}
		if (transforming) {
			const state = transforming;
			transforming = null;
			const layer = session.project.layers.find((candidate) => candidate.id === state.layerId);
			if (!layer) return;
			try {
				session.commit(
					propertyEdits(layer, state.values, state.frame, session.autoKey),
					state.handle === 'rotate' ? 'Rotated layer' : 'Resized layer',
					'human',
					state.revision
				);
				session.error = '';
			} catch (error) {
				session.error = String(error);
			}
			return;
		}
		const drag = dragging;
		dragging = null;
		if (drag && Math.abs(drag.dx) + Math.abs(drag.dy) >= 0.1) {
			try {
				session.commit(
					drag.layers.flatMap((item) => {
						const layer = session.project.layers.find((candidate) => candidate.id === item.id)!;
						return propertyEdits(
							layer,
							{ positionX: item.x + drag.dx, positionY: item.y + drag.dy },
							drag.frame,
							session.autoKey
						);
					}),
					'Moved layers',
					'human',
					drag.revision
				);
				session.error = '';
			} catch (error) {
				session.error = String(error);
			}
		}
		const selection = marquee;
		marquee = null;
		if (!selection) return;
		const box = {
			x: Math.min(selection.startX, selection.endX),
			y: Math.min(selection.startY, selection.endY),
			width: Math.abs(selection.endX - selection.startX),
			height: Math.abs(selection.endY - selection.startY)
		};
		if (box.width + box.height < 2) {
			if (!selection.additive) session.select([]);
			return;
		}
		const ids = session.project.layers
			.filter(
				(layer) =>
					layer.visible && intersects(layerBounds(layer, session.context.currentFrame), box)
			)
			.map((layer) => layer.id);
		session.select(
			selection.additive ? [...new Set([...session.context.selectedLayerIds, ...ids])] : ids
		);
	}
</script>

<svelte:window
	onkeydown={keyboard}
	onkeyup={keyboard}
	onblur={() => {
		spacePressed = false;
	}}
/>

<div
	bind:this={stageWrap}
	class="stage-wrap"
	role="region"
	aria-label="Canvas artwork drop zone"
	ondragover={(event) => event.preventDefault()}
	ondrop={(event) => {
		event.preventDefault();
		if (event.dataTransfer?.files.length) onImport(event.dataTransfer.files);
	}}
>
	<svg
		class="stage"
		class:pen-tool={activeTool === 'pen'}
		bind:this={stage}
		viewBox={viewBox()}
		role="img"
		aria-label="Animation canvas"
		onpointerdown={startMarquee}
		onpointermove={move}
		onpointerup={finish}
		onpointercancel={() => {
			dragging = null;
			marquee = null;
			panning = null;
			transforming = null;
			penGesture = null;
			pathEdit = null;
		}}
		onwheel={navigateWheel}
		oncontextmenu={(event) => event.preventDefault()}
	>
		<title>Motion composition</title>
		<defs>
			<clipPath id="composition-clip">
				<rect
					width={session.project.composition.width}
					height={session.project.composition.height}
				/>
			</clipPath>
		</defs>
		<rect
			class="composition-surface"
			width={session.project.composition.width}
			height={session.project.composition.height}
			fill={session.project.composition.background}
		/>
		<g clip-path="url(#composition-clip)">
			{#each session.project.layers.filter((layer) => layer.type !== 'group' && effectivelyVisible(session.project, layer)) as raw (raw.id)}
				{@const layer = displayLayer(raw)}
				<g
					role="button"
					tabindex="0"
					aria-label={`Select ${layer.name}`}
					onpointerdown={(event) => startDrag(event, raw)}
					onkeydown={(event) => {
						if (event.key === 'Enter') session.select([layer.id]);
					}}
					transform={ancestorTransform(session.project, raw, session.context.currentFrame)}
					opacity={ancestorOpacity(session.project, raw, session.context.currentFrame)}
				>
					<g
						transform={dragOffset(layer.id)
							? `translate(${dragging!.dx} ${dragging!.dy})`
							: undefined}
					>
						<!-- layerSvg renders escaped, validated project data rather than user-provided HTML. -->
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html layerSvg(session.project, layer, session.context.currentFrame)}
					</g>
				</g>
			{/each}
		</g>
		{#if activeTool === 'pen'}
			<g class="pen-draft" aria-label="Path being drawn">
				{#each draftSubpaths as subpath, index (index)}
					<path d={draftD(subpath, index === activeDraftIndex)} />
					{#each subpath.anchors as anchor, anchorIndex (anchorIndex)}
						<line
							class="draft-handle-line"
							x1={anchor.inX}
							y1={anchor.inY}
							x2={anchor.outX}
							y2={anchor.outY}
						/>
						<circle class="draft-handle" cx={anchor.inX} cy={anchor.inY} r={controlSize * 0.42} />
						<circle class="draft-handle" cx={anchor.outX} cy={anchor.outY} r={controlSize * 0.42} />
						<circle class="draft-anchor" cx={anchor.x} cy={anchor.y} r={controlSize * 0.56} />
					{/each}
					{#if index === activeDraftIndex && penGesture}{@const anchor = gestureAnchor()}
						{#if anchor}<line
								class="draft-handle-line"
								x1={anchor.inX}
								y1={anchor.inY}
								x2={anchor.outX}
								y2={anchor.outY}
							/><circle
								class="draft-handle"
								cx={anchor.inX}
								cy={anchor.inY}
								r={controlSize * 0.42}
							/><circle
								class="draft-handle"
								cx={anchor.outX}
								cy={anchor.outY}
								r={controlSize * 0.42}
							/><circle
								class="draft-anchor"
								cx={anchor.x}
								cy={anchor.y}
								r={controlSize * 0.56}
							/>{/if}
					{/if}
				{/each}
				{#if activeDraftIndex === null && penGesture}{@const anchor = gestureAnchor()}
					{#if anchor}<line
							class="draft-handle-line"
							x1={anchor.inX}
							y1={anchor.inY}
							x2={anchor.outX}
							y2={anchor.outY}
						/><circle
							class="draft-anchor"
							cx={anchor.x}
							cy={anchor.y}
							r={controlSize * 0.56}
						/>{/if}
				{/if}
			</g>
		{/if}
		{#if selected?.type === 'path' && !selected.locked && effectivelyVisible(session.project, selected)}
			{@const layer = displayLayer(selected)}
			<g
				bind:this={pathEditor}
				class="path-editor"
				transform={ancestorTransform(session.project, selected, session.context.currentFrame)}
			>
				<g transform={transform(layer, session.context.currentFrame)}>
					{#each layer.paths ?? [] as path, pathIndex (pathIndex)}
						{#each path as command, commandIndex (commandIndex)}
							{#if command.type !== 'Z'}
								{#if command.type === 'C'}{@const previous = previousPoint(path, commandIndex)}
									{#if previous}<line
											class="path-handle-line"
											x1={previous.x}
											y1={previous.y}
											x2={command.x1}
											y2={command.y1}
										/>{/if}<line
										class="path-handle-line"
										x1={command.x}
										y1={command.y}
										x2={command.x2}
										y2={command.y2}
									/>
									<circle
										class="path-handle"
										role="button"
										tabindex="-1"
										aria-label="Drag outgoing Bezier handle"
										cx={command.x1}
										cy={command.y1}
										r={controlSize * 0.45}
										onpointerdown={(event) =>
											startPathEdit(event, selected, pathIndex, commandIndex, 'x1')}
									/>
									<circle
										class="path-handle"
										role="button"
										tabindex="-1"
										aria-label="Drag incoming Bezier handle"
										cx={command.x2}
										cy={command.y2}
										r={controlSize * 0.45}
										onpointerdown={(event) =>
											startPathEdit(event, selected, pathIndex, commandIndex, 'x2')}
									/>
								{/if}
								{#if path[commandIndex + 1]?.type !== 'Z'}<circle
										class="path-anchor"
										role="button"
										tabindex="-1"
										aria-label="Drag path anchor"
										cx={command.x}
										cy={command.y}
										r={controlSize * 0.58}
										onpointerdown={(event) =>
											startPathEdit(event, selected, pathIndex, commandIndex, 'anchor')}
									/>{/if}
							{/if}
						{/each}
					{/each}
				</g>
			</g>
		{/if}
		{#if selected && !selected.locked && effectivelyVisible(session.project, selected)}{@const layer =
				displayLayer(selected)}
			{@const frame = session.context.currentFrame}
			{@const box = selectionBounds(session.project, layer, frame)}
			<g class="selection-controls" transform={ancestorTransform(session.project, selected, frame)}>
				<g transform={transform(layer, frame)}>
					<rect class="selection-box" x={box.x} y={box.y} width={box.width} height={box.height} />
					{#if layer.type === 'group'}<rect
							class="group-hit-area"
							x={box.x}
							y={box.y}
							width={box.width}
							height={box.height}
							role="button"
							tabindex="-1"
							aria-label={`Move ${layer.name} group`}
							onpointerdown={(event) => startDrag(event, selected)}
						/>
						<text class="group-label" x={box.x + 7} y={box.y - 8}>Group</text>
					{:else}<line
							x1={box.x + box.width / 2}
							y1={box.y}
							x2={box.x + box.width / 2}
							y2={box.y - controlOffset}
						/>
						<circle
							class="rotation-handle"
							role="button"
							aria-label="Rotate selected layer"
							tabindex="-1"
							cx={box.x + box.width / 2}
							cy={box.y - controlOffset}
							r={controlSize}
							onpointerdown={(event) => startTransform(event, selected, 'rotate')}
						/>
						{#if layer.type !== 'path'}{#each [{ handle: 'nw' as TransformHandle, x: box.x, y: box.y }, { handle: 'n' as TransformHandle, x: box.x + box.width / 2, y: box.y }, { handle: 'ne' as TransformHandle, x: box.x + box.width, y: box.y }, { handle: 'e' as TransformHandle, x: box.x + box.width, y: box.y + box.height / 2 }, { handle: 'se' as TransformHandle, x: box.x + box.width, y: box.y + box.height }, { handle: 's' as TransformHandle, x: box.x + box.width / 2, y: box.y + box.height }, { handle: 'sw' as TransformHandle, x: box.x, y: box.y + box.height }, { handle: 'w' as TransformHandle, x: box.x, y: box.y + box.height / 2 }] as control (control.handle)}
								<rect
									class:corner={control.handle.length === 2}
									class="resize-handle"
									role="button"
									aria-label={`Resize selected layer from ${control.handle}`}
									tabindex="-1"
									x={control.x - controlSize}
									y={control.y - controlSize}
									width={controlSize * 2}
									height={controlSize * 2}
									onpointerdown={(event) => startTransform(event, selected, control.handle)}
								/>
							{/each}{/if}
					{/if}
				</g>
			</g>
		{/if}
		{#if marquee}
			<rect
				class="marquee"
				x={Math.min(marquee.startX, marquee.endX)}
				y={Math.min(marquee.startY, marquee.endY)}
				width={Math.abs(marquee.endX - marquee.startX)}
				height={Math.abs(marquee.endY - marquee.startY)}
				pointer-events="none"
			/>
		{/if}
		{#if selected && selected.paint.type !== 'solid' && !selected.locked && selected.visible}
			<GradientHandles {session} layer={selected} />
		{/if}
	</svg>
	{#if activeTool === 'pen'}<div class="pen-actions" role="status">
			<span
				>{draftSubpaths.length
					? `${draftSubpaths.length} subpath${draftSubpaths.length === 1 ? '' : 's'}`
					: 'Click to start a path'}</span
			>
			<button
				type="button"
				disabled={!draftSubpaths.some((subpath) => subpath.anchors.length >= 2)}
				onclick={endSubpath}>New subpath</button
			><button
				type="button"
				disabled={!draftSubpaths.some((subpath) => subpath.anchors.length >= 2)}
				onclick={finishPen}>Finish path</button
			><button type="button" onclick={cancelPen}>Cancel</button>
		</div>{/if}
	<div class="stage-nav" aria-label="Canvas navigation">
		<button type="button" onclick={fit}>Fit</button>
		<button type="button" onclick={fit}>100%</button>
		<span>{Math.round(viewport.zoom * 100)}%</span>
	</div>
</div>
<div class="canvas-meta">
	<span>{session.project.composition.width} × {session.project.composition.height}</span>
	<span>
		{(session.project.composition.durationFrames / session.project.composition.fps).toFixed(1)}s · {session
			.project.composition.fps} fps
	</span>
</div>

<style>
	.stage-wrap {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
		align-items: center;
		justify-content: center;
		padding: 82px 34px 24px;
		overflow: hidden;
		background: #0a111c;
	}
	.stage {
		width: 100%;
		height: 100%;
		max-height: 100%;
		min-height: 0;
		touch-action: none;
		background: #0a111c;
		cursor: default;
	}
	.stage.pen-tool {
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M12 2 5.4 8.6l3.2 9.8h6.8l3.2-9.8L12 2Z' fill='%23f4f8fc' stroke='%230d1522' stroke-width='1.5'/%3E%3Ccircle cx='12' cy='10.5' r='2' fill='%230d1522'/%3E%3Cpath d='M12 12.5V21' stroke='%230d1522' stroke-width='1.5'/%3E%3C/svg%3E")
				12 21,
			crosshair;
	}
	.composition-surface {
		pointer-events: none;
		filter: drop-shadow(0 18px 28px #0008);
	}
	.stage :global(g[role='button']) {
		cursor: move;
	}
	.pen-draft {
		pointer-events: none;
	}
	.pen-draft path {
		fill: none;
		stroke: #cfeaa9;
		stroke-width: 1.5;
		stroke-dasharray: 5 3;
		vector-effect: non-scaling-stroke;
	}
	.pen-draft circle {
		fill: var(--panel-raised);
		stroke: #cfeaa9;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.pen-draft .draft-handle-line {
		stroke: #91b8e5;
		stroke-width: 1;
		stroke-dasharray: none;
		vector-effect: non-scaling-stroke;
	}
	.pen-draft .draft-handle {
		fill: var(--panel-raised);
		stroke: #91b8e5;
	}
	.pen-draft .draft-anchor {
		fill: #cfeaa9;
		stroke: var(--ink);
	}
	.path-editor {
		pointer-events: none;
	}
	.path-handle-line {
		stroke: #91b8e5;
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
	.path-handle,
	.path-anchor {
		pointer-events: all;
		vector-effect: non-scaling-stroke;
	}
	.path-handle {
		fill: var(--panel-raised);
		stroke: #91b8e5;
		stroke-width: 1;
		cursor: crosshair;
	}
	.path-anchor {
		fill: #cfeaa9;
		stroke: var(--ink);
		stroke-width: 1;
		cursor: move;
	}
	.pen-actions {
		position: absolute;
		z-index: 8;
		left: 50%;
		bottom: 18px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px;
		border: 1px solid var(--line-bright);
		border-radius: 8px;
		background: var(--panel);
		box-shadow: 0 8px 22px #0005;
		color: #a7b8cd;
		font-size: var(--type-meta);
		white-space: nowrap;
	}
	.pen-actions span {
		padding: 0 5px;
	}
	.pen-actions button {
		min-height: 26px;
		padding: 0 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--paper);
		font: inherit;
		cursor: pointer;
	}
	.pen-actions button:hover:not(:disabled),
	.pen-actions button:focus-visible:not(:disabled) {
		background: var(--accent);
		outline: none;
	}
	.pen-actions button:nth-of-type(2) {
		background: var(--acid);
		color: var(--acid-ink);
	}
	.pen-actions button:disabled {
		opacity: 0.38;
		cursor: default;
	}
	.selection-controls {
		pointer-events: none;
	}
	.selection-box {
		fill: none;
		stroke: #cfeaa9;
		stroke-width: 1;
		stroke-dasharray: 4 2;
		vector-effect: non-scaling-stroke;
	}
	.group-hit-area {
		pointer-events: all;
		fill: transparent;
		cursor: move;
	}
	.group-label {
		fill: #cfeaa9;
		font: 600 12px/1 var(--sans);
		letter-spacing: 0.02em;
		paint-order: stroke;
		stroke: var(--ink);
		stroke-width: 3px;
		pointer-events: none;
	}
	.selection-controls line {
		stroke: #cfeaa9;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.resize-handle,
	.rotation-handle {
		pointer-events: all;
		fill: var(--panel-raised);
		stroke: #cfeaa9;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.resize-handle {
		cursor: nwse-resize;
	}
	.resize-handle:not(.corner) {
		cursor: ns-resize;
	}
	.rotation-handle {
		cursor: grab;
	}
	.stage-nav {
		position: absolute;
		right: 18px;
		top: 14px;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 4px;
		border: 1px solid color-mix(in srgb, var(--line) 84%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--ink) 88%, transparent);
		box-shadow: 0 8px 22px #0004;
		font: 500 11px/1 var(--mono);
		color: #a7b8cd;
	}
	.stage-nav button {
		min-height: 24px;
		padding: 0 7px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.stage-nav button:hover,
	.stage-nav button:focus-visible {
		background: var(--accent);
		color: var(--paper);
		outline: none;
	}
	.stage-nav span {
		min-width: 36px;
		padding: 0 3px;
		text-align: center;
	}
	.marquee {
		fill: #65dff824;
		stroke: var(--acid);
		stroke-width: 1;
		stroke-dasharray: 4 3;
		vector-effect: non-scaling-stroke;
	}
	.stage :global(g[role='button']:focus) {
		outline: none;
	}
	.stage:has(:global(g[role='button']:focus-visible)) {
		outline: 2px solid var(--acid);
		outline-offset: 3px;
	}
	.canvas-meta {
		height: 26px;
		min-height: 26px;
		display: flex;
		justify-content: space-between;
		padding: 0 18px;
		align-items: center;
		font: 400 var(--type-meta) / 1 var(--mono);
		color: #5f738c;
	}
	@media (max-width: 1000px) {
		.stage-wrap {
			padding: 76px 20px 20px;
		}
	}
	@media (max-width: 767px) {
		.stage-wrap {
			padding-top: 104px;
		}
	}
</style>
