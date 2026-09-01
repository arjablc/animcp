<script lang="ts">
	import { value, type Layer, type Value } from '../model';
	import type { MotionSession } from '../session.svelte';
	import { propertyEdits, previewLayer as sessionPreviewLayer } from '../editing';
	import { ancestorOpacity, ancestorTransform, effectivelyVisible, layerSvg, transform } from '../render';
	import GradientHandles from './GradientHandles.svelte';

	let { session, onImport }: { session: MotionSession; onImport: (files: FileList) => void } =
		$props();
	type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
	type Viewport = { x: number; y: number; zoom: number };

	let stage: SVGSVGElement;
	let stageWrap: HTMLDivElement;
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

	// $derived recalculates whenever the session selection or project changes.
	const selected = $derived(
		session.project.layers.find((layer) => layer.id === session.context.selectedLayerIds[0])
	);
	// SVG controls need more composition units as the canvas gets physically smaller,
	// otherwise their screen hit areas shrink below a usable target.
	const controlSize = $derived(12 / viewport.zoom);
	const controlOffset = $derived(40 / viewport.zoom);

	function point(event: PointerEvent) {
		const point = stage.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		return point.matrixTransform(stage.getScreenCTM()!.inverse());
	}

	function viewBox() {
		const { width, height } = session.project.composition;
		return `${viewport.x} ${viewport.y} ${width / viewport.zoom} ${height / viewport.zoom}`;
	}

	function fit() {
		viewport = { x: 0, y: 0, zoom: 1 };
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
		const currentWidth = width / viewport.zoom,
			currentHeight = height / viewport.zoom;
		const nextZoom = Math.max(0.25, Math.min(8, viewport.zoom * Math.exp(-event.deltaY * 0.0015)));
		if (nextZoom === viewport.zoom) return;
		const ratioX = (current.x - viewport.x) / currentWidth,
			ratioY = (current.y - viewport.y) / currentHeight;
		const nextWidth = width / nextZoom,
			nextHeight = height / nextZoom;
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

	function rotatePoint(
		point: { x: number; y: number },
		center: { x: number; y: number },
		degrees: number
	) {
		const radians = (degrees * Math.PI) / 180;
		const dx = point.x - center.x,
			dy = point.y - center.y;
		return {
			x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
			y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians)
		};
	}

	function localPoint(
		point: { x: number; y: number },
		base: Record<'positionX' | 'positionY' | 'width' | 'height' | 'rotation', number>
	) {
		const center = {
			x: base.positionX + base.width / 2,
			y: base.positionY + base.height / 2
		};
		const unrotated = rotatePoint(point, center, -base.rotation);
		return { x: unrotated.x - base.positionX, y: unrotated.y - base.positionY };
	}

	function displayLayer(layer: Layer) {
		if (!transforming || transforming.layerId !== layer.id)
			return sessionPreviewLayer(layer, session.preview);
		return {
			...layer,
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

	function bounds(layer: Layer, frame: number) {
		const x = value(layer, 'positionX', frame),
			y = value(layer, 'positionY', frame),
			width = Math.max(0.001, value(layer, 'width', frame) * value(layer, 'scaleX', frame)),
			height = Math.max(0.001, value(layer, 'height', frame) * value(layer, 'scaleY', frame));
		return { x, y, width, height };
	}

	function visualBounds(layer: Layer, frame: number) {
		const x = value(layer, 'positionX', frame),
			y = value(layer, 'positionY', frame),
			width = Math.max(0.001, value(layer, 'width', frame)),
			height = Math.max(0.001, value(layer, 'height', frame)),
			scaleX = value(layer, 'scaleX', frame),
			scaleY = value(layer, 'scaleY', frame),
			rotation = (value(layer, 'rotation', frame) * Math.PI) / 180,
			center = { x: x + width / 2, y: y + height / 2 };
		const corners = [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height }
		].map((corner) => {
			const dx = (corner.x - center.x) * scaleX,
				dy = (corner.y - center.y) * scaleY;
			return {
				x: center.x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
				y: center.y + dx * Math.sin(rotation) + dy * Math.cos(rotation)
			};
		});
		const left = Math.min(...corners.map((corner) => corner.x)),
			top = Math.min(...corners.map((corner) => corner.y)),
			right = Math.max(...corners.map((corner) => corner.x)),
			bottom = Math.max(...corners.map((corner) => corner.y));
		return { x: left, y: top, width: right - left, height: bottom - top };
	}

	function selectionBounds(layer: Layer, frame: number) {
		if (layer.type !== 'group')
			return {
				x: 0,
				y: 0,
				width: Math.max(0.001, value(layer, 'width', frame)),
				height: Math.max(0.001, value(layer, 'height', frame))
			};
		const children = session.project.layers.filter(
			(child) => child.parentId === layer.id && child.visible
		);
		if (!children.length)
			return {
				x: 0,
				y: 0,
				width: Math.max(0.001, value(layer, 'width', frame)),
				height: Math.max(0.001, value(layer, 'height', frame))
			};
		const childBounds = children.map((child) => visualBounds(child, frame));
		const left = Math.min(...childBounds.map((child) => child.x)),
			top = Math.min(...childBounds.map((child) => child.y)),
			right = Math.max(...childBounds.map((child) => child.x + child.width)),
			bottom = Math.max(...childBounds.map((child) => child.y + child.height));
		return { x: left, y: top, width: right - left, height: bottom - top };
	}

	function intersects(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
		return (
			a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
		);
	}

	function guideFrame(layer: Layer) {
		const current = session.context.currentFrame,
			canvas = {
				x: 0,
				y: 0,
				width: session.project.composition.width,
				height: session.project.composition.height
			},
			visible =
				value(layer, 'opacity', current) > 0.02 && intersects(bounds(layer, current), canvas);
		if (visible) return null;
		const frames = [
			...new Set(Object.values(layer.tracks).flatMap((track) => track.keys.map((key) => key.frame)))
		].sort((a, b) => a - b);
		return (
			frames.find(
				(frame) =>
					frame > current &&
					value(layer, 'opacity', frame) > 0.02 &&
					intersects(bounds(layer, frame), canvas)
			) ?? null
		);
	}

	function dragOffset(id: string) {
		return dragging?.layers.some((layer) => layer.id === id) ? dragging : null;
	}

	function finish() {
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
				(layer) => layer.visible && intersects(bounds(layer, session.context.currentFrame), box)
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
		bind:this={stage}
		viewBox={viewBox()}
		style:background={session.project.composition.background}
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
		}}
		onwheel={navigateWheel}
		oncontextmenu={(event) => event.preventDefault()}
	>
		<title>Motion composition</title>
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
				<g transform={dragOffset(layer.id) ? `translate(${dragging!.dx} ${dragging!.dy})` : undefined}>
					<!-- layerSvg renders escaped, validated project data rather than user-provided HTML. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html layerSvg(session.project, layer, session.context.currentFrame)}
				</g>
			</g>
		{/each}
		{#if selected && !selected.locked && effectivelyVisible(session.project, selected)}{@const layer = displayLayer(selected)}
			{@const frame = session.context.currentFrame}
			{@const box = selectionBounds(layer, frame)}
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
				{#each [{ handle: 'nw' as TransformHandle, x: box.x, y: box.y }, { handle: 'n' as TransformHandle, x: box.x + box.width / 2, y: box.y }, { handle: 'ne' as TransformHandle, x: box.x + box.width, y: box.y }, { handle: 'e' as TransformHandle, x: box.x + box.width, y: box.y + box.height / 2 }, { handle: 'se' as TransformHandle, x: box.x + box.width, y: box.y + box.height }, { handle: 's' as TransformHandle, x: box.x + box.width / 2, y: box.y + box.height }, { handle: 'sw' as TransformHandle, x: box.x, y: box.y + box.height }, { handle: 'w' as TransformHandle, x: box.x, y: box.y + box.height / 2 }] as control}
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
				{/each}
				{/if}
			</g>
			</g>
		{/if}
		{#each session.project.layers.filter((layer) => layer.type !== 'group' && effectivelyVisible(session.project, layer)) as layer (layer.id)}
			{@const frame = guideFrame(layer)}
			{#if frame !== null}{@const guide = bounds(layer, frame)}
				<g class="motion-guide" pointer-events="none" aria-hidden="true">
					<rect x={guide.x} y={guide.y} width={guide.width} height={guide.height} />
					<text
						x={guide.x + 8}
						y={guide.y - 10}
						font-size={Math.max(16, session.project.composition.width / 60)}
						>{layer.name} · next visible frame</text
					>
				</g>
			{/if}
		{/each}
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
	<div class="stage-nav" aria-label="Canvas navigation">
		<button type="button" onclick={fit}>Fit</button>
		<button type="button" onclick={() => (viewport = { ...viewport, zoom: 1, x: 0, y: 0 })}
			>100%</button
		>
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
	.motion-guide rect {
		fill: #65dff80d;
		stroke: #65dff8a8;
		stroke-dasharray: 5 5;
		vector-effect: non-scaling-stroke;
	}
	.motion-guide text {
		fill: #a8dbe7;
		font-family: var(--sans);
		font-weight: 500;
		paint-order: stroke;
		stroke: var(--ink);
		stroke-width: 3px;
		stroke-linejoin: round;
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
