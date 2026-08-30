<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { createProject, type P5Project } from "$lib/project";
  import { deleteProject, getProjects, saveProject } from "$lib/storage";

  let projects = $state<P5Project[]>([]);

  onMount(() => { projects = getProjects(); });

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

<svelte:head><title>p5 Studio · AniMCP</title><meta name="description" content="A human and agent p5.js editor powered by WebMCP." /></svelte:head>

<main class="projects-page">
  <header class="projects-hero">
    <div>
      <a class="brand" href="/"><span>ANIMCP</span> / P5 STUDIO</a>
      <p class="eyebrow">Human-directed generative motion</p>
      <h1>Make the code<br /><em>move.</em></h1>
      <p class="intro">Build p5.js sketches with an external agent, then art-direct every exposed value in real time.</p>
    </div>
    <button class="new-project" onclick={create}><span>+</span> New sketch</button>
  </header>

  <section class="project-section" aria-labelledby="projects-title">
    <div class="section-title"><h2 id="projects-title">Local sketches</h2><span>{projects.length.toString().padStart(2, "0")}</span></div>
    {#if projects.length === 0}
      <button class="empty-project" onclick={create}>
        <strong>Your canvas is waiting.</strong>
        <span>Create a sketch to open the live code, canvas, and control surface.</span>
      </button>
    {:else}
      <div class="project-grid">
        {#each projects as project}
          <article class="project-card">
            <a href={`/projects/${project.id}`}>
              <div class="project-preview"><span>{project.name.slice(0, 2).toUpperCase()}</span></div>
              <h3>{project.name}</h3>
              <p>Revision {project.revision} · {new Date(project.updatedAt).toLocaleDateString()}</p>
            </a>
            <button class="delete" aria-label={`Delete ${project.name}`} onclick={() => remove(project)}>Delete</button>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</main>
