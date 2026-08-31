<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Plus, ArrowUpRight, Upload, Trash2, ArrowRight } from '@lucide/svelte';
	import { createAnimationProject, type AnimationProject } from '../animation/model';
	import { createDemoProject } from '../animation/demo';
	import { keepDraft } from '../animation/drafts';
	import {
		listProjects,
		saveProject,
		deleteProject,
		type ProjectSummary
	} from '../persistence/vector-storage';
	import { importProject } from '../export/vector';
	let projects = $state<ProjectSummary[]>([]);
	let error = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let picker: HTMLInputElement;
	onMount(() => {
		void refresh();
	});
	async function refresh() {
		try {
			projects = await listProjects();
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Local storage unavailable.';
		} finally {
			loading = false;
		}
	}
	async function open(project: AnimationProject) {
		busy = true;
		try {
			await saveProject(project);
		} catch {
			keepDraft(project);
		}
		await goto(`/projects/${project.id}`);
		busy = false;
	}
	async function imported(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			if (file.size > 20 * 1024 * 1024) throw new Error('Projects are limited to 20 MiB.');
			const project = importProject(await file.text());
			project.id = `project_${crypto.randomUUID()}`;
			project.name = `${project.name.slice(0, 185)} (imported)`;
			project.revision = 0;
			project.createdAt = project.updatedAt = new Date().toISOString();
			await open(project);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Project import failed.';
		} finally {
			picker.value = '';
		}
	}
	async function remove(project: ProjectSummary) {
		if (
			!confirm(
				`Delete “${project.name}” and its local assets? This cannot be undone. Export a copy first if needed.`
			)
		)
			return;
		try {
			await deleteProject(project.id);
			await refresh();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Delete failed.';
		}
	}
</script>

<svelte:head
	><title>AniMCP — Vector motion, made together</title><meta
		name="description"
		content="Draw, keyframe, and animate together with your agent. A local-first vector animation studio."
	/></svelte:head
>

<main class="library">
	<nav>
		<a href="/" class="wordmark">ani<span>MCP</span><i>VECTOR STUDIO</i></a><a
			href="/legacy"
			class="legacy-link">Legacy p5 sketches <ArrowUpRight size={14} /></a
		>
	</nav>
	<section class="hero">
		<div>
			<div class="eyebrow">● &nbsp; HUMAN HAND. AGENT ASSIST.</div>
			<h1>A little line.<br />A lot of <em>motion.</em></h1>
			<p>
				A canvas for your ideas. A timeline to bring them to life.<br />Create together with your
				agent, right here in the browser.
			</p>
			<div class="hero-actions">
				<button class="primary" disabled={busy} onclick={() => open(createAnimationProject())}
					><Plus size={17} /> New animation</button
				><button class="secondary" disabled={busy} onclick={() => open(createDemoProject())}
					>Explore an example <ArrowRight size={16} /></button
				>
			</div>
			<small>No account. No API key. Your work stays on this device.</small>
		</div>
		<div class="hero-art">
			<div class="art-title"><span>THE FIRST STROKE</span><span>00:02 / 00:03</span></div>
			<svg
				viewBox="0 0 470 255"
				role="img"
				aria-label="A sweeping lime curve with editable vector points"
				><path class="ghost" d="M40 166 C130 78 177 70 235 147 S371 197 429 87" /><path
					class="motion"
					d="M40 166 C157 223 141 43 235 90 S331 246 429 87"
				/><path
					class="handle"
					d="M40 166 L157 223 M235 90 L141 43 M235 90 L331 246 M429 87 L429 25"
				/>{#each [[40, 166], [235, 90], [429, 87]] as [x, y]}<circle
						cx={x}
						cy={y}
						r="5"
					/>{/each}</svg
			>
			<div class="art-timeline">
				<span>0</span><i></i><b>◆</b><i></i><b>◆</b><i></i><span>90</span>
			</div>
		</div>
	</section>
	<section class="project-library" aria-labelledby="local-title">
		<div class="section-heading">
			<div>
				<h2 id="local-title">Your animations <span>{projects.length}</span></h2>
				<p>Saved locally. Always yours.</p>
			</div>
			<button class="secondary" onclick={() => picker.click()}
				><Upload size={15} /> Import project</button
			><input
				type="file"
				accept=".json,.animcp.json,application/json"
				bind:this={picker}
				onchange={imported}
				hidden
			/>
		</div>
		{#if error}<div role="alert" class="library-error">
				{error} <button onclick={refresh}>Retry storage</button> You can still start an unsaved animation
				and export a backup.
			</div>{/if}
		{#if loading}<p>Loading local projects…</p>{:else}<div class="project-cards">
				<button class="create-card" onclick={() => open(createAnimationProject())} disabled={busy}
					><Plus size={28} /><strong>Start with a blank canvas</strong><span
						>Make your first move.</span
					></button
				>
				{#each projects as project (project.id)}<article class="animation-card">
						<a href={`/projects/${project.id}`}
							><div class="card-preview" style:background={project.canvas.background}>
								<span>{project.layerCount.toString().padStart(2, '0')}</span><small
									>VECTOR LAYERS</small
								><ArrowUpRight size={22} />
							</div>
							<div class="card-meta">
								<strong>{project.name}</strong><span
									>{project.canvas.width} × {project.canvas.height} · {project.timeline.fps} fps · {(
										project.timeline.frameCount / project.timeline.fps
									).toFixed(1)}s</span
								>
							</div></a
						><button
							class="delete-card"
							aria-label={`Delete ${project.name}`}
							onclick={() => remove(project)}><Trash2 size={15} /></button
						>
					</article>{/each}
			</div>{/if}
	</section>
	<footer>
		ANIMCP <span>Built for the space between an idea and a moving image.</span><span
			>LOCAL-FIRST / WEBMCP-READY</span
		>
	</footer>
</main>

<style>
	.library {
		min-height: 100vh;
		background: #10161b;
		color: #edf2f3;
		padding: 0 max(24px, calc((100vw - 1220px) / 2));
	}
	nav {
		height: 90px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid #273137;
	}
	.wordmark {
		font-size: 23px;
		font-weight: 800;
		letter-spacing: -1.5px;
		text-decoration: none;
	}
	.wordmark span {
		color: #dfff4f;
	}
	.wordmark i {
		font: 9px var(--mono);
		font-style: normal;
		letter-spacing: 1.5px;
		margin-left: 22px;
		color: #87979f;
	}
	.legacy-link {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 11px;
		color: #95a4ad;
		text-decoration: none;
	}
	.hero {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		gap: 50px;
		align-items: center;
		padding: 80px 0;
	}
	.eyebrow {
		font: 10px var(--mono);
		color: #a5b1b8;
		letter-spacing: 1px;
	}
	h1 {
		font-size: clamp(38px, 5vw, 64px);
		letter-spacing: -3px;
		font-weight: 800;
		line-height: 1.08;
		margin: 23px 0;
	}
	h1 em {
		color: #dfff4f;
		font-style: normal;
	}
	.hero p {
		color: #99a8b0;
		font-size: 13px;
		line-height: 1.8;
	}
	.hero-actions {
		display: flex;
		gap: 12px;
		margin-top: 28px;
		flex-wrap: wrap;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: 6px;
		font-size: 12px;
		padding: 10px 14px;
	}
	.primary {
		background: #dfff4f;
		color: #132007;
		font-weight: 700;
		border: 1px solid #dfff4f;
	}
	.secondary {
		background: #1b252c;
		color: #d4dde2;
		border: 1px solid #344148;
	}
	button:hover {
		filter: brightness(1.12);
	}
	button:disabled {
		opacity: 0.5;
	}
	small {
		display: block;
		color: #6f818c;
		font-size: 10px;
		margin-top: 16px;
	}
	.hero-art {
		border: 1px solid #34424b;
		background: #172028;
		border-radius: 12px;
		padding: 20px;
		transform: rotate(-2deg);
		box-shadow: 0 24px 60px #0005;
	}
	.art-title {
		display: flex;
		justify-content: space-between;
		font: 9px var(--mono);
		color: #a0b1b9;
		letter-spacing: 1px;
	}
	svg {
		width: 100%;
		overflow: visible;
	}
	svg path {
		fill: none;
	}
	.ghost {
		stroke: #42535a;
		stroke-width: 3;
		stroke-dasharray: 4 6;
	}
	.motion {
		stroke: #dfff4f;
		stroke-width: 5;
		stroke-linecap: round;
	}
	.handle {
		stroke: #8299a3;
		stroke-width: 1;
	}
	circle {
		fill: #172028;
		stroke: #dfff4f;
		stroke-width: 2;
	}
	.art-timeline {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 12px 4px 0;
		border-top: 1px solid #33414a;
		color: #b4c0c5;
		font: 10px var(--mono);
	}
	.art-timeline i {
		flex: 1;
		height: 1px;
		background: #45565f;
	}
	.art-timeline b {
		color: #dfff4f;
	}
	.project-library {
		padding: 25px 0 70px;
		border-top: 1px solid #273137;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 25px;
	}
	h2 {
		font-size: 17px;
		font-weight: 600;
		margin: 0;
	}
	h2 span {
		margin-left: 9px;
		font: 11px var(--mono);
		color: #94a5ae;
		border: 1px solid #34434b;
		border-radius: 4px;
		padding: 2px 5px;
	}
	.section-heading p {
		color: #8497a1;
		font-size: 11px;
		margin-top: 7px;
	}
	.project-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 20px;
	}
	.create-card {
		border: 1px dashed #465660;
		background: #141d24;
		min-height: 214px;
		flex-direction: column;
		color: #dfff4f;
	}
	.create-card strong {
		color: #cbd5db;
		font-size: 12px;
		margin-top: 10px;
	}
	.create-card span {
		color: #8497a1;
		font-size: 11px;
	}
	.animation-card {
		border: 1px solid #34414a;
		border-radius: 7px;
		overflow: hidden;
		position: relative;
	}
	.animation-card a {
		text-decoration: none;
		display: block;
	}
	.card-preview {
		height: 146px;
		position: relative;
		padding: 24px;
	}
	.card-preview > span {
		font: 40px var(--mono);
		color: #dfff4f;
	}
	.card-preview small {
		margin-top: 6px;
		font: 9px var(--mono);
		letter-spacing: 2px;
		color: #9caeb8;
	}
	.card-preview :global(svg) {
		position: absolute;
		top: 16px;
		right: 16px;
	}
	.card-meta {
		padding: 16px 40px 16px 16px;
		background: #1a242b;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.card-meta strong {
		font-size: 12px;
	}
	.card-meta span {
		font: 9px var(--mono);
		color: #8e9fa8;
	}
	.delete-card {
		position: absolute;
		right: 8px;
		bottom: 16px;
		padding: 6px;
		border: 0;
		background: transparent;
		color: #8d9ba4;
	}
	.library-error {
		padding: 14px;
		background: #482e22;
		color: #ffd4ba;
		font-size: 12px;
		margin-bottom: 18px;
	}
	.library-error button {
		margin: 0 12px;
		border: 1px solid;
	}
	footer {
		padding: 24px 0;
		border-top: 1px solid #273137;
		display: flex;
		justify-content: space-between;
		gap: 20px;
		font: 9px var(--mono);
		color: #647985;
	}
	footer > span:first-child {
		flex: 1;
	}
	@media (max-width: 850px) {
		.hero {
			grid-template-columns: 1fr;
			padding: 42px 0;
		}
		.hero-art {
			max-width: 530px;
		}
		.wordmark i {
			display: none;
		}
		footer > span:first-child {
			display: none;
		}
	}
</style>
