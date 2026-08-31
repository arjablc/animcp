<script lang="ts">
	import { presets, easingAt, type Layer, type Key, type Easing } from './model';
	import type { MotionSession } from './session.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ClipboardCopy, ClipboardPaste, Spline, Timer, ArrowRight } from '@lucide/svelte';
	import NumericInput from './NumericInput.svelte';
	let {
		session,
		layer,
		property,
		start,
		end
	}: { session: MotionSession; layer: Layer; property: string; start: Key; end: Key } = $props();
	let copied = $state<Easing | null>(null),
		curvePreview = $state<{ x1: number; y1: number; x2: number; y2: number } | null>(null),
		drag = $state<'first' | 'second' | null>(null);
	let graph = $state<SVGSVGElement>() as SVGSVGElement;
	let revision = 0;
	const curve = $derived(
		curvePreview ?? (start.easing.type === 'bezier' ? start.easing : { x1: 0, y1: 0, x2: 1, y2: 1 })
	);
	const preset = $derived(
		Object.entries(presets).find(
			([, e]) => JSON.stringify(e) === JSON.stringify(start.easing)
		)?.[0] ?? 'custom'
	);
	const springPath = $derived(start.easing.type === 'spring'
		? Array.from({ length: 41 }, (_, i) => `${i ? 'L' : 'M'}${20 + i * 5} ${140 - Math.max(-2, Math.min(3, easingAt(start.easing, i / 40))) * 24}`).join('')
		: '');
	function apply(e: Easing, expected?: number) {
		try {
			session.commit(
				[
					{
						name: 'set_easing',
						input: {
							layerIds: [layer.id],
							properties: [property],
							keyframeIds: [start.id],
							easing: JSON.parse(JSON.stringify(e))
						}
					}
				],
				'Changed animation easing',
				'human',
				expected
			);
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
	function timing(key: Key, frame: number) {
		try {
			session.run(
				'move_keyframes',
				{ keyframeIds: [key.id], frames: Math.round(frame) - key.frame },
				'Changed animation timing'
			);
		} catch (e) {
			session.error = String(e);
		}
	}
	function down(e: PointerEvent, handle: 'first' | 'second') {
		e.stopPropagation();
		drag = handle;
		revision = session.project.revision;
		(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(graph.getScreenCTM()!.inverse());
		const x = Math.max(0, Math.min(1, (p.x - 20) / 200)),
			y = Math.max(-2, Math.min(3, 1 - (p.y - 20) / 120));
		curvePreview = drag === 'first' ? { ...curve, x1: x, y1: y } : { ...curve, x2: x, y2: y };
	}
	function up() {
		if (drag && curvePreview) apply({ type: 'bezier', ...curvePreview }, revision);
		drag = null;
		curvePreview = null;
	}
</script>

<section class="easing-inspector">
	<div class="section-heading">
		<span><Spline size={14} /> Animation easing</span>
		<div>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Copy easing"
				title="Copy easing"
				onclick={() => (copied = JSON.parse(JSON.stringify(start.easing)))}
				><ClipboardCopy /></Button
			><Button
				variant="ghost"
				size="icon-xs"
				aria-label="Paste easing"
				title="Paste easing"
				disabled={!copied}
				onclick={() => copied && apply(copied)}><ClipboardPaste /></Button
			>
		</div>
	</div>
	<p>{property} <span>{end.frame - start.frame} frames</span></p>
	<div class="segment-times">
		<Timer size={13} /><NumericInput
			label="Animation start frame"
			value={start.frame}
			min={0}
			max={end.frame - 1}
			oncommit={(v) => timing(start, v)}
		/><ArrowRight size={13} /><NumericInput
			label="Animation end frame"
			value={end.frame}
			min={start.frame + 1}
			max={session.project.composition.durationFrames - 1}
			oncommit={(v) => timing(end, v)}
		/>
	</div>
	<svg bind:this={graph} viewBox="0 0 240 160" class="curve" aria-label="Animation easing curve"
		><path
			class="grid"
			d="M20 20V140H220M20 80H220M120 20V140"
		/>{#if start.easing.type === 'spring'}<path class="motion-curve" d={springPath} />{:else if start.easing.type === 'hold' && !curvePreview}<path
				class="motion-curve"
				d="M20 140H220V20"
			/>{:else}<line x1="20" y1="140" x2={20 + curve.x1 * 200} y2={140 - curve.y1 * 120} /><line
				x1="220"
				y1="20"
				x2={20 + curve.x2 * 200}
				y2={140 - curve.y2 * 120}
			/><path
				class="motion-curve"
				d={`M20 140 C${20 + curve.x1 * 200} ${140 - curve.y1 * 120} ${20 + curve.x2 * 200} ${140 - curve.y2 * 120} 220 20`}
			/><circle
				role="button"
				tabindex="0"
				aria-label="First easing handle"
				cx={20 + curve.x1 * 200}
				cy={140 - curve.y1 * 120}
				r="6"
				onpointerdown={(e) => down(e, 'first')}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={() => {
					drag = null;
					curvePreview = null;
				}}
			/><circle
				role="button"
				tabindex="0"
				aria-label="Second easing handle"
				cx={20 + curve.x2 * 200}
				cy={140 - curve.y2 * 120}
				r="6"
				onpointerdown={(e) => down(e, 'second')}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={() => {
					drag = null;
					curvePreview = null;
				}}
			/>{/if}</svg
	>
	<div class="presets">
		{#each ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'snappy', 'smooth', 'hold', 'spring-gentle', 'spring-snappy', 'spring-bouncy'] as name}<Button
				variant="ghost"
				size="xs"
				class={preset === name ? 'preset active' : 'preset'}
				onclick={() => apply(presets[name])}>{name.replaceAll('-', ' ')}</Button
			>{/each}
	</div>
	{#if start.easing.type === 'spring'}<div class="control-values spring-values">
		{#each ['mass', 'stiffness', 'damping', 'velocity'] as key}<label>{key}<NumericInput label={`Spring ${key}`} value={start.easing[key as keyof typeof start.easing] as number} min={key === 'mass' ? 0.01 : key === 'stiffness' ? 1 : key === 'damping' ? 0 : -100} max={key === 'mass' ? 10 : key === 'stiffness' ? 2000 : key === 'damping' ? 200 : 100} step={0.1} oncommit={(v) => apply({ ...start.easing, [key]: v })} /></label>{/each}
	</div>{:else}<div class="control-values">
		{#each ['x1', 'y1', 'x2', 'y2'] as key}<label
				>{key}<NumericInput
					label={`Easing ${key}`}
					value={curve[key as keyof typeof curve]}
					min={key.startsWith('x') ? 0 : -10}
					max={key.startsWith('x') ? 1 : 10}
					step={0.01}
					oncommit={(v) => apply({ type: 'bezier', ...curve, [key]: v })}
				/></label
			>{/each}
	</div>{/if}
	<small>Changes apply to this animation segment immediately.</small>
</section>

<style>
	.easing-inspector {
		padding: 16px;
		border-bottom: 1px solid #2d333d;
		background: #1b222b;
	}
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		color: #d9e4f0;
	}
	.section-heading > span {
		display: flex;
		gap: 7px;
		align-items: center;
	}
	.section-heading > div {
		display: flex;
	}
	.section-heading :global(button) {
		border-radius: 5px;
		color: #8d9bad;
	}
	.easing-inspector p {
		display: flex;
		justify-content: space-between;
		font: 10px monospace;
		color: #d5ef9d;
		margin: 10px 0;
	}
	.easing-inspector p span {
		color: #8190a2;
	}
	.segment-times {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #8292a6;
	}
	.curve {
		width: 100%;
		height: 160px;
		margin: 8px 0;
	}
	.curve .grid {
		fill: none;
		stroke: #333e4b;
		stroke-width: 1;
	}
	.curve line {
		stroke: #697a91;
		stroke-dasharray: 3 3;
	}
	.motion-curve {
		stroke: #d8f99c;
		stroke-width: 2.5;
		fill: none;
	}
	.curve circle {
		fill: #1a242f;
		stroke: #d5f49c;
		stroke-width: 2;
		cursor: move;
		touch-action: none;
	}
	.presets {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.presets :global(.preset) {
		border-radius: 5px;
		background: #242f3b;
		font-size: 9px;
		letter-spacing: 0;
		text-transform: none;
		padding: 4px 8px;
		height: 26px;
		font-weight: 500;
		color: #a8b9cd;
	}
	.presets :global(.active) {
		background: #3d4930;
		color: #dfff4f;
	}
	.control-values {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 5px;
		margin: 13px 0;
	}
	.control-values label {
		font: 9px monospace;
		color: #798ba0;
	}
	.easing-inspector small {
		font-size: 9px;
		color: #8293a8;
	}
</style>
