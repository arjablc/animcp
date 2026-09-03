<script lang="ts">
	import { ChevronDown, ChevronRight, CornerDownRight, GripVertical } from '@lucide/svelte';
	import type { MotionSession } from '../session.svelte';
	import type { Layer, Key } from '../model';
	import { animationSegments, keyframeMoveBounds } from '../editing';
	import { flattenLayerTree } from '../layer-tree';
	import TimelineTransport from './TimelineTransport.svelte';
	let {
		session,
		height,
		expanded,
		resizing,
		onToggleView
	}: {
		session: MotionSession;
		height: number;
		expanded: boolean;
		resizing: boolean;
		onToggleView: () => void;
	} = $props();
	let zoom = $state(8),
		collapsed = $state<string[]>([]),
		scroller = $state<HTMLDivElement>() as HTMLDivElement,
		content = $state<HTMLDivElement>() as HTMLDivElement;
	let scrub = $state(false),
		rowDrag = $state<{ id: string; revision: number } | null>(null),
		rowTarget = $state<string | null>(null),
		barSelection = $state<{
			startX: number;
			startY: number;
			endX: number;
			endY: number;
			additive: boolean;
		} | null>(null),
		tracks = $state<HTMLDivElement>() as HTMLDivElement,
		drag = $state<{
			x: number;
			ids: string[];
			frames: number[];
			min: number;
			max: number;
			revision: number;
			delta: number;
			layerId: string;
			property: string;
		} | null>(null);
	const labelWidth = 190;
	const timelineRows = $derived(flattenLayerTree(session.project.layers, collapsed));
	const duration = $derived(session.project.composition.durationFrames);
	const trackWidth = $derived(duration * zoom + 80);
	const tickStep = $derived(zoom < 4 ? 30 : zoom < 8 ? 15 : 10);
	const selectedAnimationCount = $derived(
		session.project.layers.reduce(
			(count, layer) =>
				count +
				Object.keys(layer.tracks).reduce(
					(propertyCount, property) =>
						propertyCount +
						animationSegments(layer, property).filter(
							(segment) =>
								session.context.selectedKeyframeIds.includes(segment.start.id) &&
								session.context.selectedKeyframeIds.includes(segment.end.id)
						).length,
					0
				),
			0
		)
	);
	function seek(e: PointerEvent) {
		const rect = content.getBoundingClientRect();
		session.seek(
			Math.max(0, Math.min(duration - 1, Math.round((e.clientX - rect.left - labelWidth) / zoom)))
		);
	}
	function startScrub(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		session.playing = false;
		scrub = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		seek(e);
	}
	function move(e: PointerEvent) {
		if (scrub) seek(e);
		if (barSelection) {
			const rect = tracks.getBoundingClientRect();
			barSelection = { ...barSelection, endX: e.clientX - rect.left, endY: e.clientY - rect.top };
			return;
		}
		if (drag) {
			const raw = Math.round((e.clientX - drag.x) / zoom),
				min = drag.min,
				max = drag.max;
			drag = { ...drag, delta: Math.max(min, Math.min(max, raw)) };
		}
	}
	function startBarSelection(e: PointerEvent) {
		if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest('button')) return;
		e.preventDefault();
		session.playing = false;
		const rect = tracks.getBoundingClientRect();
		barSelection = {
			startX: e.clientX - rect.left,
			startY: e.clientY - rect.top,
			endX: e.clientX - rect.left,
			endY: e.clientY - rect.top,
			additive: e.shiftKey
		};
		tracks.setPointerCapture(e.pointerId);
	}
	function overlaps(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }) {
		return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
	}
	function finish() {
		scrub = false;
		const selection = barSelection;
		barSelection = null;
		if (selection) {
			const trackRect = tracks.getBoundingClientRect();
			const rect = {
				left: trackRect.left + Math.min(selection.startX, selection.endX),
				top: trackRect.top + Math.min(selection.startY, selection.endY),
				right: trackRect.left + Math.max(selection.startX, selection.endX),
				bottom: trackRect.top + Math.max(selection.startY, selection.endY)
			};
			if (rect.right - rect.left < 3 && rect.bottom - rect.top < 3) {
				if (!selection.additive) session.select([]);
				return;
			}
			const bars = [...tracks.querySelectorAll<HTMLElement>('.animation-segment')].filter((bar) =>
				overlaps(bar.getBoundingClientRect(), rect)
			);
			const keyframeIds = bars.flatMap((bar) => bar.dataset.keyIds?.split(',') ?? []);
			const layerIds = bars.map((bar) => bar.dataset.layerId!).filter(Boolean);
			const properties = bars.map((bar) => bar.dataset.property!).filter(Boolean);
			session.select(
				selection.additive
					? [...new Set([...session.context.selectedLayerIds, ...layerIds])]
					: [...new Set(layerIds)],
				selection.additive
					? [...new Set([...session.context.selectedKeyframeIds, ...keyframeIds])]
					: [...new Set(keyframeIds)],
				selection.additive
					? [...new Set([...session.context.selectedProperties, ...properties])]
					: [...new Set(properties)]
			);
			return;
		}
		const d = drag;
		drag = null;
		if (d?.delta) {
			try {
				session.commit(
					[{ name: 'move_keyframes', input: { keyframeIds: d.ids, frames: d.delta } }],
					'Moved animation',
					'human',
					d.revision
				);
				session.error = '';
			} catch (e) {
				session.error = String(e);
			}
		}
	}
	function startBar(
		e: PointerEvent,
		l: Layer,
		property: string,
		start: Key,
		end?: Key,
		edge?: 'start' | 'end'
	) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		session.playing = false;
		session.select([l.id], end ? [start.id, end.id] : [start.id], [property]);
		const keys = edge ? (edge === 'start' ? [start] : [end!]) : end ? [start, end] : [start];
		const [min, max] = keyframeMoveBounds(
			l,
			property,
			keys.map((k) => k.id),
			duration
		);
		drag = {
			min,
			max,
			x: e.clientX,
			ids: keys.map((k) => k.id),
			frames: keys.map((k) => k.frame),
			revision: session.project.revision,
			delta: 0,
			layerId: l.id,
			property
		};
	}
	function frame(k: Key) {
		return k.frame + (drag?.ids.includes(k.id) ? drag.delta : 0);
	}
	function toggle(id: string) {
		collapsed = collapsed.includes(id) ? collapsed.filter((i) => i !== id) : [...collapsed, id];
	}
	function reorderRow(targetId: string) {
		const source = rowDrag;
		rowDrag = null;
		rowTarget = null;
		if (!source || source.id === targetId) return;
		const ordered = timelineRows.map((row) => row.layer.id).filter((id) => id !== source.id);
		const targetIndex = ordered.indexOf(targetId);
		if (targetIndex < 0) return;
		ordered.splice(targetIndex, 0, source.id);
		try {
			session.commit(
				[
					{
						name: 'reorder_layer',
						input: {
							layerId: source.id,
							index: session.project.layers.length - 1 - ordered.indexOf(source.id)
						}
					}
				],
				'Reordered timeline',
				'human',
				source.revision
			);
			session.error = '';
		} catch (error) {
			session.error = String(error);
		}
	}
	function wheel(e: WheelEvent) {
		if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
			e.preventDefault();
			scroller.scrollLeft += e.deltaX || e.deltaY;
		}
	}
	function keyboardSeek(e: KeyboardEvent) {
		if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
			e.preventDefault();
			e.stopPropagation();
			session.playing = false;
			session.seek(
				e.key === 'Home'
					? 0
					: e.key === 'End'
						? duration - 1
						: Math.max(
								0,
								Math.min(
									duration - 1,
									session.context.currentFrame +
										(e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)
								)
							)
			);
		}
	}
</script>

<svelte:window
	onpointermove={move}
	onpointerup={finish}
	onpointercancel={() => {
		scrub = false;
		barSelection = null;
		drag = null;
	}}
/>

<section
	class="timeline"
	class:expanded
	class:resizing
	aria-label="Animation timeline"
	style:height={`${height}px`}
	style:flex-basis={`${height}px`}
>
	<TimelineTransport
		playing={session.playing}
		currentFrame={session.context.currentFrame}
		lastFrame={duration - 1}
		fps={session.project.composition.fps}
		autoKey={session.autoKey}
		{zoom}
		{expanded}
		onGoToStart={() => {
			session.playing = false;
			session.seek(0);
		}}
		onTogglePlaying={() => (session.playing = !session.playing)}
		onAutoKeyChange={(enabled) => (session.autoKey = enabled)}
		onZoomChange={(value) => (zoom = value)}
		{onToggleView}
	/>
	<!-- Keyboard focus makes the horizontal scroll region accessible. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="timeline-scroll"
		bind:this={scroller}
		onwheel={wheel}
		role="region"
		aria-label="Scrollable timeline"
		tabindex="0"
	>
		<div class="timeline-content" bind:this={content} style:width={`${labelWidth + trackWidth}px`}>
			<div class="ruler-row">
				<div class="sticky-label ruler-label">Layers & animation</div>
				<div
					class="ruler"
					role="slider"
					tabindex="0"
					aria-label="Timeline playhead"
					aria-valuemin={0}
					aria-valuemax={duration - 1}
					aria-valuenow={session.context.currentFrame}
					style:width={`${trackWidth}px`}
					onpointerdown={startScrub}
					onpointercancel={() => {
						scrub = false;
						drag = null;
					}}
					onkeydown={keyboardSeek}
				>
					{#each Array.from({ length: Math.ceil(duration / tickStep) }, (_, i) => i * tickStep) as tick (tick)}<span
							class="ruler-tick"
							style:left={`${tick * zoom}px`}>{tick}<i></i></span
						>{/each}<span
						class="playhead-cap"
						style:left={`${session.context.currentFrame * zoom}px`}
					></span>
				</div>
			</div>
			<div
				class="tracks"
				bind:this={tracks}
				style:min-height="150px"
				role="group"
				aria-label="Animation tracks"
				onpointerdown={startBarSelection}
			>
				<div
					class="grid-lines"
					style:left={`${labelWidth}px`}
					style:background-size={`${tickStep * zoom}px 100%`}
				></div>
				{#each timelineRows as row (row.layer.id)}{@const l = row.layer}{@const animated =
						Object.entries(l.tracks).filter(([, t]) => t.keys.length)}
					<div
						class="layer-track"
						role="group"
						aria-label={`${l.name} timeline row`}
						class:group-track={l.type === 'group'}
						class:drop-target={rowTarget === l.id}
						ondragover={(event) => {
							if (!rowDrag) return;
							event.preventDefault();
							rowTarget = l.id;
						}}
						ondragleave={() => {
							if (rowTarget === l.id) rowTarget = null;
						}}
						ondrop={(event) => {
							event.preventDefault();
							reorderRow(l.id);
						}}
					>
						<div
							class="sticky-label layer-track-label"
							class:selected={session.context.selectedLayerIds.includes(l.id)}
						>
							<button
								class="expand-track"
								aria-label={`${collapsed.includes(l.id) ? 'Expand' : 'Collapse'} ${l.name} animation`}
								disabled={!animated.length && !row.childCount}
								onclick={() => toggle(l.id)}
								>{#if collapsed.includes(l.id)}<ChevronRight size={12} />{:else}<ChevronDown
										size={12}
									/>{/if}</button
							><button
								class="row-drag-handle"
								draggable="true"
								aria-label={`Reorder ${l.name} timeline`}
								title="Drag to reorder timeline"
								ondragstart={() => (rowDrag = { id: l.id, revision: session.project.revision })}
								ondragend={() => {
									rowDrag = null;
									rowTarget = null;
								}}><GripVertical size={12} /></button
							><span
								class="timeline-tree-gutter"
								style:width={`${row.depth * 13}px`}
								aria-hidden="true"
								>{#if row.depth > 0}<CornerDownRight size={11} />{/if}</span
							><button
								class="track-name"
								class:group-name={l.type === 'group'}
								onclick={() => session.select([l.id])}>{l.name}</button
							><span class="track-count">{animated.length || ''}</span>
						</div>
						<button
							class="layer-lane"
							aria-label={`Select ${l.name} track`}
							onclick={() => session.select([l.id])}
							style:width={`${trackWidth}px`}
							>{#if !animated.length}{#if row.childCount}<span
										>{row.childCount} {row.childCount === 1 ? 'layer' : 'layers'}</span
									>{:else}<span>Add keyframes or enable Auto-key to animate</span>{/if}
								>{:else if collapsed.includes(l.id)}<span
									>{row.childCount
										? `${row.childCount} ${row.childCount === 1 ? 'layer' : 'layers'} · `
										: ''}{animated.length} animated {animated.length === 1
										? 'property'
										: 'properties'}</span
								>{/if}</button
						>
					</div>
					{#if !collapsed.includes(l.id)}{#each animated as [property, track] (property)}<div
								class="property-track"
							>
								<button
									class="sticky-label property-label"
									class:selected={session.context.selectedLayerIds.includes(l.id) &&
										session.context.selectedProperties.includes(property)}
									style:padding-left={`${31 + row.depth * 13}px`}
									title={property}
									onclick={() => session.select([l.id], [], [property])}
									><span class="property-dot"></span><span
										>{property
											.replace(/^gradient\.stop\.[^.]+\./, 'stop · ')
											.replace('gradient.', '')}</span
									></button
								>
								<div class="animation-lane" style:width={`${trackWidth}px`}>
									{#each animationSegments(l, property) as segment (segment.id)}{@const active =
											session.context.selectedKeyframeIds.includes(segment.start.id) &&
											session.context.selectedKeyframeIds.includes(segment.end.id)}
										<div
											class="animation-segment"
											class:active
											class:locked={l.locked}
											data-layer-id={l.id}
											data-property={property}
											data-key-ids={`${segment.start.id},${segment.end.id}`}
											style:left={`${frame(segment.start) * zoom}px`}
											style:width={`${Math.max(6, (frame(segment.end) - frame(segment.start)) * zoom)}px`}
										>
											<button
												class="bar-body"
												disabled={l.locked}
												aria-label={`${l.name} ${property} animation ${segment.start.frame} to ${segment.end.frame}`}
												title={`${property} · ${segment.start.frame}–${segment.end.frame}f · drag to move, click to edit easing`}
												onpointerdown={(e) => startBar(e, l, property, segment.start, segment.end)}
												onpointercancel={() => (drag = null)}
												onclick={() =>
													session.select([l.id], [segment.start.id, segment.end.id], [property])}
												><span>{segment.end.frame - segment.start.frame}f</span><svg
													viewBox="0 0 20 12"
													aria-hidden="true"
													><path
														d={segment.start.easing.type === 'hold'
															? 'M1 11H19V1'
															: segment.start.easing.type === 'linear'
																? 'M1 11L19 1'
																: 'M1 11C11 11 9 1 19 1'}
													/></svg
												></button
											>{#if active && !l.locked}<button
													class="bar-edge start"
													aria-label="Drag animation start"
													title="Drag animation start"
													onpointerdown={(e) =>
														startBar(e, l, property, segment.start, segment.end, 'start')}
													onpointercancel={() => (drag = null)}
												></button><button
													class="bar-edge end"
													aria-label="Drag animation end"
													title="Drag animation end"
													onpointerdown={(e) =>
														startBar(e, l, property, segment.start, segment.end, 'end')}
													onpointercancel={() => (drag = null)}
												></button>{/if}
										</div>{/each}{#if track.keys.length === 1}{@const k = track.keys[0]}<button
											class="single-key"
											class:active={session.context.selectedKeyframeIds.includes(k.id)}
											disabled={l.locked}
											style:left={`${frame(k) * zoom}px`}
											aria-label={`${l.name} ${property} key at ${k.frame}`}
											title="One key · add another at a later frame to create animation"
											onpointerdown={(e) => startBar(e, l, property, k)}
											onpointercancel={() => (drag = null)}
											onclick={() => session.select([l.id], [k.id], [property])}
										></button>{/if}
								</div>
							</div>{/each}{/if}{/each}{#if !session.project.layers.length}<p
						class="timeline-empty"
						style:margin-left={`${labelWidth + 24}px`}
					>
						Your animation starts here. Add a layer from the toolbar.
					</p>{/if}
				{#if barSelection}<div
						class="bar-selection"
						style:left={`${Math.min(barSelection.startX, barSelection.endX)}px`}
						style:top={`${Math.min(barSelection.startY, barSelection.endY)}px`}
						style:width={`${Math.abs(barSelection.endX - barSelection.startX)}px`}
						style:height={`${Math.abs(barSelection.endY - barSelection.startY)}px`}
					></div>{/if}
				<div
					class="playhead-line"
					style:left={`${labelWidth + session.context.currentFrame * zoom}px`}
				>
					<button
						aria-label="Drag playhead"
						title="Drag playhead"
						onpointerdown={startScrub}
						onpointercancel={() => (scrub = false)}
					></button>
				</div>
			</div>
		</div>
	</div>
	<div class="timeline-footer">
		<span
			>{selectedAnimationCount > 1
				? `${selectedAnimationCount} animations selected · edit easing or delete together in Properties`
				: selectedAnimationCount === 1
					? 'Drag animation to move · drag edges to trim · easing in Properties'
					: 'Drag across bars to select · Shift adds bars · Shift + scroll pans horizontally'}</span
		><span
			>{session.autoKey
				? 'Auto-key on · edits create animation'
				: 'Auto-key off · edits adjust the whole track'}</span
		>
	</div>
</section>

<style>
	.timeline {
		min-height: 180px;
		flex-grow: 0;
		flex-shrink: 0;
		background: var(--surface-timeline);
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		min-width: 0;
		color: var(--text-muted);
		transition:
			height 260ms cubic-bezier(0.22, 1, 0.36, 1),
			flex-basis 260ms cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 260ms ease-out;
	}
	.timeline.expanded {
		box-shadow: 0 -18px 44px #0008;
	}
	.timeline.resizing {
		transition: none;
	}
	.timeline-scroll {
		overflow: auto;
		flex: 1;
		min-height: 0;
		min-width: 0;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.timeline-content {
		position: relative;
		min-width: 100%;
		min-height: 100%;
	}
	.ruler-row {
		display: flex;
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--surface-timeline-raised);
		height: 29px;
		border-bottom: 1px solid var(--line);
	}
	.sticky-label {
		position: sticky;
		left: 0;
		width: 190px;
		min-width: 190px;
		z-index: 3;
		box-sizing: border-box;
		background: var(--surface-timeline);
	}
	.ruler-label {
		z-index: 6;
		padding: 8px 14px;
		font-size: var(--type-meta);
		color: var(--text-subtle);
		background: var(--surface-timeline-raised);
		border-right: 1px solid var(--line);
	}
	.ruler {
		position: relative;
		cursor: ew-resize;
		touch-action: none;
		flex-shrink: 0;
		outline-offset: -2px;
	}
	.ruler-tick {
		position: absolute;
		top: 4px;
		font: 400 var(--type-meta) / 1 var(--mono);
		color: var(--text-subtle);
		padding-left: 4px;
		pointer-events: none;
	}
	.ruler-tick i {
		position: absolute;
		top: 15px;
		left: 0;
		height: 8px;
		border-left: 1px solid var(--line-bright);
	}
	.playhead-cap {
		position: absolute;
		top: 17px;
		width: 10px;
		height: 12px;
		transform: translateX(-50%);
		background: var(--acid);
		clip-path: polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%);
		pointer-events: none;
	}
	.tracks {
		position: relative;
	}
	.grid-lines {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		background-image: linear-gradient(90deg, color-mix(in srgb, var(--line) 60%, transparent) 1px, transparent 1px);
		pointer-events: none;
	}
	.layer-track,
	.property-track {
		height: 29px;
		display: flex;
		position: relative;
	}
	.layer-track.drop-target {
		box-shadow: inset 0 2px 0 var(--acid);
	}
	.layer-track-label {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 0 10px;
		border-right: 1px solid var(--line);
	}
	.layer-track-label.selected {
		background: var(--selection-strong);
	}
	.group-track .layer-track-label,
	.group-track .layer-lane {
		background-color: var(--surface-selected);
	}
	.group-track .layer-track-label {
		box-shadow: inset 2px 0 0 var(--info);
	}
	.timeline-tree-gutter {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		color: var(--text-subtle);
		flex-shrink: 0;
	}
	.expand-track,
	.track-name {
		border: 0;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
		cursor: pointer;
	}
	.row-drag-handle {
		width: 18px;
		height: 24px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-subtle);
		cursor: grab;
		display: inline-grid;
		place-items: center;
	}
	.row-drag-handle:hover,
	.row-drag-handle:focus-visible {
		color: var(--acid);
		outline: none;
	}
	.row-drag-handle:active {
		cursor: grabbing;
	}
	.track-name.group-name {
		font-weight: 600;
		color: var(--paper);
	}
	.expand-track {
		width: 15px;
		height: 22px;
		display: grid;
		place-items: center;
	}
	.expand-track:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.track-name {
		font-size: var(--type-label);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
		flex: 1;
	}
	.track-count {
		font: 400 var(--type-meta) / 1 var(--mono);
		color: var(--text-subtle);
	}
	.layer-lane {
		border: 0;
		background: var(--surface-timeline-lane);
		text-align: left;
		padding: 0 14px;
		flex-shrink: 0;
		cursor: pointer;
	}
	.layer-lane span {
		font-size: var(--type-meta);
		color: var(--text-subtle);
	}
	.property-label {
		display: flex;
		align-items: center;
		gap: 9px;
		border: 0;
		border-right: 1px solid var(--line);
		text-align: left;
		padding: 0 13px 0 31px;
		color: var(--text-subtle);
		font-size: var(--type-meta);
		cursor: pointer;
	}
	.property-label > span:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.property-label.selected {
		color: var(--acid);
		background: var(--selection-strong);
	}
	.property-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--info);
		flex-shrink: 0;
	}
	.animation-lane {
		position: relative;
		flex-shrink: 0;
	}
	.animation-segment {
		position: absolute;
		top: 5px;
		height: 19px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--info) 42%, var(--ink));
		border: 1px solid color-mix(in srgb, var(--info) 72%, var(--line));
		box-sizing: border-box;
		color: var(--paper);
	}
	.animation-segment:nth-child(even) {
		background: color-mix(in srgb, var(--sky-500) 26%, var(--panel));
		border-color: var(--line-bright);
		color: var(--text-muted);
	}
	.animation-segment.active {
		background: var(--selection-strong);
		color: var(--paper);
		border-color: var(--acid);
		box-shadow: 0 0 0 1px var(--selection-fill);
	}
	.bar-selection {
		position: absolute;
		z-index: 4;
		box-sizing: border-box;
		border: 1px solid var(--acid);
		background: var(--selection-fill);
		pointer-events: none;
	}
	.bar-body {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 5px;
		width: 100%;
		height: 100%;
		padding: 0 8px;
		border: 0;
		background: transparent;
		color: inherit;
		overflow: hidden;
		cursor: grab;
		touch-action: none;
		text-align: left;
		font: 400 0.625rem/1 var(--mono);
		border-radius: 3px;
	}
	.bar-body:active {
		cursor: grabbing;
	}
	.bar-body svg {
		width: 16px;
		min-width: 16px;
		height: 10px;
		opacity: 0.7;
		pointer-events: none;
	}
	.bar-body path {
		stroke: currentColor;
		fill: none;
		stroke-width: 1.3;
	}
	.bar-body span {
		pointer-events: none;
	}
	.bar-edge {
		position: absolute;
		top: 1px;
		bottom: 1px;
		width: 8px;
		border: 0;
		background: color-mix(in srgb, var(--sky-300) 72%, transparent);
		border-radius: 2px;
		cursor: ew-resize;
		touch-action: none;
		padding: 0;
	}
	.bar-edge.start {
		left: 0;
	}
	.bar-edge.end {
		right: 0;
	}
	.single-key {
		position: absolute;
		top: 7px;
		width: 8px;
		height: 15px;
		transform: translateX(-4px);
		border: 1px solid var(--sky-400);
		background: color-mix(in srgb, var(--acid) 40%, var(--ink));
		border-radius: 3px;
		padding: 0;
		cursor: grab;
		touch-action: none;
	}
	.single-key.active {
		background: var(--selection-strong);
		border-color: var(--acid);
		box-shadow: 0 0 0 1px var(--selection-fill);
	}
	.locked {
		opacity: 0.45;
	}
	.playhead-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--acid);
		z-index: 2;
		pointer-events: none;
	}
	.playhead-line button {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -3px;
		width: 7px;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: ew-resize;
		pointer-events: auto;
		touch-action: none;
	}
	.timeline-footer {
		height: 22px;
		min-height: 22px;
		padding: 0 15px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		font: 400 var(--type-meta) / 1 var(--mono);
		color: var(--text-subtle);
		border-top: 1px solid var(--line);
	}
	.timeline-empty {
		padding-top: 30px;
		font-size: var(--type-label);
		color: var(--text-subtle);
	}
	@media (max-width: 900px) {
		.timeline {
			height: 230px;
			flex-basis: 230px;
		}
	}
</style>
