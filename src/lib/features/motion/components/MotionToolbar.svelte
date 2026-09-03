<script lang="ts">
	import {
		Move,
		PenTool,
		Square,
		Circle,
		Type,
		Import,
		Undo2,
		Redo2,
		Bot,
		Download,
		FolderPlus,
		Film
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import type { Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	import type { ExportFormat } from '../project-files';
	import { toolDeclarations } from '../webmcp';
	import WebMcpToolCatalog from './WebMcpToolCatalog.svelte';

	let {
		session,
		busy,
		onCreate,
		onGroup,
		onImport,
		onExport,
		onUndo,
		onRedo,
		onToolChange,
		activeTool
	}: {
		session: MotionSession;
		busy: boolean;
		onCreate: (type: Layer['type']) => void;
		onGroup: () => void;
		onImport: () => void;
		onExport: (format: ExportFormat) => void;
		onUndo: () => void;
		onRedo: () => void;
		onToolChange: (tool: 'move' | 'pen') => void;
		activeTool: 'move' | 'pen';
	} = $props();

	const webmcpTools = Object.values(toolDeclarations);
	let popover = $state<'webmcp' | 'export' | null>(null);
	let webmcpTrigger = $state<HTMLElement | null>(null);
	let exportTrigger = $state<HTMLElement | null>(null);

	function popoverPosition(kind: 'webmcp' | 'export') {
		const trigger = kind === 'webmcp' ? webmcpTrigger : exportTrigger;
		const rect = trigger?.getBoundingClientRect();
		const width = Math.min(kind === 'webmcp' ? 390 : 328, window.innerWidth - 24);
		const left = Math.max(
			12,
			Math.min((rect?.right ?? 12) - width, window.innerWidth - width - 12)
		);
		return `top:${Math.min((rect?.bottom ?? 0) + 12, window.innerHeight - 60)}px;left:${left}px`;
	}
</script>

<svelte:window
	onclick={(event) => {
		if (
			!(event.target instanceof Element) ||
			!event.target.closest('[data-popover-trigger], .motion-popover')
		)
			popover = null;
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') popover = null;
	}}
	onresize={() => (popover = null)}
/>
<div class="floating-toolbar" role="toolbar" aria-label="Drawing tools">
	<Button
		variant="ghost"
		size="icon-sm"
		class={`editor-icon ${activeTool === 'move' ? 'tool-active' : ''}`}
		aria-label="Move tool"
		title="Move / select · drag layers on canvas"
		onclick={() => onToolChange('move')}><Move /></Button
	>
	<span class="tool-divider"></span>
	<Button
		variant="ghost"
		size="icon-sm"
		class={`editor-icon ${activeTool === 'pen' ? 'tool-active' : ''}`}
		aria-label="Pen tool"
		title="Pen · click points, drag to curve, Enter finishes"
		onclick={() => onToolChange('pen')}><PenTool /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Rectangle"
		title="Rectangle"
		onclick={() => onCreate('rectangle')}><Square /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Ellipse"
		title="Ellipse"
		onclick={() => onCreate('ellipse')}><Circle /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Text"
		title="Text"
		onclick={() => onCreate('text')}><Type /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Group selected layers"
		title="Group selected layers"
		disabled={session.context.selectedLayerIds.length < 2}
		onclick={onGroup}><FolderPlus /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Import SVG or PNG"
		title="Import SVG / PNG"
		disabled={busy}
		onclick={onImport}><Import /></Button
	>
	<span class="tool-divider"></span>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Undo"
		title="Undo · Ctrl+Z"
		disabled={!session.history.length}
		onclick={onUndo}><Undo2 /></Button
	>
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon"
		aria-label="Redo"
		title="Redo · Ctrl+Shift+Z"
		disabled={!session.future.length}
		onclick={onRedo}><Redo2 /></Button
	>
	<span class="tool-divider"></span>
	<div class="popover-anchor">
		<Button
			variant="ghost"
			size="icon-sm"
			class="editor-icon webmcp-trigger"
			aria-label="WebMCP"
			title="WebMCP agent connection"
			aria-expanded={popover === 'webmcp'}
			aria-controls="webmcp-popover"
			data-popover-trigger
			bind:ref={webmcpTrigger}
			onclick={(event) => {
				event.stopPropagation();
				popover = popover === 'webmcp' ? null : 'webmcp';
			}}
		>
			<Bot size={17} />
			<i class:connected={session.webmcp.includes('registered') || session.webmcp.includes('ready')}
			></i>
		</Button>
	</div>
	<div class="popover-anchor">
		<Button
			variant="ghost"
			size="icon-sm"
			class="editor-icon"
			aria-label="Export"
			title="Export"
			aria-expanded={popover === 'export'}
			aria-controls="export-popover"
			data-popover-trigger
			bind:ref={exportTrigger}
			onclick={(event) => {
				event.stopPropagation();
				popover = popover === 'export' ? null : 'export';
			}}
		>
			<Download size={16} />
		</Button>
	</div>
</div>
{#if popover === 'webmcp'}<div
		id="webmcp-popover"
		class="motion-popover webmcp-popover"
		style={popoverPosition('webmcp')}
		role="dialog"
		tabindex="-1"
		aria-label="WebMCP agent connection"
	>
		<p class="webmcp-status">{session.webmcp}</p>
		<WebMcpToolCatalog tools={webmcpTools} />
	</div>{/if}
{#if popover === 'export'}<div
		id="export-popover"
		class="motion-popover export-menu"
		style={popoverPosition('export')}
		role="dialog"
		tabindex="-1"
		aria-label="Export composition"
	>
		<div class="popover-heading">Export composition</div>
		<Button variant="ghost" disabled={busy} onclick={() => onExport('native')}>.animcp.json</Button>
		<Button variant="ghost" disabled={busy} onclick={() => onExport('svg')}>
			Current frame · SVG
		</Button>
		<Button variant="ghost" disabled={busy} onclick={() => onExport('lottie')}>
			Lottie animation
		</Button>
		<Button variant="ghost" disabled={busy} onclick={() => onExport('mp4')}>
			<Film size={14} /> MP4 video · H.264
		</Button>
	</div>{/if}

<style>
	.floating-toolbar {
		position: absolute;
		z-index: 9;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		padding: 5px;
		display: flex;
		align-items: center;
		gap: 2px;
		background: color-mix(in srgb, var(--panel-raised) 94%, transparent);
		border: 1px solid var(--line-bright);
		border-radius: 10px;
		box-shadow: 0 6px 22px #0005;
		white-space: nowrap;
		max-width: calc(100% - 20px);
	}
	.tool-divider {
		height: 17px;
		width: 1px;
		background: var(--line-bright);
		margin: 0 3px;
	}
	.popover-anchor {
		display: flex;
	}
	:global(.motion-popover) {
		position: fixed;
		z-index: 50;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		max-height: calc(100dvh - 24px);
		overflow: auto;
	}
	.floating-toolbar :global(.webmcp-trigger) {
		position: relative;
	}
	.floating-toolbar :global(.webmcp-trigger i) {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--warning);
		position: absolute;
		right: 4px;
		bottom: 4px;
	}
	.floating-toolbar :global(.webmcp-trigger i.connected) {
		background: var(--acid);
	}
	:global(.motion-popover) {
		background: var(--panel-raised) !important;
		color: var(--muted-foreground) !important;
		border: 1px solid var(--line-bright) !important;
		border-radius: 9px !important;
		box-shadow: 0 10px 35px #0007 !important;
		font-family: var(--sans);
		color-scheme: dark;
	}
	:global(.motion-popover .popover-heading) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--type-control);
		color: var(--paper);
	}
	:global(.motion-popover .popover-text) {
		font-size: var(--type-label);
		line-height: 1.7;
		color: var(--muted-foreground);
		margin: 0;
	}
	:global(.motion-popover.webmcp-popover) {
		width: min(390px, calc(100vw - 24px));
		gap: 9px;
		padding: 12px;
	}
	.webmcp-status {
		margin: 0;
		color: var(--acid);
		font:
			10px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
	:global(.motion-popover.export-menu) {
		width: min(328px, calc(100vw - 24px));
		gap: 4px;
		padding: 12px;
	}
	:global(.export-menu button) {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		font-size: var(--type-label);
		justify-content: flex-start;
		border-radius: 5px;
		color: var(--muted-foreground);
	}
	:global(.export-menu small) {
		font-size: var(--type-meta);
		line-height: 1.6;
		color: var(--muted-foreground);
		margin-top: 8px;
		overflow-wrap: anywhere;
	}
	:global(.motion-popover),
	:global(.motion-popover *) {
		scrollbar-width: thin;
		scrollbar-color: var(--line-bright) var(--ink);
	}
	:global(.motion-popover ::-webkit-scrollbar) {
		width: 8px;
		height: 8px;
	}
	:global(.motion-popover ::-webkit-scrollbar-track) {
		background: var(--ink);
	}
	:global(.motion-popover ::-webkit-scrollbar-thumb) {
		background: var(--line-bright);
		border-radius: 8px;
		border: 2px solid var(--ink);
	}
	@media (max-width: 1000px) {
		.floating-toolbar {
			gap: 0;
			padding: 4px;
		}
		.tool-divider {
			margin: 0 1px;
		}
		.floating-toolbar :global(.editor-icon) {
			width: 27px !important;
			min-width: 27px;
		}
	}
	@media (max-width: 767px) {
		.floating-toolbar {
			top: 50px;
			max-width: calc(100% - 8px);
			overflow-x: auto;
		}
	}
</style>
