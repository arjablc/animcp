<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Copy,
		Trash2,
		SlidersHorizontal,
		Type,
		Italic,
		Plus,
		X,
		PanelRightClose,
		PanelRightOpen,
		MousePointer2
	} from '@lucide/svelte';
	import type { MotionSession } from '../session.svelte';
	import { animationSegments } from '../editing';
	import PropertyField from './PropertyField.svelte';
	import EasingInspector from './EasingInspector.svelte';
	import NumericInput from './NumericInput.svelte';
	import FontPicker from './FontPicker.svelte';
	let { session }: { session: MotionSession } = $props();
	let open = $state(true);
	let inspectorScroll = $state<HTMLDivElement>();
	const selectedSegments = $derived(
		session.project.layers.flatMap((candidate) =>
			Object.keys(candidate.tracks).flatMap((candidateProperty) =>
				animationSegments(candidate, candidateProperty)
					.filter(
						(candidateSegment) =>
							session.context.selectedKeyframeIds.includes(candidateSegment.start.id) &&
							session.context.selectedKeyframeIds.includes(candidateSegment.end.id)
					)
					.map((candidateSegment) => ({
						layer: candidate,
						property: candidateProperty,
						start: candidateSegment.start,
						end: candidateSegment.end
					}))
			)
		)
	);
	$effect(() => {
		const id = selectedSegments.map((selectedSegment) => selectedSegment.start.id).join(',');
		if (id) {
			open = true;
			tick().then(() => inspectorScroll?.scrollTo({ top: 0 }));
		}
	});
	const layer = $derived(
		session.project.layers.find((l) => l.id === session.context.selectedLayerIds[0])
	);
	const selectedKeyLayers = $derived(
		session.project.layers.filter((candidate) =>
			Object.values(candidate.tracks).some((track) =>
				track.keys.some((key) => session.context.selectedKeyframeIds.includes(key.id))
			)
		)
	);
	const hasOpenSubpaths = $derived(
		layer?.type === 'path' && (layer.paths ?? []).some((path) => path.at(-1)?.type !== 'Z')
	);
	function safe(fn: () => unknown) {
		try {
			fn();
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
	function change(changes: Record<string, unknown>) {
		if (layer) safe(() => session.run('set_layer', { layerId: layer.id, changes }));
	}
	function applySelectedEasing(preset: string) {
		const keyframeIds = session.context.selectedKeyframeIds;
		if (!keyframeIds.length || !selectedKeyLayers.length) return;
		safe(() =>
			session.run(
				'set_easing',
				{ layerIds: selectedKeyLayers.map((candidate) => candidate.id), keyframeIds, preset },
				'Changed selected animation easing'
			)
		);
	}
	function entrance() {
		if (!layer) return;
		const f = session.context.currentFrame;
		if (f + 20 >= session.project.composition.durationFrames) {
			session.error = 'Move the playhead at least 20 frames before the end.';
			return;
		}
		safe(() => {
			session.commit(
				[
					{
						name: 'add_keyframe',
						input: {
							layerId: layer!.id,
							property: 'opacity',
							frame: f,
							value: 0,
							easing: { type: 'bezier', x1: 0.4, y1: 0, x2: 0.2, y2: 1 }
						}
					},
					{
						name: 'add_keyframe',
						input: { layerId: layer!.id, property: 'opacity', frame: f + 20, value: 1 }
					}
				],
				'Added fade entrance'
			);
			const keys = session.project.layers
				.find((l) => l.id === layer!.id)!
				.tracks.opacity.keys.filter((k) => k.frame === f || k.frame === f + 20);
			session.select(
				[layer!.id],
				keys.map((k) => k.id),
				['opacity']
			);
		});
	}
</script>

<aside class="inspector" class:collapsed={!open} aria-label="Properties panel">
	<div class="inspector-header">
		{#if open}<SlidersHorizontal size={14} /><span>Properties</span>{/if}<Button
			variant="ghost"
			size="icon-xs"
			class="editor-icon"
			aria-label={open ? 'Collapse properties' : 'Expand properties'}
			title={open ? 'Collapse properties' : 'Expand properties'}
			onclick={() => (open = !open)}
			>{#if open}<PanelRightClose />{:else}<PanelRightOpen />{/if}</Button
		>
	</div>
	{#if open}<div class="inspector-scroll" bind:this={inspectorScroll}>
			{#if layer}{@const l = layer}{#if selectedSegments.length}<EasingInspector
						{session}
						segments={selectedSegments}
					/>{/if}
				<section>
					<div class="name-row">
						<Input
							aria-label="Layer name"
							value={l.name}
							onchange={(e) => change({ name: e.currentTarget.value })}
						/><Button
							variant="ghost"
							size="icon-xs"
							aria-label="Duplicate layer"
							title="Duplicate layer"
							onclick={() =>
								safe(() => {
									const r = session.run('duplicate_layer', { layerId: l.id });
									session.select([(r.data[0] as { layerId: string }).layerId]);
								})}><Copy /></Button
						><Button
							variant="ghost"
							size="icon-xs"
							aria-label="Delete layer"
							title="Delete layer"
							disabled={l.locked}
							onclick={() => safe(() => session.run('delete_layer', { layerId: l.id }))}
							><Trash2 /></Button
						>
					</div>
					<h3>Transform <span>{l.type}</span></h3>
					<div class="property-grid">
						{#each l.type === 'path' ? ['positionX', 'positionY', 'scaleX', 'scaleY', 'rotation', 'opacity'] : ['positionX', 'positionY', 'width', 'height', 'scaleX', 'scaleY', 'rotation', 'opacity'] as prop}<PropertyField
								{session}
								layer={l}
								property={prop}
							/>{/each}{#if l.type === 'rectangle'}<PropertyField
								{session}
								layer={l}
								property="cornerRadius"
								label="Corner radius"
							/>{/if}
					</div>
				</section>
				{#if l.type === 'text'}<section>
						<h3>Typography <Type size={12} /></h3>
						<Textarea
							aria-label="Text content"
							value={l.text}
							disabled={l.locked}
							onchange={(e) => change({ text: e.currentTarget.value })}
						/><FontPicker {session} layer={l} />
						<div class="font-options">
							<span title="Font size"><Type size={13} /></span><NumericInput
								label="Font size"
								value={l.fontSize}
								min={1}
								max={1000}
								disabled={l.locked}
								oncommit={(v) => change({ fontSize: v })}
							/><select
								aria-label="Font weight"
								value={l.fontWeight}
								disabled={l.locked}
								onchange={(e) => change({ fontWeight: Number(e.currentTarget.value) })}
								>{#each [100, 200, 300, 400, 500, 600, 700, 800, 900] as w}<option value={w}
										>{w}</option
									>{/each}</select
							><Button
								variant="ghost"
								size="icon-xs"
								aria-label="Italic"
								aria-pressed={l.fontStyle === 'italic'}
								title="Italic"
								disabled={l.locked}
								onclick={() =>
									change({ fontStyle: l.fontStyle === 'italic' ? 'normal' : 'italic' })}
								><Italic /></Button
							>
							<NumericInput
								label="Line height"
								value={l.lineHeight}
								min={0.1}
								max={10}
								step={0.05}
								disabled={l.locked}
								oncommit={(v) => change({ lineHeight: v })}
							/>
							<NumericInput
								label="Letter spacing"
								value={l.letterSpacing}
								min={-100}
								max={1000}
								disabled={l.locked}
								oncommit={(v) => change({ letterSpacing: v })}
							/>
							<select
								class="alignment-select"
								aria-label="Text alignment"
								value={l.textAlign}
								disabled={l.locked}
								onchange={(e) => change({ textAlign: e.currentTarget.value })}
							>
								<option value="left">Align left</option><option value="center">Align center</option
								><option value="right">Align right</option>
							</select>
						</div>
					</section>{/if}{#if l.type !== 'png' && l.type !== 'svg' && l.type !== 'group'}<section>
						<h3>Fill & stroke</h3>
						<select
							aria-label="Paint type"
							value={l.paint.type}
							disabled={l.locked}
							onchange={(e) =>
								safe(() =>
									session.run('set_paint', { layerId: l.id, type: e.currentTarget.value })
								)}
							><option value="solid">Solid color</option><option value="linear"
								>Linear gradient</option
							><option value="radial">Radial gradient</option></select
						>{#if l.paint.type === 'solid'}<PropertyField
								{session}
								layer={l}
								property="fill"
								label="Fill color"
							/>{:else}{#each l.paint.stops as stop, index}<div class="gradient-stop">
									<div class="stop-heading">
										Stop {index + 1}<Button
											variant="ghost"
											size="icon-xs"
											aria-label={`Remove stop ${index + 1}`}
											title="Remove stop"
											disabled={l.locked || l.paint.stops.length <= 2}
											onclick={() =>
												safe(() =>
													session.run('delete_gradient_stop', { layerId: l.id, stopId: stop })
												)}><X /></Button
										>
									</div>
									{#each ['color', 'offset', 'opacity'] as part}<PropertyField
											{session}
											layer={l}
											property={`gradient.stop.${stop}.${part}`}
											label={part}
										/>{/each}
								</div>{/each}<Button
								variant="ghost"
								size="sm"
								class="text-action"
								disabled={l.locked}
								onclick={() =>
									safe(() =>
										session.run('add_gradient_stop', {
											layerId: l.id,
											offset: 0.5,
											color: '#ffffff'
										})
									)}><Plus size={12} /> Add stop</Button
							>
							<div class="property-grid">
								{#each l.paint.type === 'linear' ? ['startX', 'startY', 'endX', 'endY'] : ['centerX', 'centerY', 'focalX', 'focalY', 'radius'] as prop}<PropertyField
										{session}
										layer={l}
										property={`gradient.${prop}`}
										label={prop}
									/>{/each}
							</div>{/if}<PropertyField
							{session}
							layer={l}
							property="paintOpacity"
							label="Paint opacity"
						/><PropertyField
							{session}
							layer={l}
							property="stroke"
							label="Stroke color"
						/><PropertyField {session} layer={l} property="strokeWidth" label="Stroke width" />
					</section>{/if}{#if hasOpenSubpaths}<section>
						<h3>Draw</h3>
						<div class="property-grid">
							<PropertyField {session} layer={l} property="drawStart" label="Start" />
							<PropertyField {session} layer={l} property="drawEnd" label="End" />
						</div>
						<p class="hint">Animate Start or End to reveal, erase, or wipe this open path.</p>
					</section>{/if}
				<section>
					<h3>Quick animation</h3>
					{#if session.context.selectedKeyframeIds.length > 1 && !selectedSegments.length}<div
							class="bulk-easing"
						>
							<span>{session.context.selectedKeyframeIds.length} selected keyframes</span>
							<div>
								<Button
									variant="ghost"
									size="xs"
									disabled={selectedKeyLayers.some((candidate) => candidate.locked)}
									onclick={() => applySelectedEasing('linear')}>Linear</Button
								><Button
									variant="ghost"
									size="xs"
									disabled={selectedKeyLayers.some((candidate) => candidate.locked)}
									onclick={() => applySelectedEasing('smooth')}>Smooth</Button
								><Button
									variant="ghost"
									size="xs"
									disabled={selectedKeyLayers.some((candidate) => candidate.locked)}
									onclick={() => applySelectedEasing('snappy')}>Snappy</Button
								>
							</div>
						</div>{/if}
					<Button
						variant="ghost"
						size="sm"
						class="text-action"
						disabled={l.locked}
						onclick={entrance}><Plus size={12} /> Fade entrance · 20f</Button
					>
					<p class="hint">
						Enable Auto-key and change a property at a later frame to animate. Select a timeline bar
						to edit its easing.
					</p>
				</section>{:else}<div class="nothing-selected">
					<MousePointer2 size={24} />
					<p>Select a layer</p>
					<small
						>Its properties will appear here.<br />Select an animation bar to edit easing.</small
					>
				</div>{/if}
		</div>{/if}
</aside>

<style>
	.inspector {
		width: 274px;
		min-width: 274px;
		min-height: 0;
		border-left: 1px solid var(--line);
		background: var(--panel);
		display: flex;
		flex-direction: column;
		transition:
			width 0.2s,
			min-width 0.2s;
	}
	.inspector.collapsed {
		width: 42px;
		min-width: 42px;
	}
	.inspector-header {
		height: 48px;
		min-height: 48px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		border-bottom: 1px solid var(--line);
		color: var(--muted-foreground);
		font-size: var(--type-label);
	}
	.inspector-header span {
		flex: 1;
	}
	.collapsed .inspector-header {
		padding: 0 7px;
	}
	.inspector-scroll {
		overflow-y: auto;
		min-height: 0;
	}
	.inspector section {
		padding: 14px;
		border-bottom: 1px solid var(--line);
	}
	.bulk-easing {
		margin: 10px 0;
		padding: 9px;
		border-radius: 6px;
		background: var(--accent);
		color: var(--muted-foreground);
		font-size: var(--type-meta);
	}
	.bulk-easing > div {
		display: flex;
		gap: 3px;
		margin-top: 6px;
	}
	.bulk-easing :global(button) {
		padding-inline: 7px;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	.name-row :global(input) {
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--paper);
		padding: 0;
		height: 30px;
		font-size: var(--type-control);
		box-shadow: none;
	}
	.name-row :global(button) {
		color: var(--muted-foreground);
		border-radius: 4px;
		flex-shrink: 0;
	}
	h3 {
		font-size: var(--type-label);
		font-weight: 600;
		color: var(--paper);
		margin: 4px 0 12px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h3 span {
		font-size: var(--type-meta);
		color: var(--muted-foreground);
	}
	.name-row + h3 {
		margin-top: 17px;
	}
	.property-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1px 9px;
	}
	.inspector :global(textarea) {
		background: var(--ink);
		color: var(--paper);
		border: 1px solid var(--line-bright);
		border-radius: 5px;
		min-height: 62px;
		font-size: var(--type-control);
		margin-bottom: 9px;
	}
	.font-options {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		margin-top: 10px;
		color: var(--muted-foreground);
	}
	.font-options > :global(.property-field) {
		min-width: 0;
	}
	.font-options > span {
		display: none;
	}
	.font-options :global(input) {
		width: 58px;
	}
	.font-options select {
		width: 100%;
		margin-bottom: 0;
	}
	.font-options .alignment-select {
		grid-column: 1 / -1;
	}
	.font-options :global(button) {
		color: var(--muted-foreground);
		border-radius: 4px;
	}
	.font-options :global(button[aria-pressed='true']) {
		background: var(--accent);
		color: var(--acid);
	}
	select {
		width: 100%;
		font-size: var(--type-label);
		background: var(--panel-raised);
		border: 1px solid var(--line);
		border-radius: 5px;
		color: var(--paper);
		padding: 6px 8px;
		margin-bottom: 6px;
	}
	.font-options select {
		margin: 0;
	}
	.gradient-stop {
		margin-top: 8px;
		padding: 7px 0;
		border-top: 1px solid var(--line);
	}
	.stop-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--type-meta);
		color: var(--muted-foreground);
	}
	.stop-heading :global(button) {
		color: var(--muted-foreground);
		border-radius: 4px;
	}
	:global(.text-action) {
		text-transform: none !important;
		letter-spacing: 0 !important;
		font-size: var(--type-label) !important;
		font-weight: 400 !important;
		border-radius: 5px !important;
		color: var(--paper) !important;
		background: var(--panel-raised) !important;
		padding: 5px 8px !important;
		height: 28px !important;
	}
	.hint {
		font-size: var(--type-label);
		color: var(--muted-foreground);
		line-height: 1.7;
		margin: 12px 0 0;
	}
	.nothing-selected {
		padding: 70px 15px;
		text-align: center;
		color: var(--muted-foreground);
	}
	.nothing-selected :global(svg) {
		margin: 0 auto 14px;
		color: var(--muted);
	}
	.nothing-selected p {
		font-size: var(--type-control);
		color: var(--paper);
	}
	.nothing-selected small {
		font-size: var(--type-label);
		line-height: 1.8;
		color: var(--muted-foreground);
	}
	@media (max-width: 1000px) {
		.inspector {
			width: 246px;
			min-width: 246px;
		}
		.inspector section {
			padding: 12px;
		}
		.property-grid {
			gap: 1px 5px;
		}
	}
</style>
