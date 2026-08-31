<script lang="ts">
	import type { VectorSession } from '../animation/state.svelte';
	import type { ShapeKeyframe } from '../animation/model';
	let { session, onadd, ondelete, ongenerate, onerror } = $props<{
		session: VectorSession;
		onadd: () => void;
		ondelete: () => void;
		ongenerate: (start: number, end: number) => void;
		onerror: (error: unknown) => void;
	}>();
	let start = $state(0);
	let end = $state(60);
	const total = $derived(session.project.timeline.frameCount);
	const rows = $derived([...session.project.layers].sort((a, b) => b.zIndex - a.zIndex));
	const ticks = $derived(Array.from({ length: 11 }, (_, i) => Math.round((i * (total - 1)) / 10)));
	function seek(event: Event) {
		session.playing = false;
		session.seek(Number((event.target as HTMLInputElement).value));
	}
	function safe(action: () => void) {
		try {
			action();
		} catch (error) {
			onerror(error);
		}
	}
</script>

<section class="timeline" aria-label="Animation timeline">
	<div class="timeline-header">
		<div>
			<strong>Timeline</strong><span class="frame-readout"
				>{String(session.currentFrame).padStart(3, '0')} <span>/ {total - 1}</span></span
			>
		</div>
		<div class="timeline-actions">
			<button
				onclick={onadd}
				disabled={!session.selectedLayer || session.selectedLayer.locked}
				title="Add keyframe at playhead">＋ Keyframe</button
			>
			<button
				onclick={ondelete}
				disabled={!session.selectedLayer?.keyframes[session.currentFrame] ||
					session.selectedLayer?.locked}>Delete keyframe</button
			>
			<label
				>From <input
					aria-label="In-between start frame"
					type="number"
					min="0"
					max={total - 2}
					bind:value={start}
				/></label
			>
			<label
				>To <input
					aria-label="In-between end frame"
					type="number"
					min="1"
					max={total - 1}
					bind:value={end}
				/></label
			>
			<button
				class="tween"
				onclick={() => ongenerate(start, Math.min(end, total - 1))}
				disabled={!session.selectedLayer || session.selectedLayer.locked}
				>Generate in-betweens</button
			>
		</div>
	</div>
	<div class="scrubber">
		<span>{(session.currentFrame / session.project.timeline.fps).toFixed(2)}s</span><input
			aria-label="Current frame"
			type="range"
			min="0"
			max={total - 1}
			step="1"
			value={session.currentFrame}
			oninput={seek}
		/><span>{(total / session.project.timeline.fps).toFixed(1)}s</span>
	</div>
	<div class="timeline-scroll">
		<div class="ruler">
			<span class="track-name">LAYER / FRAME</span>
			<div class="track">
				{#each ticks as tick (tick)}<span class="tick" style:left={`${(tick / (total - 1)) * 100}%`}
						>{tick}</span
					>{/each}
			</div>
		</div>
		{#each rows as layer (layer.id)}
			<div class:selected={session.selectedLayerId === layer.id} class="track-row">
				<button class="track-name" onclick={() => session.select(layer.id)}>{layer.name}</button>
				<div class="track">
					<div class="playhead" style:left={`${(session.currentFrame / (total - 1)) * 100}%`}></div>
					{#each Object.entries(layer.keyframes) as [frame, rawKeyframe] (frame)}
						{@const keyframe = rawKeyframe as ShapeKeyframe}
						<button
							class="keyframe"
							class:generated={keyframe.generated}
							class:current={Number(frame) === session.currentFrame}
							style:left={`${(Number(frame) / (total - 1)) * 100}%`}
							aria-label={`${layer.name}, ${keyframe.generated ? 'generated ' : ''}keyframe ${frame}`}
							title={`Frame ${frame}${keyframe.generated ? ' · generated' : ''}`}
							onclick={() =>
								safe(() => {
									session.select(layer.id);
									session.playing = false;
									session.seek(Number(frame));
								})}
						></button>
					{/each}
				</div>
			</div>
		{:else}<div class="empty-timeline">
				Draw a path to create your first animation track.
			</div>{/each}
	</div>
</section>

<style>
	.timeline {
		background: #13191d;
		border-top: 1px solid #2a343a;
		min-height: 205px;
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	.timeline-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 18px;
		flex-wrap: wrap;
	}
	.timeline-header > div {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	strong {
		font-size: 12px;
	}
	.frame-readout {
		color: #dfff4f;
		font: 11px var(--mono);
	}
	.frame-readout span {
		color: #8c999e;
	}
	.timeline-actions {
		gap: 8px !important;
		flex-wrap: wrap;
	}
	button {
		border: 1px solid #344148;
		border-radius: 5px;
		padding: 5px 9px;
		background: #1b252b;
		font-size: 11px;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	button:hover:not(:disabled) {
		border-color: #dfff4f;
	}
	.tween {
		color: #dfff4f;
	}
	label {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #9aa8ae;
		font-size: 10px;
	}
	input[type='number'] {
		width: 48px;
		padding: 3px;
		background: #0e1519;
		border: 1px solid #344148;
		border-radius: 4px;
		font: 11px var(--mono);
	}
	.scrubber {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 0 18px 10px;
	}
	.scrubber input {
		flex: 1;
		accent-color: #dfff4f;
	}
	.scrubber span {
		font: 10px var(--mono);
		color: #8b999f;
	}
	.timeline-scroll {
		overflow: auto;
		flex: 1;
		padding: 0 28px 14px 0;
	}
	.ruler,
	.track-row {
		min-width: 540px;
		display: flex;
		height: 31px;
		align-items: center;
	}
	.track-name {
		flex: 0 0 180px;
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
		border: 0;
		border-radius: 0;
		background: transparent;
		padding-left: 18px;
		color: #a6b2b8;
		font-size: 11px;
	}
	.ruler .track-name {
		font: 9px var(--mono);
		letter-spacing: 0.05em;
	}
	.track {
		position: relative;
		height: 100%;
		flex: 1;
		background: repeating-linear-gradient(
			90deg,
			#29353b 0,
			#29353b 1px,
			transparent 1px,
			transparent 10%
		);
		border-bottom: 1px solid #202b31;
	}
	.tick {
		position: absolute;
		top: 7px;
		transform: translateX(-50%);
		font: 10px var(--mono);
		color: #7e8c93;
	}
	.selected {
		background: #243039;
	}
	.keyframe {
		position: absolute;
		top: 10px;
		width: 10px;
		height: 10px;
		padding: 0;
		border: 1px solid #a5b1b5;
		background: #bec9cb;
		transform: translateX(-50%) rotate(45deg);
		border-radius: 1px;
		z-index: 2;
	}
	.keyframe.generated {
		width: 5px;
		height: 5px;
		top: 12px;
		background: #52666f;
		border-color: #52666f;
	}
	.keyframe.current {
		background: #dfff4f;
		border-color: #dfff4f;
	}
	.playhead {
		position: absolute;
		height: 100%;
		border-left: 1px solid #dfff4f;
		pointer-events: none;
	}
	.empty-timeline {
		padding: 20px;
		color: #87969b;
		font-size: 12px;
	}
</style>
