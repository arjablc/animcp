<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import {
		Film,
		Maximize2,
		Minimize2,
		Pause,
		Play,
		Repeat2,
		SkipBack,
		ZoomIn,
		ZoomOut
	} from '@lucide/svelte';
	let {
		playing,
		currentFrame,
		lastFrame,
		fps,
		autoKey,
		zoom,
		expanded,
		onGoToStart,
		onTogglePlaying,
		onAutoKeyChange,
		onZoomChange,
		onToggleView
	}: {
		playing: boolean;
		currentFrame: number;
		lastFrame: number;
		fps: number;
		autoKey: boolean;
		zoom: number;
		expanded: boolean;
		onGoToStart: () => void;
		onTogglePlaying: () => void;
		onAutoKeyChange: (enabled: boolean) => void;
		onZoomChange: (zoom: number) => void;
		onToggleView: () => void;
	} = $props();
</script>

<div class="timeline-toolbar">
	<div class="transport">
		<Button
			variant="ghost"
			size="icon-xs"
			class="editor-icon"
			aria-label="Go to start"
			title="Go to start"
			onclick={onGoToStart}><SkipBack /></Button
		><Button
			variant="ghost"
			size="icon-sm"
			class="timeline-play"
			aria-label={playing ? 'Pause' : 'Play'}
			title="Play / pause · Space"
			onclick={onTogglePlaying}
			>{#if playing}<Pause size={14} />{:else}<Play size={14} />{/if}</Button
		><span class="timecode"
			>{String(Math.floor(currentFrame / fps)).padStart(2, '0')}:{String(
				currentFrame % fps
			).padStart(2, '0')}<small> / {lastFrame}f</small></span
		>
	</div>
	<span class="timeline-title"><Film size={13} /> Timeline</span><Button
		variant="ghost"
		size="icon-xs"
		class="editor-icon timeline-view-toggle"
		aria-label={expanded ? 'Restore timeline view' : 'Expand timeline view'}
		title={expanded ? 'Restore timeline view' : 'Timeline view'}
		onclick={onToggleView}
		>{#if expanded}<Minimize2 />{:else}<Maximize2 />{/if}</Button
	><label class:enabled={autoKey} class="auto-key"
		><input
			type="checkbox"
			aria-label="Auto-key"
			class="auto-checkbox"
			checked={autoKey}
			onchange={(event) => onAutoKeyChange(event.currentTarget.checked)}
		/><span>Auto-key</span></label
	><span class="timeline-spacer"></span><span class="fps"><Repeat2 size={12} />{fps} fps</span>
	<div class="timeline-zoom">
		<Button
			variant="ghost"
			size="icon-xs"
			class="editor-icon"
			aria-label="Zoom out timeline"
			title="Zoom out"
			disabled={zoom <= 2}
			onclick={() => onZoomChange(Math.max(2, zoom - 2))}><ZoomOut /></Button
		><span>{zoom}px/f</span><Button
			variant="ghost"
			size="icon-xs"
			class="editor-icon"
			aria-label="Zoom in timeline"
			title="Zoom in"
			disabled={zoom >= 24}
			onclick={() => onZoomChange(Math.min(24, zoom + 2))}><ZoomIn /></Button
		>
	</div>
</div>

<style>
	.timeline-toolbar {
		height: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 0 15px;
		border-bottom: 1px solid #2b333f;
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.transport :global(.timeline-play) {
		background: var(--acid);
		color: var(--acid-ink);
		border-radius: 6px;
		width: 28px;
		height: 27px;
		padding: 5px;
	}
	.transport :global(.timeline-play:hover) {
		background: #a4edfb;
	}
	.timecode {
		font: 500 var(--type-label) / 1 var(--mono);
		color: #c4d0df;
		margin-left: 6px;
	}
	.timecode small {
		font: 400 var(--type-meta) / 1 var(--mono);
		color: #677b92;
	}
	.timeline-title {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--type-label);
		color: #9bacc0;
	}
	:global(.timeline-view-toggle) {
		margin-left: -8px;
	}
	.auto-key {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--type-label);
		color: #7f90a6;
		cursor: pointer;
	}
	.auto-key.enabled {
		color: var(--acid);
	}
	.auto-checkbox {
		width: 13px;
		height: 13px;
		border: 1px solid #576574;
		border-radius: 3px;
		cursor: pointer;
		background: transparent;
		accent-color: var(--acid);
	}
	.auto-checkbox:checked {
		background: var(--acid);
		border-color: var(--acid);
		color: var(--acid-ink);
	}
	.timeline-spacer {
		flex: 1;
	}
	.fps {
		display: flex;
		align-items: center;
		gap: 6px;
		font: 400 var(--type-meta) / 1 var(--mono);
		color: #73869d;
	}
	.timeline-zoom {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.timeline-zoom > span {
		font: 400 var(--type-meta) / 1 var(--mono);
		color: #899bb2;
		width: 34px;
		text-align: center;
	}
	@media (max-width: 900px) {
		.timeline-toolbar {
			gap: 12px;
		}
		.timeline-title,
		.fps {
			display: none;
		}
	}
</style>
