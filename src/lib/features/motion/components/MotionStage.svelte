<script lang="ts">
	import { value, type Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	import { propertyEdits, previewLayer } from '../editing';
	import { layerSvg, transform } from '../render';
	import GradientHandles from './GradientHandles.svelte';

	let { session, onImport }: { session: MotionSession; onImport: (files: FileList) => void } =
		$props();
	let stage: SVGSVGElement;
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

	// $derived recalculates whenever the session selection or project changes.
	const selected = $derived(
		session.project.layers.find((layer) => layer.id === session.context.selectedLayerIds[0])
	);

	function point(event: PointerEvent) {
		const point = stage.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		return point.matrixTransform(stage.getScreenCTM()!.inverse());
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
		session.select([layer.id]);
		const frame = session.context.currentFrame;
		dragging = {
			id: layer.id,
			startX: start.x,
			startY: start.y,
			x: value(layer, 'positionX', frame),
			y: value(layer, 'positionY', frame),
			dx: 0,
			dy: 0,
			revision: session.project.revision,
			frame
		};
		stage.setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent) {
		if (!dragging) return;
		const current = point(event);
		dragging = {
			...dragging,
			dx: current.x - dragging.startX,
			dy: current.y - dragging.startY
		};
	}

	function finish() {
		const drag = dragging;
		dragging = null;
		if (!drag || Math.abs(drag.dx) + Math.abs(drag.dy) < 0.1) return;
		try {
			const layer = session.project.layers.find((item) => item.id === drag.id)!;
			session.commit(
				propertyEdits(
					layer,
					{ positionX: drag.x + drag.dx, positionY: drag.y + drag.dy },
					drag.frame,
					session.autoKey
				),
				'Moved layer',
				'human',
				drag.revision
			);
			session.error = '';
		} catch (error) {
			session.error = String(error);
		}
	}
</script>

<div
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
		viewBox={`0 0 ${session.project.composition.width} ${session.project.composition.height}`}
		style:background={session.project.composition.background}
		role="img"
		aria-label="Animation canvas"
		onpointermove={move}
		onpointerup={finish}
		onpointercancel={() => (dragging = null)}
	>
		<title>Motion composition</title>
		{#each session.project.layers.filter((layer) => layer.visible) as raw (raw.id)}
			{@const layer = previewLayer(raw, session.preview)}
			<g
				role="button"
				tabindex="0"
				aria-label={`Select ${layer.name}`}
				onpointerdown={(event) => startDrag(event, raw)}
				onkeydown={(event) => {
					if (event.key === 'Enter') session.select([layer.id]);
				}}
				transform={dragging?.id === layer.id
					? `translate(${dragging.dx} ${dragging.dy})`
					: undefined}
			>
				<!-- layerSvg renders escaped, validated project data rather than user-provided HTML. -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html layerSvg(session.project, layer, session.context.currentFrame)}
			</g>
		{/each}
		{#each session.project.layers.filter((layer) => session.context.selectedLayerIds.includes(layer.id) && layer.visible) as raw (raw.id)}
			{@const layer = previewLayer(raw, session.preview)}
			<g
				pointer-events="none"
				transform={dragging?.id === layer.id
					? `translate(${dragging.dx} ${dragging.dy})`
					: undefined}
			>
				<rect
					transform={transform(layer, session.context.currentFrame)}
					width={Math.max(0.001, value(layer, 'width', session.context.currentFrame))}
					height={Math.max(0.001, value(layer, 'height', session.context.currentFrame))}
					fill="none"
					stroke="#cfeaa9"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
			</g>
		{/each}
		{#if selected && selected.paint.type !== 'solid' && !selected.locked && selected.visible}
			<GradientHandles {session} layer={selected} />
		{/if}
	</svg>
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
