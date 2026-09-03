<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { listMotion, saveMotion, deleteMotion } from '../storage';
	import { importNative } from '../assets';
	import { createProject, uid } from '../model';
	import { migrateVector } from '../migrate';
	import { templates } from '../templates';

	let projects = $state<Awaited<ReturnType<typeof listMotion>>>([]);
	let error = $state('');
	let busy = $state(false);
	let creating = $state(false);
	let name = $state('Untitled motion');
	let width = $state(960);
	let height = $state(540);
	let fps = $state(30);
	let background = $state('#101722');
	let picker: HTMLInputElement;

	async function refresh() {
		try {
			projects = await listMotion();
		} catch (e) {
			error = String(e);
		}
	}
	onMount(() => {
		void refresh();
	});
	async function imported(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = true;
		try {
			if (file.size > 50 * 1024 * 1024) throw new Error('Project exceeds 50 MiB');
			const header = JSON.parse(await file.text());
			const p = header.version === 1 ? migrateVector(header) : await importNative(file);
			p.id = uid();
			p.revision = 0;
			p.updatedAt = new Date().toISOString();
			await saveMotion(p);
			await goto(resolve('/motion/[id]', { id: p.id }));
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
			picker.value = '';
		}
	}
	async function createBlank() {
		busy = true;
		error = '';
		try {
			const p = createProject(name.trim() || 'Untitled motion', {
				width,
				height,
				fps,
				background
			});
			await saveMotion(p);
			await goto(resolve('/motion/[id]', { id: p.id }));
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
	async function remove(id: string, projectName: string) {
		if (!confirm(`Delete “${projectName}” from this device? Export a backup first.`)) return;
		try {
			await deleteMotion(id);
			await refresh();
		} catch (e) {
			error = String(e);
		}
	}
</script>

<svelte:head
	><title>Projects - animcp</title><meta
		name="description"
		content="Create, import, and return to motion compositions stored on this device."
	/></svelte:head
>

<main>
	<nav>
		<a class="brand" href={resolve('/')}>ani<span>MCP</span><small>MOTION STUDIO</small></a><a
			class="back"
			href={resolve('/')}>← Home</a
		>
	</nav>
	<section class="project-actions">
		<button class="primary" onclick={() => (creating = !creating)} aria-expanded={creating}
			>＋ New project</button
		>
	</section>
	{#if creating}
		<section class="create-panel" aria-labelledby="new-project-title">
			<div>
				<h2 id="new-project-title">Set the stage.</h2>
				<p>These settings become the foundation of your new composition.</p>
			</div>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void createBlank();
				}}
			>
				<label class="wide">Project name<input bind:value={name} maxlength="180" /></label>
				<label
					>Canvas width<input
						type="number"
						bind:value={width}
						min="240"
						max="1920"
						step="1"
						required
					/></label
				>
				<label
					>Canvas height<input
						type="number"
						bind:value={height}
						min="240"
						max="1920"
						step="1"
						required
					/></label
				>
				<label
					>Frame rate<select bind:value={fps}
						>{#each [12, 15, 24, 30, 60] as rate (rate)}<option value={rate}>{rate} fps</option
							>{/each}</select
					></label
				>
				<label
					>Canvas color<span class="color-input"
						><input type="color" bind:value={background} /><input
							aria-label="Canvas color hex"
							bind:value={background}
							maxlength="7"
							spellcheck="false"
						/></span
					></label
				>
				<div class="form-actions">
					<span>{width} × {height} · {fps} fps</span><button class="primary" disabled={busy}
						>{busy ? 'Creating…' : 'Create project →'}</button
					>
				</div>
			</form>
		</section>
	{/if}
	<section class="projects">
		<div class="heading">
			<div>
				<h2>Your compositions <span>{projects.length}</span></h2>
			</div>
			<button disabled={busy} onclick={() => picker.click()}>↥ Import .animcp.json</button><input
				bind:this={picker}
				type="file"
				hidden
				accept=".json,.animcp.json"
				onchange={imported}
			/>
		</div>
		{#if error}<p role="alert" class="error">{error}</p>{/if}
		<div class="project-grid">
			{#if projects.length === 0}<button class="new" onclick={() => (creating = true)}
					><span>＋</span>Your first composition starts here</button
				>{/if}
			{#each projects as p (p.id)}<article>
					<a href={resolve('/motion/[id]', { id: p.id })}
						><div class="thumb" style:background={p.composition.background}>
							<b>{String(p.layerCount).padStart(2, '0')}</b><small>MOTION LAYERS</small>
						</div>
						<h3>{p.name}</h3>
						<p>{p.composition.width} × {p.composition.height} · {p.composition.fps} fps</p></a
					><button aria-label={`Delete ${p.name}`} onclick={() => remove(p.id, p.name)}>×</button>
				</article>{/each}
		</div>
	</section>
	<section class="templates" aria-label="Starter templates">
		<div class="heading">
			<div>
				<h2>Templates</h2>
			</div>
		</div>
		<div class="template-grid">
			{#each templates as template (template.id)}<a
					href={resolve('/motion/[id]', { id: `template-${template.id}` })}
					><strong>{template.name} ↗</strong>
					<p>{template.description}</p></a
				>{/each}
		</div>
	</section>
	<footer>
		ANIMCP <span>Keyframes, timing, motion relationships, and revisions.</span><span
			>HUMAN + WEBMCP</span
		>
	</footer>
</main>

<style>
	:global(body) {
		margin: 0;
	}
	main {
		min-height: 100vh;
		background: #0d1522;
		color: var(--paper);
		padding: 0 max(28px, calc((100vw - 1220px) / 2));
		font-family: var(--sans);
		--landing-accent: #8fcad8;
		--landing-line: #31445a;
	}
	.brand {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.04em;
	}
	.brand span {
		color: var(--landing-accent);
	}
	.brand small {
		font: 500 var(--type-meta)/1 var(--mono);
		color: var(--muted);
		letter-spacing: 2px;
		margin-left: 22px;
	}
	nav {
		height: 92px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.back {
		color: var(--muted);
		font-size: 12px;
		transition: color 160ms ease;
	}
	.back:hover {
		color: var(--landing-accent);
	}
	a {
		text-decoration: none;
		color: inherit;
	}
	.project-actions {
		display: flex;
		justify-content: flex-end;
		padding: 32px 0;
	}
	button,
	.primary {
		border-radius: 6px;
		padding: 12px 16px;
		font-size: var(--type-control);
		border: 1px solid var(--landing-line);
		background: transparent;
		color: #c7d3e0;
	}
	.primary {
		background: var(--landing-accent);
		color: var(--acid-ink);
		border-color: var(--landing-accent);
		font-weight: 700;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			background 160ms ease;
	}
	.primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 10px 22px #0005;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.create-panel {
		display: grid;
		grid-template-columns: 0.75fr 1.25fr;
		gap: 54px;
		padding: 38px 0;
	}
	.create-panel h2 {
		font-size: 28px;
		margin: 0 0 10px;
		font-family: var(--display);
		font-weight: 700;
		letter-spacing: -0.03em;
	}
	.create-panel p {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
		line-height: 1.6;
	}
	form {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 16px;
	}
	label {
		display: grid;
		gap: 8px;
		color: #bdcbda;
		font-size: 11px;
		font-weight: 700;
	}
	label.wide,
	.form-actions {
		grid-column: 1/-1;
	}
	input,
	select {
		width: 100%;
		border: 1px solid var(--landing-line);
		border-radius: 6px;
		background: #101b2a;
		color: var(--paper);
		padding: 11px;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease;
	}
	input:focus,
	select:focus {
		border-color: var(--landing-accent);
		box-shadow: 0 0 0 3px #8fcad833;
		outline: none;
	}
	.color-input {
		display: grid;
		grid-template-columns: 44px 1fr;
		gap: 8px;
	}
	.color-input input[type='color'] {
		padding: 3px;
		height: 42px;
	}
	.form-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 6px;
		color: var(--muted);
		font: 11px/1 var(--mono);
	}
	.projects,
	.templates {
		padding: 48px 0 65px;
	}
	.templates {
		padding-top: 8px;
	}
	.heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 24px;
	}
	.heading h2 {
		font-size: 18px;
		margin: 0 0 8px;
		font-family: var(--display);
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.heading h2 span {
		font: 500 var(--type-label)/1 var(--mono);
		color: var(--muted);
		margin-left: 10px;
	}
	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
		gap: 20px;
	}
	.new {
		min-height: 220px;
		border: 1px dashed var(--landing-line);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		font-size: 12px;
		color: var(--paper);
		gap: 20px;
		background: transparent;
		width: 100%;
		transition:
			border-color 160ms ease,
			background 160ms ease;
	}
	.new:hover {
		border-color: var(--landing-accent);
		background: #142238;
	}
	.new > span {
		font-size: 35px;
		color: var(--muted);
	}
	article {
		border: 1px solid var(--landing-line);
		border-radius: 8px;
		overflow: hidden;
		position: relative;
		transition:
			border-color 160ms ease,
			transform 160ms ease,
			background 160ms ease;
	}
	article:hover {
		border-color: #6f9cbd;
		background: #142238;
		transform: translateY(-2px);
	}
	.thumb {
		height: 145px;
		padding: 22px;
		box-sizing: border-box;
	}
	.thumb b {
		font: 500 2.5rem/1 var(--mono);
		color: var(--paper);
	}
	.thumb small {
		display: block;
		font: 500 var(--type-meta)/1 var(--mono);
		color: var(--muted);
		margin-top: 6px;
		letter-spacing: 2px;
	}
	article h3 {
		font-size: 12px;
		margin: 16px 16px 6px;
	}
	article p {
		font: 400 var(--type-meta)/1.4 var(--mono);
		color: var(--muted);
		margin: 0 16px 18px;
	}
	article > button {
		position: absolute;
		right: 9px;
		bottom: 14px;
		border: 0;
		background: transparent;
		padding: 5px;
		color: var(--muted);
		transition: color 160ms ease;
	}
	article > button:hover {
		color: var(--coral);
	}
	.error {
		color: #ffd0ab;
	}
	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 0 28px;
	}
	.template-grid a {
		padding: 18px 0;
		transition: color 160ms ease;
	}
	.template-grid a:hover strong {
		color: var(--landing-accent);
	}
	.template-grid strong {
		font-size: 12px;
		color: var(--paper);
	}
	.template-grid p {
		font-size: var(--type-label);
		color: var(--muted);
		line-height: 1.7;
		margin-top: 10px;
	}
	footer {
		padding: 26px 0;
		display: flex;
		gap: 25px;
		font: 500 var(--type-meta)/1.4 var(--mono);
		color: var(--muted);
	}
	footer span:first-child {
		flex: 1;
	}
	@media (max-width: 850px) {
		.create-panel {
			grid-template-columns: 1fr;
			gap: 34px;
			padding: 56px 0;
		}
		.project-actions {
			padding: 24px 0;
		}
		.brand small {
			display: none;
		}
		form {
			grid-template-columns: 1fr;
		}
		.form-actions {
			grid-column: auto;
		}
		.heading {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
