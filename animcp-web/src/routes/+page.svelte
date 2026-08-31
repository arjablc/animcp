<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import ProjectCard from '$lib/features/projects/ProjectCard.svelte';
	import { createProject, type P5Project } from '$lib/features/projects/project';
	import { deleteProject, getProjects, saveProject } from '$lib/features/projects/storage';
	import heroImage from '$lib/assets/studio.png';

	let projects = $state<P5Project[]>([]);

	onMount(() => {
		projects = getProjects();
	});

	function create() {
		const project = createProject();
		saveProject(project);
		void goto(`/projects/${project.id}`);
	}

	function remove(project: P5Project) {
		if (!confirm(`Delete “${project.name}”?`)) return;
		deleteProject(project.id);
		projects = getProjects();
	}
</script>

<svelte:head
	><title>aniMCP</title><meta
		name="description"
		content="A human and agent p5.js editor powered by WebMCP."
	/></svelte:head
>

<main class="projects-page">
	<header class="projects-hero">
		<div>
			<a class="brand" href="/"><span>ANIMCP</span></a>
			<p class="eyebrow">Human-directed generative motion</p>
			<h1>Make the code move</h1>
			<p class="intro">
				A webMCP based experience to create <span class="text-primary">MOTION</span>
			</p>
			<Button class="new-project mt-4" onclick={create}><span>+</span> New sketch</Button>
		</div>
		<div class="flex flex-col items-center gap-4">
			<img class="border-accent rounded-xl border-2" src={heroImage} alt="Hero" />
		</div>
	</header>
	<section class="project-section" aria-labelledby="projects-title">
		<div class="section-title">
			<h2 id="projects-title">Local sketches</h2>
			<span>{projects.length.toString().padStart(2, '0')}</span>
		</div>
		{#if projects.length === 0}
			<Button variant="outline" class="empty-project" onclick={create}>
				<strong>Your canvas is waiting.</strong>
				<span>Create a sketch to open the live code, canvas, and control surface.</span>
			</Button>
		{:else}
			<div class="project-grid">
				{#each projects as project (project.id)}
					<ProjectCard {project} ondelete={() => remove(project)} />
				{/each}
			</div>
		{/if}
	</section>
</main>
