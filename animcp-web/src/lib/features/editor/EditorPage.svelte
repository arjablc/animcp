<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import ConfigControls from '$lib/features/config/ConfigControls.svelte';
	import LottieExportDialog from '$lib/features/export/LottieExportDialog.svelte';
	import type { P5Project } from '$lib/features/projects/project';
	import { getProject, saveProject } from '$lib/features/projects/storage';
	import SketchRuntime from '$lib/features/runtime/SketchRuntime.svelte';
	import { createEditorCommands, type SketchRuntimeHandle } from './commands';
	import SourceEditor from './SourceEditor.svelte';
	import { registerP5Tools } from './webmcp';

	let { data } = $props<{ data: { id: string } }>();
	// `$state` is Svelte 5's reactive state: assigning these values updates the template.
	let project = $state<P5Project>();
	let draft = $state('');
	let runtime = $state<SketchRuntimeHandle>();
	let runtimeStatus = $state('starting');
	let error = $state('');
	let webmcp = $state('checking');
	let backendVersion = $state('offline');
	let mobileTab = $state<'source' | 'preview' | 'controls'>('preview');
	let applying = $state(false);
	let exportDialogOpen = $state(false);
	let nativeLottieSupported = $state(false);

	// UI and WebMCP actions share this command boundary, so persistence and validation stay consistent.
	const commands = createEditorCommands({
		getProject: () => {
			if (!project) throw new Error('Project is not loaded.');
			return project;
		},
		setProject: (next) => {
			saveProject(next);
			if (!project || next.source !== project.source) draft = next.source;
			project = next;
		},
		runtime: () => {
			if (!runtime) throw new Error('Sketch runtime is not ready.');
			return runtime;
		}
	});

	onMount(() => {
		const controller = new AbortController();
		const found = getProject(data.id);
		if (!found) {
			void goto('/');
			return;
		}
		project = found;
		draft = found.source;
		void tick().then(async () => {
			try {
				await commands.load();
				nativeLottieSupported = commands.supportsNativeLottie();
			} catch (cause) {
				report(cause);
			}
			const result = await registerP5Tools(
				{ getProject: () => project!, getRuntimeStatus: () => runtimeStatus, commands },
				controller.signal
			);
			webmcp = result.message;
		});
		void fetch('/api/v1/version')
			.then((response) => (response.ok ? response.json() : Promise.reject()))
			.then((value) => {
				backendVersion =
					typeof value === 'object' &&
					value !== null &&
					'version' in value &&
					typeof value.version === 'string'
						? value.version
						: 'unknown';
			})
			.catch(() => {});
		return () => controller.abort();
	});

	async function applySource() {
		applying = true;
		error = '';
		try {
			await commands.replaceSource(draft);
			nativeLottieSupported = commands.supportsNativeLottie();
		} catch (cause) {
			report(cause);
		} finally {
			applying = false;
		}
	}

	function updateConfig(path: string[], value: unknown) {
		try {
			commands.patchConfig([{ path, value }]);
			error = '';
		} catch (cause) {
			report(cause);
		}
	}

	function rename(event: Event) {
		if (!project) return;
		const name = (event.currentTarget as HTMLInputElement).value.trim() || 'Untitled sketch';
		project = { ...project, name, updatedAt: new Date().toISOString() };
		saveProject(project);
	}

	async function exportPng() {
		try {
			const blob = await commands.capture();
			download(blob, `${filename()}.png`);
		} catch (cause) {
			report(cause);
		}
	}

	function filename() {
		return (
			project?.name
				.replace(/[^a-z0-9]+/gi, '-')
				.replace(/^-|-$/g, '')
				.toLowerCase() || 'sketch'
		);
	}

	function download(blob: Blob, name: string) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url));
	}

	function report(cause: unknown) {
		error = cause instanceof Error ? cause.message : 'The sketch failed.';
		runtimeStatus = 'error';
	}
</script>

<svelte:head><title>{project?.name ?? 'P5 Studio'} · AniMCP</title></svelte:head>

{#if project}
	<main class="editor-page">
		<header class="editor-bar">
			<a class="brand compact" href="/"><span>ANIMCP</span> / P5</a>
			<Input
				class="project-name"
				aria-label="Project name"
				value={project.name}
				onchange={rename}
			/>
			<div class="editor-actions">
				<Badge
					variant={runtimeStatus === 'error' ? 'destructive' : 'secondary'}
					class={`runtime-pill${runtimeStatus === 'error' ? ' bad' : ''}`}>{runtimeStatus}</Badge
				>
				<Button
					variant="outline"
					size="sm"
					onclick={() => commands.control(runtimeStatus === 'paused' ? 'play' : 'pause')}
					>{runtimeStatus === 'paused' ? 'Play' : 'Pause'}</Button
				>
				<Button variant="outline" size="sm" onclick={() => commands.control('restart')}
					>Restart</Button
				>
				<Button variant="outline" size="sm" class="export png-export" onclick={exportPng}
					>Export PNG</Button
				>
				<Button variant="outline" size="sm" class="export" onclick={() => (exportDialogOpen = true)}
					>Export Lottie</Button
				>
			</div>
		</header>

		<Tabs.Root bind:value={mobileTab} class="mobile-tabs-root">
			<Tabs.List class="mobile-tabs" aria-label="Editor panels">
				{#each ['source', 'preview', 'controls'] as tab (tab)}
					<Tabs.Trigger value={tab}>{tab}</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>

		<section class="editor-grid">
			<div class:mobile-active={mobileTab === 'source'} class="panel source-panel">
				<SourceEditor bind:value={draft} dirty={draft !== project.source} onapply={applySource} />
				{#if applying}<div class="panel-status">Validating in sandbox…</div>{/if}
			</div>
			<div class:mobile-active={mobileTab === 'preview'} class="panel preview-panel">
				<div class="canvas-wrap">
					<SketchRuntime
						bind:this={runtime}
						onstatus={(status) => (runtimeStatus = status)}
						onerror={(message) => (error = message)}
					/>
				</div>
				<footer class="preview-footer">
					<span>REV {project.revision.toString().padStart(3, '0')}</span>
					<span>WEBMCP · {webmcp}</span>
					<span>GO · {backendVersion}</span>
				</footer>
				{#if error}
					<Alert variant="destructive" class="error">
						<AlertTitle>Runtime</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Dismiss error"
							onclick={() => (error = '')}>×</Button
						>
					</Alert>
				{/if}
			</div>
			<aside class:mobile-active={mobileTab === 'controls'} class="panel controls-panel">
				<div class="controls-head"><span>Art direction</span><small>Live config</small></div>
				<ConfigControls schema={project.schema} config={project.config} onchange={updateConfig} />
			</aside>
		</section>
	</main>

	<LottieExportDialog
		bind:open={exportDialogOpen}
		{project}
		{commands}
		{nativeLottieSupported}
		ondownload={(blob) => download(blob, `${filename()}.json`)}
	/>
{/if}
