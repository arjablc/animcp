<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Italic, Type } from '@lucide/svelte';
	import type { Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	import FontPicker from './FontPicker.svelte';
	import NumericInput from './NumericInput.svelte';

	let { session, layer }: { session: MotionSession; layer: Layer } = $props();

	function change(changes: Record<string, unknown>) {
		try {
			session.run('set_layer', { layerId: layer.id, changes });
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
</script>

<section>
	<h3>Typography <Type size={12} /></h3>
	<Textarea
		aria-label="Text content"
		value={layer.text}
		disabled={layer.locked}
		onchange={(e) => change({ text: e.currentTarget.value })}
	/>
	<FontPicker {session} {layer} />
	<div class="font-options">
		<span title="Font size"><Type size={13} /></span><NumericInput
			label="Font size"
			value={layer.fontSize}
			min={1}
			max={1000}
			disabled={layer.locked}
			oncommit={(v) => change({ fontSize: v })}
		/><select
			aria-label="Font weight"
			value={layer.fontWeight}
			disabled={layer.locked}
			onchange={(e) => change({ fontWeight: Number(e.currentTarget.value) })}
			>{#each [100, 200, 300, 400, 500, 600, 700, 800, 900] as w (w)}<option value={w}>{w}</option
				>{/each}</select
		><Button
			variant="ghost"
			size="icon-xs"
			aria-label="Italic"
			aria-pressed={layer.fontStyle === 'italic'}
			title="Italic"
			disabled={layer.locked}
			onclick={() => change({ fontStyle: layer.fontStyle === 'italic' ? 'normal' : 'italic' })}
			><Italic /></Button
		>
		<NumericInput
			label="Line height"
			value={layer.lineHeight}
			min={0.1}
			max={10}
			step={0.05}
			disabled={layer.locked}
			oncommit={(v) => change({ lineHeight: v })}
		/>
		<NumericInput
			label="Letter spacing"
			value={layer.letterSpacing}
			min={-100}
			max={1000}
			disabled={layer.locked}
			oncommit={(v) => change({ letterSpacing: v })}
		/>
		<select
			class="alignment-select"
			aria-label="Text alignment"
			value={layer.textAlign}
			disabled={layer.locked}
			onchange={(e) => change({ textAlign: e.currentTarget.value })}
		>
			<option value="left">Align left</option><option value="center">Align center</option><option
				value="right">Align right</option
			>
		</select>
	</div>
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
	section :global(textarea) {
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
		margin: 0;
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
		font-size: var(--type-label);
		background: var(--panel-raised);
		border: 1px solid var(--line);
		border-radius: 5px;
		color: var(--paper);
		padding: 6px 8px;
	}
	@media (max-width: 1000px) {
		section {
			padding: 12px;
		}
	}
</style>
