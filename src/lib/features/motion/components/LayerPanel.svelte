<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		Layers,
		Activity,
		Settings2,
		Eye,
		EyeOff,
		LockKeyhole,
		UnlockKeyhole,
		GripVertical,
		Type,
		Square,
		Circle,
		Image,
		Folder,
		FolderPlus,
		ChevronDown,
		ChevronRight,
		CornerDownRight,
		ArrowUp,
		ArrowDown,
		ArrowLeft,
		Check
	} from '@lucide/svelte';
	import NumericInput from './NumericInput.svelte';
	import type { Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	let { session, open }: { session: MotionSession; open: boolean } = $props();
	let tab = $state('layers'),
		dragId = $state<string | null>(null),
		target = $state<string | null>(null),
		after = $state(false);
	let dragRevision = 0;
	let collapsedGroups = $state<string[]>([]);
	let pointer: { id: string; x: number; y: number; moved: boolean } | null = null;
	let suppressClick = false;
	function pointerStart(e: PointerEvent, id: string, locked: boolean) {
		if (
			locked ||
			e.button !== 0 ||
			!(e.target instanceof Element) ||
			!e.target.closest('.layer-select,.grip')
		)
			return;
		pointer = { id, x: e.clientX, y: e.clientY, moved: false };
		dragRevision = session.project.revision;
		suppressClick = false;
		((e.target.closest('button') ?? e.currentTarget) as HTMLElement).setPointerCapture(e.pointerId);
	}
	function pointerMove(e: PointerEvent) {
		if (!pointer) return;
		if (!pointer.moved && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 5) return;
		pointer.moved = true;
		dragId = pointer.id;
		const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.layer-row');
		if (!row) {
			target = null;
			return;
		}
		target = row.dataset.layerId ?? null;
		const rect = row.getBoundingClientRect();
		after = e.clientY > rect.top + rect.height / 2;
		const panel = row.closest<HTMLElement>('[role=tabpanel]');
		if (panel) {
			const bounds = panel.getBoundingClientRect();
			if (e.clientY > bounds.bottom - 24) panel.scrollTop += 12;
			else if (e.clientY < bounds.top + 24) panel.scrollTop -= 12;
		}
	}
	function pointerFinish() {
		const moved = pointer?.moved;
		pointer = null;
		if (moved) {
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 0);
			drop();
		} else {
			dragId = null;
			target = null;
		}
	}
	function selectLayer(e: MouseEvent, id: string) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		session.select(e.shiftKey ? [...new Set([...session.context.selectedLayerIds, id])] : [id]);
	}

	const sidebar = Sidebar.useSidebar();
	type TreeRow = { layer: Layer; depth: number; hasChildren: boolean };
	const rows = $derived.by(() => {
		const childrenOf = (parentId?: string) =>
			session.project.layers.filter((layer) => layer.parentId === parentId).reverse();
		const visit = (parentId: string | undefined, depth: number): TreeRow[] =>
			childrenOf(parentId).flatMap((layer) => {
				const children = childrenOf(layer.id);
				const row = { layer, depth, hasChildren: children.length > 0 };
				return collapsedGroups.includes(layer.id) ? [row] : [row, ...visit(layer.id, depth + 1)];
			});
		return visit(undefined, 0);
	});
	function toggleGroup(id: string) {
		collapsedGroups = collapsedGroups.includes(id)
			? collapsedGroups.filter((entry) => entry !== id)
			: [...collapsedGroups, id];
	}
	function safe(fn: () => unknown) {
		try {
			fn();
			session.error = '';
		} catch (e) {
			session.error = String(e);
		}
	}
	function drop() {
		const id = dragId,
			to = target,
			below = after;
		dragId = null;
		target = null;
		if (!id || !to || id === to) return;
		const ordered = rows.map((row) => row.layer.id).filter((layerId) => layerId !== id);
		ordered.splice(ordered.indexOf(to) + (below ? 1 : 0), 0, id);
		safe(() =>
			session.commit(
				[
					{
						name: 'reorder_layer',
						input: { layerId: id, index: ordered.length - 1 - ordered.indexOf(id) }
					}
				],
				'Reordered layer',
				'human',
				dragRevision
			)
		);
	}
	function nudge(id: string, delta: number) {
		const index = session.project.layers.findIndex((l) => l.id === id);
		safe(() =>
			session.run(
				'reorder_layer',
				{ layerId: id, index: Math.max(0, Math.min(rows.length - 1, index + delta)) },
				'Reordered layer'
			)
		);
	}
	function groupSelected() {
		const layerIds = session.context.selectedLayerIds;
		if (layerIds.length < 2) return;
		safe(() => {
			const result = session.run('group_layers', { layerIds }, 'Grouped layers');
			const group = result.data[0] as { layerId: string };
			session.select([group.layerId]);
		});
	}
</script>

<Sidebar.Root collapsible="icon" class="editor-sidebar"
	><Sidebar.Header class="editor-sidebar-header"
		><div class="project-heading">
			{#if open}<a href="/" aria-label="Back to projects" title="Back to projects"
					><ArrowLeft size={15} /></a
				>{/if}{#if open}<span>ani<b>MCP</b></span>{/if}<Sidebar.Trigger
				class="editor-icon"
				title="Toggle left sidebar"
			/>
		</div>
		{#if open}<Input
				aria-label="Project name"
				class="project-name"
				value={session.project.name}
				onchange={(e) => safe(() => session.run('rename_project', { name: e.currentTarget.value }))}
			/>{/if}</Sidebar.Header
	><Sidebar.Content class="editor-sidebar-content"
		><Tabs.Root bind:value={tab} class={open ? 'panel-tabs' : 'panel-tabs collapsed'}
			><Tabs.List class="panel-tab-list"
				>{#each [{ id: 'layers', icon: Layers, label: 'Layers' }, { id: 'activity', icon: Activity, label: 'Activity' }, { id: 'composition', icon: Settings2, label: 'Composition' }] as item}<Tabs.Trigger
						value={item.id}
						aria-label={item.label}
						title={item.label}
						class="panel-tab"
						onclick={() => {
							if (!open) sidebar.setOpen(true);
						}}><item.icon size={16} /></Tabs.Trigger
					>{/each}</Tabs.List
			>{#if open}<Tabs.Content value="layers" class="panel-tab-content"
					><div class="panel-heading">Layers <span>{session.project.layers.length}</span></div>
						<div class="layer-list">
							{#each rows as row (row.layer.id)}{@const l = row.layer}<div
									class="layer-row"
									class:group-row={l.type === 'group'}
									class:child-row={row.depth > 0}
								class:active={session.context.selectedLayerIds.includes(l.id)}
								class:drop-before={target === l.id && !after}
								class:drop-after={target === l.id && after}
								data-layer-id={l.id}
								role="group"
								aria-label={`${l.name} layer`}
								onpointerdown={(e) => pointerStart(e, l.id, l.locked)}
								onpointermove={pointerMove}
								onpointerup={pointerFinish}
								onpointercancel={() => {
									pointer = null;
									dragId = null;
									target = null;
								}}
							>
									<div class="tree-gutter" style:width={`${row.depth * 14}px`} aria-hidden="true">
										{#if row.depth > 0}<CornerDownRight size={13} />{/if}
									</div>{#if l.type === 'group'}<button
										class="group-toggle"
										aria-label={`${collapsedGroups.includes(l.id) ? 'Expand' : 'Collapse'} ${l.name}`}
										title={collapsedGroups.includes(l.id) ? 'Expand group' : 'Collapse group'}
										disabled={!row.hasChildren}
										onclick={(event) => {
											event.stopPropagation();
											toggleGroup(l.id);
										}}>{#if collapsedGroups.includes(l.id)}<ChevronRight size={13} />{:else}<ChevronDown
											size={13}
											/>{/if}</button>{:else}<span class="group-toggle-spacer"></span>{/if}<GripVertical size={12} class="grip" /><button
										class="layer-select"
										title={`${l.name} · drag to reorder · Alt+↑/↓ to move`}
									onclick={(e) => selectLayer(e, l.id)}
									onkeydown={(e) => {
										if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
											e.preventDefault();
											nudge(l.id, e.key === 'ArrowUp' ? 1 : -1);
										}
									}}
									>{#if l.type === 'group'}<Folder size={14} />{:else if l.type === 'text'}<Type size={14} />{:else if l.type === 'rectangle'}<Square
											size={14}
										/>{:else if l.type === 'ellipse'}<Circle size={14} />{:else}<Image
											size={14}
										/>{/if}<span>{l.name}</span></button
								><Button
									class="layer-action"
									variant="ghost"
									size="icon-xs"
									aria-label={`Toggle ${l.name} visibility`}
									title="Toggle visibility"
									onclick={() =>
										safe(() =>
											session.run('set_layer', { layerId: l.id, changes: { visible: !l.visible } })
										)}
									>{#if l.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}</Button
								><Button
									class="layer-action"
									variant="ghost"
									size="icon-xs"
									aria-label={`Toggle ${l.name} lock`}
									title="Toggle lock"
									onclick={() =>
										safe(() =>
											session.run('set_layer', { layerId: l.id, changes: { locked: !l.locked } })
										)}
									>{#if l.locked}<LockKeyhole size={12} />{:else}<UnlockKeyhole
											size={12}
										/>{/if}</Button
								>
							</div>{/each}
					</div>
					{#if !rows.length}<p class="hint">
							Add a shape, text, or import artwork to get started.
						</p>{:else}<div class="layer-footer">
								<Button
									variant="ghost"
									size="sm"
									class="group-action"
									disabled={session.context.selectedLayerIds.length < 2}
									onclick={groupSelected}><FolderPlus size={13} /> Group</Button
								><span>Drag to reorder</span><Button
								variant="ghost"
								size="icon-xs"
								aria-label="Raise layer"
								title="Raise layer"
								disabled={!session.context.selectedLayerIds.length}
								onclick={() => nudge(session.context.selectedLayerIds[0], 1)}><ArrowUp /></Button
							><Button
								variant="ghost"
								size="icon-xs"
								aria-label="Lower layer"
								title="Lower layer"
								disabled={!session.context.selectedLayerIds.length}
								onclick={() => nudge(session.context.selectedLayerIds[0], -1)}><ArrowDown /></Button
							>
						</div>{/if}</Tabs.Content
				><Tabs.Content value="activity" class="panel-tab-content"
					><div class="panel-heading">Activity <span>{session.history.length}</span></div>
					{#each [...session.history].reverse() as entry}<div class="activity-entry">
							<span class:agent={entry.actor === 'agent'}
								>{entry.actor === 'agent' ? 'Agent' : 'You'}</span
							>
							<p>{entry.label}</p>
						</div>{/each}{#if !session.history.length}<p class="hint">
							Your edits and agent changes appear here.
						</p>{/if}</Tabs.Content
				><Tabs.Content value="composition" class="panel-tab-content"
					><div class="panel-heading">Composition</div>
					<div class="composition-fields">
						{#each [{ key: 'width', label: 'Width', max: 8192 }, { key: 'height', label: 'Height', max: 8192 }, { key: 'fps', label: 'Frame rate', max: 120 }, { key: 'durationFrames', label: 'Duration (frames)', max: 36000 }] as field}<label
								>{field.label}<NumericInput
									label={`Composition ${field.key}`}
									value={session.project.composition[field.key as 'width']}
									min={1}
									max={field.max}
									oncommit={(v) =>
										safe(() => session.run('set_composition', { [field.key]: Math.round(v) }))}
								/></label
							>{/each}<label
							>Background<input
								type="color"
								aria-label="Background color"
								value={session.project.composition.background}
								onchange={(e) =>
									safe(() => session.run('set_composition', { background: e.currentTarget.value }))}
							/></label
						>
					</div></Tabs.Content
				>{/if}</Tabs.Root
		></Sidebar.Content
	><Sidebar.Footer class="editor-sidebar-footer"
		>{#if open}<Check size={12} /><span>{session.saveStatus}</span>{/if}</Sidebar.Footer
	></Sidebar.Root
>

<style>
	.project-heading {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 30px;
	}
	.project-heading a {
		color: var(--muted-foreground);
	}
	.project-heading > span {
		font-size: 17px;
		letter-spacing: -0.7px;
		flex: 1;
	}
	.project-heading b {
		color: var(--acid);
	}
	.project-heading :global(button) {
		margin-left: auto;
	}
	.project-heading a:hover {
		color: var(--paper);
	}
	:global(.editor-sidebar-header) {
		padding: 12px !important;
		gap: 10px !important;
	}
	:global(.project-name) {
		height: 28px !important;
		border: 0 !important;
		background: transparent !important;
		padding: 0 !important;
		box-shadow: none !important;
		font-size: 12px !important;
		color: var(--paper) !important;
	}
	:global(.editor-sidebar-content) {
		overflow: hidden !important;
	}
	:global(.panel-tabs) {
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	:global(.panel-tab-list) {
		width: 100%;
		border-radius: 0 !important;
		background: transparent !important;
		border-bottom: 1px solid var(--line);
		display: flex !important;
		padding: 0 10px !important;
		height: 40px !important;
		gap: 3px;
	}
	:global(.panel-tab) {
		flex: 1;
		height: 32px !important;
		border-radius: 5px !important;
		color: var(--muted-foreground) !important;
		background: transparent !important;
		border: 0 !important;
		box-shadow: none !important;
	}
	:global(.panel-tab[data-state='active']) {
		background: var(--accent) !important;
		color: var(--acid) !important;
	}
	:global(.collapsed .panel-tab-list) {
		height: auto !important;
		flex-direction: column;
		padding: 5px !important;
		border: 0;
	}
	:global(.collapsed .panel-tab) {
		flex: none;
		width: 32px;
	}
	:global(.panel-tab-content) {
		overflow: auto;
		min-height: 0;
		margin: 0 !important;
	}
	.panel-heading {
		display: flex;
		justify-content: space-between;
		padding: 17px 14px 10px;
		font-size: var(--type-label);
		color: var(--paper);
	}
	.panel-heading span {
		color: var(--muted-foreground);
	}
	.layer-list {
		padding: 0 6px;
	}
	.layer-row {
		touch-action: none;
		user-select: none;
		height: 36px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 3px;
		border-radius: 5px;
		position: relative;
		border: 1px solid transparent;
	}
	.layer-row.active {
		background: var(--accent);
		border-color: var(--line-bright);
	}
	.layer-row.group-row {
		background: color-mix(in srgb, var(--panel-raised) 70%, transparent);
	}
	.layer-row.group-row.active {
		background: var(--accent);
	}
	.tree-gutter {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		height: 100%;
		color: #66829d;
		flex-shrink: 0;
	}
	.group-toggle,
	.group-toggle-spacer {
		width: 16px;
		height: 24px;
		flex-shrink: 0;
	}
	.group-toggle {
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.group-toggle:hover:not(:disabled),
	.group-toggle:focus-visible {
		background: var(--accent);
		color: var(--paper);
		outline: none;
	}
	.group-toggle:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.layer-row.drop-before:before,
	.layer-row.drop-after:after {
		content: '';
		position: absolute;
		height: 2px;
		background: var(--acid);
		left: 0;
		right: 0;
		z-index: 2;
	}
	.layer-row.drop-before:before {
		top: -2px;
	}
	.layer-row.drop-after:after {
		bottom: -2px;
	}
	.layer-row :global(.grip) {
		color: var(--muted-foreground);
		cursor: grab;
		flex-shrink: 0;
	}
	.layer-select {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 5px 3px;
		color: var(--paper);
		background: transparent;
		border: 0;
		text-align: left;
		cursor: grab;
		font-size: var(--type-label);
	}
	.layer-select span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.layer-select :global(svg) {
		color: var(--muted-foreground);
		flex-shrink: 0;
	}
	.layer-row :global(.layer-action) {
		color: var(--muted-foreground);
		width: 23px;
		height: 26px;
		border-radius: 4px;
	}
	.layer-row :global(.layer-action:hover) {
		color: var(--paper);
		background: var(--panel-raised);
	}
	.layer-footer {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 14px 12px;
		color: var(--muted-foreground);
	}
	.layer-footer > span {
		flex: 1;
		font-size: var(--type-meta);
	}
	.layer-footer :global(.group-action) {
		gap: 5px;
		color: var(--acid);
	}
	.layer-footer :global(button) {
		border-radius: 4px;
	}
	.hint {
		margin: 14px;
		font-size: var(--type-label);
		line-height: 1.7;
		color: var(--muted-foreground);
	}
	.activity-entry {
		margin: 0 14px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.activity-entry span {
		font: 400 var(--type-meta) / 1 var(--mono);
		color: var(--muted-foreground);
	}
	.activity-entry span.agent {
		color: var(--acid);
	}
	.activity-entry p {
		font-size: var(--type-label);
		margin: 5px 0;
		color: var(--paper);
	}
	.composition-fields {
		padding: 0 14px;
	}
	.composition-fields label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin: 10px 0;
		color: var(--muted-foreground);
		font-size: var(--type-label);
	}
	.composition-fields :global(input) {
		width: 86px;
	}
	.composition-fields input[type='color'] {
		padding: 0;
		border: 0;
		width: 86px;
		height: 28px;
		background: transparent;
		border-radius: 4px;
	}
	:global(.editor-sidebar-footer) {
		display: flex !important;
		flex-direction: row !important;
		align-items: center;
		gap: 7px !important;
		padding: 12px !important;
		color: var(--muted-foreground);
		font-size: var(--type-meta);
		border-top: 1px solid var(--line);
	}
</style>
