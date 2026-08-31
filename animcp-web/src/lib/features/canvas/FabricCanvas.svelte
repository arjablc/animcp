<script lang="ts">
	import { onMount } from 'svelte';
	import { Canvas, Path, PencilBrush, Point, Rect } from 'fabric';
	import type { AnimationProject, PathData, ShapeKeyframe } from '../animation/model';
	import { evaluateLayer } from '../animation/interpolation';
	import { fromFabricPath, toFabricPath, transformMatrix } from './path-adapter';
	import { createEditorPathControls, pathMatrix } from './path-controls';
	import { addPenPoint, dragPenPoint, type PenDraft } from './pen-path';

	export type CanvasTool = 'select' | 'pencil' | 'pen' | 'hand';
	let {
		project,
		currentFrame,
		selectedLayerId,
		tool,
		stroke = '#00c3ff',
		strokeWidth = 4,
		zoom = 1,
		fitToken = 0,
		onselect,
		oncreate,
		onchange,
		onpointselect = () => {},
		onerror,
		onzoom = () => {}
	} = $props<{
		project: AnimationProject;
		currentFrame: number;
		selectedLayerId: string | null;
		tool: CanvasTool;
		stroke?: string;
		strokeWidth?: number;
		zoom?: number;
		fitToken?: number;
		onselect: (id: string | null) => void;
		oncreate: (paths: PathData[]) => void;
		onchange: (id: string, keyframe: Partial<ShapeKeyframe>) => void;
		onpointselect?: (index: number) => void;
		onerror: (message: string) => void;
		onzoom?: (zoom: number) => void;
	}>();
	let element: HTMLCanvasElement;
	let container: HTMLDivElement;
	let canvas = $state.raw<Canvas>();
	let projecting = false;
	let panning: { x: number; y: number } | undefined;
	let pen: PenDraft = { paths: [] };
	let curveDrag: { index: number; point: { x: number; y: number } } | undefined;
	let draftPath: Path | undefined;
	const ids = new WeakMap<Path, string>();

	function report(error: unknown) {
		onerror(error instanceof Error ? error.message : 'Canvas operation failed.');
	}
	function fit() {
		if (!canvas || !container) return;
		const width = container.clientWidth,
			height = container.clientHeight;
		canvas.setDimensions({ width, height });
		const scale = Math.min(
			(width - 64) / project.canvas.width,
			(height - 64) / project.canvas.height,
			1.8
		);
		const z = Math.max(0.05, scale);
		canvas.setViewportTransform([
			z,
			0,
			0,
			z,
			(width - project.canvas.width * z) / 2,
			(height - project.canvas.height * z) / 2
		]);
		onzoom(z);
	}
	function renderDraft(instance: Canvas) {
		if (draftPath) instance.remove(draftPath);
		draftPath = undefined;
		if (pen.paths.length < 2) return;
		draftPath = new Path(toFabricPath([pen.paths]), {
			stroke,
			strokeWidth,
			fill: '',
			selectable: false,
			evented: false
		});
		instance.add(draftPath);
		instance.requestRenderAll();
	}
	function finishPen() {
		if (pen.paths.length > 1) {
			try {
				oncreate([structuredClone(pen.paths)]);
			} catch (error) {
				report(error);
			}
		}
		pen = { paths: [] };
		curveDrag = undefined;
		if (draftPath && canvas) canvas.remove(draftPath);
		draftPath = undefined;
		canvas?.requestRenderAll();
	}
	function cancelPen() {
		pen = { paths: [] };
		curveDrag = undefined;
		if (draftPath && canvas) canvas.remove(draftPath);
		draftPath = undefined;
	}
	export function finishPath() {
		finishPen();
	}

	onMount(() => {
		const instance = new Canvas(element, {
			selection: false,
			preserveObjectStacking: true,
			backgroundColor: '#0b1014',
			uniformScaling: false
		});
		instance.freeDrawingBrush = new PencilBrush(instance);
		canvas = instance;
		const observer = new ResizeObserver(fit);
		observer.observe(container);
		fit();
		const disposeCreated = instance.on('path:created', ({ path }) => {
			if (!(path instanceof Path)) return;
			try {
				oncreate([fromFabricPath(path.path)]);
			} catch (error) {
				instance.remove(path);
				report(error);
			}
		});
		const selection = () => {
			if (!projecting) {
				const active = instance.getActiveObject();
				onselect(active instanceof Path ? (ids.get(active) ?? null) : null);
			}
		};
		const offSelected = instance.on('selection:created', selection);
		const offUpdated = instance.on('selection:updated', selection);
		const offCleared = instance.on('selection:cleared', selection);
		const modified = instance.on('object:modified', ({ target, transform }) => {
			if (projecting || !(target instanceof Path)) return;
			const id = ids.get(target);
			if (!id) return;
			try {
				const m = pathMatrix(target);
				const changes: Partial<ShapeKeyframe> = {
					transform: {
						x: m[4],
						y: m[5],
						scaleX: target.scaleX * (target.flipX ? -1 : 1),
						scaleY: target.scaleY * (target.flipY ? -1 : 1),
						rotation: target.angle
					}
				};
				if (transform?.action === 'modifyPath') changes.paths = [fromFabricPath(target.path)];
				onchange(id, changes);
			} catch (error) {
				report(error);
			}
		});
		const down = instance.on('mouse:down', ({ e, scenePoint, target }) => {
			if (tool === 'hand') {
				const p = e as PointerEvent;
				panning = { x: p.clientX, y: p.clientY };
				return;
			}
			if (tool === 'pen' && !target && !selectedLayerId) {
				const point = { x: scenePoint.x, y: scenePoint.y };
				pen = addPenPoint(pen, point);
				if ((e as PointerEvent).shiftKey) curveDrag = { index: pen.paths.length - 1, point };
				renderDraft(instance);
			}
		});
		const move = instance.on('mouse:move', ({ e }) => {
			if (curveDrag && tool === 'pen' && !selectedLayerId) {
				const pointer = instance.getScenePoint(e);
				pen = dragPenPoint(pen, curveDrag.index, curveDrag.point, pointer);
				renderDraft(instance);
			}
			if (!panning) return;
			const p = e as PointerEvent;
			instance.relativePan(new Point(p.clientX - panning.x, p.clientY - panning.y));
			panning = { x: p.clientX, y: p.clientY };
		});
		const up = instance.on('mouse:up', () => {
			panning = undefined;
			curveDrag = undefined;
		});
		const doubleClick = instance.on('mouse:dblclick', () => {
			if (tool === 'pen' && !selectedLayerId) finishPen();
		});
		const wheel = instance.on('mouse:wheel', ({ e }) => {
			e.preventDefault();
			e.stopPropagation();
			const next = Math.max(0.05, Math.min(8, instance.getZoom() * 0.999 ** e.deltaY));
			instance.zoomToPoint(new Point(e.offsetX, e.offsetY), next);
			onzoom(next);
		});
		function key(event: KeyboardEvent) {
			if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))
				return;
			if (event.key === 'Enter' && tool === 'pen' && !selectedLayerId) {
				event.preventDefault();
				finishPen();
			}
			if (event.key === 'Escape') {
				cancelPen();
				onselect(null);
			}
		}
		window.addEventListener('keydown', key);
		return () => {
			observer.disconnect();
			window.removeEventListener('keydown', key);
			[
				disposeCreated,
				offSelected,
				offUpdated,
				offCleared,
				modified,
				down,
				move,
				up,
				doubleClick,
				wheel
			].forEach((dispose) => dispose());
			canvas = undefined;
			void instance.dispose();
		};
	});

	$effect(() => {
		const instance = canvas;
		if (!instance) return;
		const snapshot = project;
		const frame = currentFrame;
		const selected = selectedLayerId;
		const mode = tool;
		projecting = true;
		try {
			cancelPen();
			instance.discardActiveObject();
			instance.remove(...instance.getObjects());
			instance.add(
				new Rect({
					left: 0,
					top: 0,
					width: snapshot.canvas.width,
					height: snapshot.canvas.height,
					fill: snapshot.canvas.background,
					strokeWidth: 0,
					selectable: false,
					evented: false
				})
			);
			for (const layer of [...snapshot.layers].sort((a, b) => a.zIndex - b.zIndex)) {
				const value = evaluateLayer(layer, frame);
				if (!layer.visible || !value) continue;
				const object = new Path(toFabricPath(value.paths), {
					originX: 'center',
					originY: 'center',
					stroke: layer.style.stroke,
					strokeWidth: layer.style.strokeWidth,
					strokeLineCap: layer.style.strokeLineCap,
					strokeLineJoin: layer.style.strokeLineJoin,
					fill: layer.style.fill ?? '',
					opacity: layer.style.opacity * (value.opacity ?? 1),
					selectable: !layer.locked && (mode === 'select' || mode === 'pen'),
					evented: !layer.locked && mode !== 'hand' && mode !== 'pencil',
					lockSkewingX: true,
					lockSkewingY: true,
					lockScalingFlip: true,
					cornerColor: '#dfff4f',
					borderColor: '#dfff4f',
					transparentCorners: false,
					padding: 5
				});
				const m = transformMatrix(value.transform);
				object.set({
					left: m[4] + m[0] * object.pathOffset.x + m[2] * object.pathOffset.y,
					top: m[5] + m[1] * object.pathOffset.x + m[3] * object.pathOffset.y,
					scaleX: value.transform.scaleX,
					scaleY: value.transform.scaleY,
					angle: value.transform.rotation
				});
				ids.set(object, layer.id);
				instance.add(object);
				object.setCoords();
				if (layer.id === selected && !layer.locked && mode !== 'pencil' && mode !== 'hand') {
					if (mode === 'pen') object.controls = createEditorPathControls(object, onpointselect);
					instance.setActiveObject(object);
				}
			}
			instance.isDrawingMode = mode === 'pencil';
			instance.defaultCursor = mode === 'hand' ? 'grab' : mode === 'pen' ? 'crosshair' : 'default';
			if (instance.freeDrawingBrush) {
				instance.freeDrawingBrush.color = stroke;
				instance.freeDrawingBrush.width = strokeWidth;
			}
			instance.requestRenderAll();
		} finally {
			projecting = false;
		}
	});
	$effect(() => {
		fitToken;
		project.canvas.width;
		project.canvas.height;
		if (canvas) fit();
	});
	$effect(() => {
		if (canvas && Math.abs(canvas.getZoom() - zoom) > 0.001)
			canvas.zoomToPoint(new Point(canvas.width / 2, canvas.height / 2), zoom);
	});
</script>

<div class="fabric-viewport" bind:this={container}>
	<canvas
		bind:this={element}
		aria-label="Animation canvas. Use the layer, path point, and transform controls for keyboard editing."
	></canvas>
	<div class="canvas-hint">
		{tool === 'pencil'
			? 'Draw a stroke · each stroke becomes a layer'
			: tool === 'pen'
				? selectedLayerId
					? 'Drag anchors and curve handles · Escape to deselect'
					: 'Click for corners · Shift-drag a point for Bézier handles · Enter to finish'
				: tool === 'hand'
					? 'Drag to pan · scroll to zoom'
					: 'Select and transform · scroll to zoom'}
	</div>
</div>

<style>
	.fabric-viewport {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 280px;
		overflow: hidden;
	}
	.canvas-hint {
		pointer-events: none;
		position: absolute;
		left: 18px;
		bottom: 14px;
		color: #9ca8ad;
		font: 11px var(--mono);
		background: #0b1014cc;
		padding: 7px 10px;
		border-radius: 5px;
	}
</style>
