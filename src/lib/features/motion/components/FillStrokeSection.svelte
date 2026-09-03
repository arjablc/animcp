<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Plus, X } from '@lucide/svelte';
	import type { Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	import PropertyField from './PropertyField.svelte';

	let { session, layer }: { session: MotionSession; layer: Layer } = $props();

	function safe(fn: () => unknown) {
		try {
			fn();
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
</script>

<section>
	<h3>Fill & stroke</h3>
	<select
		aria-label="Paint type"
		value={layer.paint.type}
		disabled={layer.locked}
		onchange={(e) =>
			safe(() => session.run('set_paint', { layerId: layer.id, type: e.currentTarget.value }))}
		><option value="solid">Solid color</option><option value="linear">Linear gradient</option
		><option value="radial">Radial gradient</option></select
	>
	{#if layer.paint.type === 'solid'}<PropertyField
			{session}
			{layer}
			property="fill"
			label="Fill color"
		/>{:else}{#each layer.paint.stops as stop, index (stop)}<div class="gradient-stop">
				<div class="stop-heading">
					Stop {index + 1}<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Remove stop ${index + 1}`}
						title="Remove stop"
						disabled={layer.locked || layer.paint.stops.length <= 2}
						onclick={() =>
							safe(() => session.run('delete_gradient_stop', { layerId: layer.id, stopId: stop }))}
						><X /></Button
					>
				</div>
				{#each ['color', 'offset', 'opacity'] as part (part)}<PropertyField
						{session}
						{layer}
						property={`gradient.stop.${stop}.${part}`}
						label={part}
					/>{/each}
			</div>{/each}<Button
			variant="ghost"
			size="sm"
			class="text-action"
			disabled={layer.locked}
			onclick={() =>
				safe(() =>
					session.run('add_gradient_stop', {
						layerId: layer.id,
						offset: 0.5,
						color: '#ffffff'
					})
				)}><Plus size={12} /> Add stop</Button
		>
		<div class="property-grid">
			{#each layer.paint.type === 'linear' ? ['startX', 'startY', 'endX', 'endY'] : ['centerX', 'centerY', 'focalX', 'focalY', 'radius'] as prop (prop)}<PropertyField
					{session}
					{layer}
					property={`gradient.${prop}`}
					label={prop}
				/>{/each}
		</div>{/if}<PropertyField
		{session}
		{layer}
		property="paintOpacity"
		label="Paint opacity"
	/><PropertyField {session} {layer} property="stroke" label="Stroke color" /><PropertyField
		{session}
		{layer}
		property="strokeWidth"
		label="Stroke width"
	/>
</section>

<style>
	section {
		padding: 14px;
		border-bottom: 1px solid var(--line);
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
	.property-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1px 9px;
	}
	@media (max-width: 1000px) {
		section {
			padding: 12px;
		}
		.property-grid {
			gap: 1px 5px;
		}
	}
</style>
