<script lang="ts">
	import { Move, Square, Circle, Type, Import, Undo2, Redo2, Bot, Download, FolderPlus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import type { Layer } from '../model';
	import type { MotionSession } from '../session.svelte';
	import type { ExportFormat } from '../project-files';
	import { createMotionTools } from '../webmcp';
	import WebMcpToolCatalog from './WebMcpToolCatalog.svelte';

	let {
		session,
		busy,
		onCreate,
		onGroup,
		onImport,
		onExport,
		onUndo,
		onRedo
	}: {
		session: MotionSession;
		busy: boolean;
		onCreate: (type: Layer['type']) => void;
		onGroup: () => void;
		onImport: () => void;
		onExport: (format: ExportFormat) => void;
		onUndo: () => void;
		onRedo: () => void;
	} = $props();

	const webmcpTools = $derived(createMotionTools(session));
</script>

<div class="floating-toolbar" role="toolbar" aria-label="Drawing tools">
	<Button
		variant="ghost"
		size="icon-sm"
		class="editor-icon tool-active"
		aria-label="Move tool"
		title="Move / select · drag layers on canvas"
		onclick={() => session.select(session.context.selectedLayerIds)}><Move /></Button
	>
	<span class="tool-divider"></span>
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
	<Popover.Root>
		<Popover.Trigger
			class="editor-icon webmcp-trigger"
			aria-label="WebMCP"
			title="WebMCP agent connection"
		>
			<Bot size={17} />
			<i class:connected={session.webmcp.includes('registered') || session.webmcp.includes('ready')}
			></i>
		</Popover.Trigger>
		<Popover.Content class="motion-popover webmcp-popover" sideOffset={12}>
			<p class="webmcp-status">{session.webmcp}</p>
			<WebMcpToolCatalog tools={webmcpTools} />
		</Popover.Content>
	</Popover.Root>
	<Popover.Root>
		<Popover.Trigger class="editor-icon" aria-label="Export" title="Export">
			<Download size={16} />
		</Popover.Trigger>
		<Popover.Content class="motion-popover export-menu" align="end" sideOffset={12}>
			<div class="popover-heading">Export composition</div>
			<Button variant="ghost" disabled={busy} onclick={() => onExport('native')}>
				Native project · all assets
			</Button>
			<Button variant="ghost" disabled={busy} onclick={() => onExport('svg')}>
				Current frame · SVG
			</Button>
			<Button variant="ghost" disabled={busy} onclick={() => onExport('lottie')}>
				Lottie animation
			</Button>
			<small>
				Text and SVG are rasterized in Lottie. Native projects preserve all editable properties.
			</small>
		</Popover.Content>
	</Popover.Root>
</div>

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
		background: #1b2d46f2;
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
	.floating-toolbar :global(.webmcp-trigger) {
		position: relative;
	}
	.floating-toolbar :global(.webmcp-trigger i) {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #d7bb6e;
		position: absolute;
		right: 4px;
		bottom: 4px;
	}
	.floating-toolbar :global(.webmcp-trigger i.connected) {
		background: var(--acid);
	}
	:global(.motion-popover) {
		background: #202833 !important;
		color: #c4d0df !important;
		border: 1px solid #3a4758 !important;
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
		color: #93a8c1;
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
		gap: 4px;
	}
	:global(.export-menu button) {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		font-size: var(--type-label);
		justify-content: flex-start;
		border-radius: 5px;
		color: #b6c8dd;
	}
	:global(.export-menu small) {
		font-size: var(--type-meta);
		line-height: 1.6;
		color: #8197b2;
		margin-top: 8px;
	}
	:global(.motion-popover),
	:global(.motion-popover *) {
		scrollbar-width: thin;
		scrollbar-color: #465365 #181e27;
	}
	:global(.motion-popover ::-webkit-scrollbar) {
		width: 8px;
		height: 8px;
	}
	:global(.motion-popover ::-webkit-scrollbar-track) {
		background: #181e27;
	}
	:global(.motion-popover ::-webkit-scrollbar-thumb) {
		background: #465365;
		border-radius: 8px;
		border: 2px solid #181e27;
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
