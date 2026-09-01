<script lang="ts">
	import { value, type Layer } from '../model';
	import { transform } from '../render';
	import { propertyEdits } from '../editing';
	import type { MotionSession } from '../session.svelte';
	let { session, layer }: { session: MotionSession; layer: Layer } = $props();
	let group = $state<SVGGElement>() as SVGGElement;
	let drag = $state<{
		properties: string[];
		values: number[];
		revision: number;
		frame: number;
	} | null>(null);
	const f = $derived(session.context.currentFrame),
		w = $derived(value(layer, 'width', f)),
		h = $derived(value(layer, 'height', f));
	const points = $derived(
		layer.paint.type === 'linear'
			? [
					{
						label: 'Gradient start',
						properties: ['startX', 'startY'],
						x: value(layer, 'gradient.startX', f) * w,
						y: value(layer, 'gradient.startY', f) * h
					},
					{
						label: 'Gradient end',
						properties: ['endX', 'endY'],
						x: value(layer, 'gradient.endX', f) * w,
						y: value(layer, 'gradient.endY', f) * h
					}
				]
			: [
					{
						label: 'Gradient center',
						properties: ['centerX', 'centerY'],
						x: value(layer, 'gradient.centerX', f) * w,
						y: value(layer, 'gradient.centerY', f) * h
					},
					{
						label: 'Gradient focus',
						properties: ['focalX', 'focalY'],
						x: value(layer, 'gradient.focalX', f) * w,
						y: value(layer, 'gradient.focalY', f) * h
					},
					{
						label: 'Gradient radius',
						properties: ['radius'],
						x:
							value(layer, 'gradient.centerX', f) * w +
							value(layer, 'gradient.radius', f) * Math.min(w, h),
						y: value(layer, 'gradient.centerY', f) * h
					}
				]
	);
	function start(e: PointerEvent, properties: string[]) {
		e.stopPropagation();
		session.playing = false;
		drag = {
			properties,
			values: properties.map((p) => value(layer, `gradient.${p}`, f)),
			revision: session.project.revision,
			frame: f
		};
		(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(group.getScreenCTM()!.inverse());
		drag = {
			...drag,
			values:
				drag.properties.length === 1
					? [
							Math.max(
								0.001,
								Math.hypot(
									pt.x - value(layer, 'gradient.centerX', f) * w,
									pt.y - value(layer, 'gradient.centerY', f) * h
								) / Math.min(w, h)
							)
						]
					: [pt.x / w, pt.y / h]
		};
	}
	function finish() {
		const d = drag;
		drag = null;
		if (!d) return;
		try {
			session.commit(
				propertyEdits(
					layer,
					Object.fromEntries(d.properties.map((p, i) => [`gradient.${p}`, d.values[i]])),
					d.frame,
					session.autoKey
				),
				'Moved gradient handle',
				'human',
				d.revision
			);
		} catch (e) {
			session.error = String(e);
		}
	}
</script>

<g bind:this={group} transform={transform(layer, f)}>
	<line
		x1={points[0].x}
		y1={points[0].y}
		x2={points.at(-1)!.x}
		y2={points.at(-1)!.y}
		stroke="#fff"
		stroke-width="1"
		vector-effect="non-scaling-stroke"
		pointer-events="none"
	/>
	{#each points as point}<circle
			role="button"
			tabindex="0"
			aria-label={point.label}
			cx={drag?.properties[0] === point.properties[0] && drag.values.length === 2
				? drag.values[0] * w
				: point.x}
			cy={drag?.properties[0] === point.properties[0] && drag.values.length === 2
				? drag.values[1] * h
				: point.y}
			r="6"
			fill="#0b1220"
			stroke="#65dff8"
			stroke-width="2"
			vector-effect="non-scaling-stroke"
			onpointerdown={(e) => start(e, point.properties)}
			onpointermove={move}
			onpointerup={finish}
			onpointercancel={() => (drag = null)}
			><title>{point.label} — drag to edit; use inspector for keyboard input</title></circle
		>{/each}
</g>

<style>
	circle {
		cursor: crosshair;
		touch-action: none;
	}
</style>
