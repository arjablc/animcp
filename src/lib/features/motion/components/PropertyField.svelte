<script lang="ts">
	import type { MotionSession } from '../session.svelte';
	import { evaluate, type Layer } from '../model';
	import {
		ArrowRight,
		ArrowDown,
		MoveHorizontal,
		MoveVertical,
		Scaling,
		RotateCw,
		Blend,
		Radius,
		PaintBucket,
		Palette,
		Minus,
		Diamond,
		DiamondPlus,
		Focus
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import NumericInput from './NumericInput.svelte';
	import { propertyBounds, propertyEdits, propertyStep } from '../editing';
	let {
		session,
		layer,
		property,
		label = property
	}: { session: MotionSession; layer: Layer; property: string; label?: string } = $props();
	const t = $derived(layer.tracks[property]),
		current = $derived(evaluate(t, session.context.currentFrame));
	const Icon = $derived(
		property === 'positionX'
			? ArrowRight
			: property === 'positionY'
				? ArrowDown
				: property === 'width'
					? MoveHorizontal
					: property === 'height'
						? MoveVertical
						: property.includes('scale')
							? Scaling
							: property === 'rotation'
								? RotateCw
								: property === 'cornerRadius'
									? Radius
									: /opacity/i.test(property)
										? Blend
										: property === 'fill'
											? PaintBucket
											: property === 'strokeWidth'
												? Minus
												: property.endsWith('color') || property === 'stroke'
													? Palette
													: Focus
	);
	const bounds = $derived(propertyBounds(property));
	let revision = 0,
		frame = 0;
	function begin() {
		revision = session.project.revision;
		frame = session.context.currentFrame;
		session.playing = false;
	}
	function change(v: number | string) {
		try {
			session.commit(
				propertyEdits(layer, { [property]: v }, session.context.currentFrame, session.autoKey),
				`Changed ${label}`
			);
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
	function dragged(v: number) {
		session.preview = null;
		try {
			session.commit(
				propertyEdits(layer, { [property]: v }, frame, session.autoKey),
				`Changed ${label}`,
				'human',
				revision
			);
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
	function key() {
		try {
			session.commit(
				[
					{
						name: 'add_keyframe',
						input: {
							layerId: layer.id,
							property,
							frame: session.context.currentFrame,
							value: current
						}
					}
				],
				`Keyframed ${label}`
			);
		} catch (e) {
			session.error = String(e);
		}
	}
</script>

<div class="property-field">
	<span class="property-icon" title={label} aria-label={label}><Icon size={14} /></span
	>{#if typeof current === 'string'}<input
			aria-label={label}
			type="color"
			value={current}
			disabled={layer.locked}
			onchange={(e) => change(e.currentTarget.value)}
		/><span class="color-code">{current}</span>{:else}<NumericInput
			value={current}
			{label}
			step={propertyStep(property)}
			min={bounds[0]}
			max={bounds[1]}
			disabled={layer.locked}
			onbegin={begin}
			onpreview={(v) =>
				(session.preview = v === null ? null : { layerId: layer.id, values: { [property]: v } })}
			oncommit={dragged}
		/>{/if}<Button
		variant="ghost"
		size="icon-xs"
		class={t.keys.some((k) => k.frame === session.context.currentFrame)
			? 'key-toggle keyed'
			: 'key-toggle'}
		disabled={layer.locked}
		title={`Keyframe ${label}`}
		aria-label={`Keyframe ${label}`}
		onclick={key}
		>{#if t.keys.some((k) => k.frame === session.context.currentFrame)}<Diamond
				size={11}
			/>{:else}<DiamondPlus size={11} />{/if}</Button
	>
</div>

<style>
	.property-field {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.property-icon {
		color: var(--text-subtle);
		flex: 0 0 15px;
		display: flex;
		align-items: center;
		cursor: help;
	}
	.property-field :global(.numeric-input) {
		flex: 1;
	}
	.property-field input[type='color'] {
		width: 27px;
		height: 27px;
		border: 0;
		padding: 0;
		background: none;
		cursor: pointer;
	}
	.color-code {
		font: 400 var(--type-meta) / 1 var(--mono);
		flex: 1;
		color: var(--text-muted);
	}
	.property-field :global(.key-toggle) {
		width: 21px;
		height: 26px;
		border: 0;
		padding: 0;
		color: var(--text-subtle);
		border-radius: 4px;
	}
	.property-field :global(.keyed) {
		color: var(--acid);
	}
</style>
