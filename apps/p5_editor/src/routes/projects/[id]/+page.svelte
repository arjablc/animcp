<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import ConfigControls from "$lib/components/ConfigControls.svelte";
  import SketchRuntime from "$lib/components/SketchRuntime.svelte";
  import SourceEditor from "$lib/components/SourceEditor.svelte";
  import { createEditorCommands, type EditorCommands, type SketchRuntimeHandle } from "$lib/commands";
  import type { P5Project } from "$lib/project";
  import { getProject, saveProject } from "$lib/storage";
  import { registerP5Tools } from "$lib/webmcp";

  let { data } = $props<{ data: { id: string } }>();
  let project = $state<P5Project>();
  let draft = $state("");
  let runtime = $state<SketchRuntimeHandle>();
  let commands: EditorCommands;
  let runtimeStatus = $state("starting");
  let error = $state("");
  let webmcp = $state("checking");
  let backendVersion = $state("offline");
  let mobileTab = $state<"source" | "preview" | "controls">("preview");
  let applying = $state(false);

  commands = createEditorCommands({
    getProject: () => {
      if (!project) throw new Error("Project is not loaded.");
      return project;
    },
    setProject: (next) => {
      saveProject(next);
      if (!project || next.source !== project.source) draft = next.source;
      project = next;
    },
    runtime: () => {
      if (!runtime) throw new Error("Sketch runtime is not ready.");
      return runtime;
    },
  });

  onMount(() => {
    const controller = new AbortController();
    const found = getProject(data.id);
    if (!found) { void goto("/"); return; }
    project = found;
    draft = found.source;
    void tick().then(async () => {
      try { await commands.load(); runtimeStatus = "running"; }
      catch (cause) { report(cause); }
      const result = await registerP5Tools({ getProject: () => project!, getRuntimeStatus: () => runtimeStatus, commands }, controller.signal);
      webmcp = result.message;
    });
    void fetch("/api/v1/version").then((response) => response.ok ? response.json() : Promise.reject()).then((value) => { backendVersion = value.version ?? "unknown"; }).catch(() => {});
    return () => controller.abort();
  });

  async function applySource() {
    applying = true;
    error = "";
    try { await commands.replaceSource(draft); runtimeStatus = "running"; }
    catch (cause) { report(cause); }
    finally { applying = false; }
  }

  function updateConfig(path: string[], value: unknown) {
    try { commands.patchConfig([{ path, value }]); error = ""; }
    catch (cause) { report(cause); }
  }

  function rename(event: Event) {
    if (!project) return;
    const name = (event.currentTarget as HTMLInputElement).value.trim() || "Untitled sketch";
    project = { ...project, name, updatedAt: new Date().toISOString() };
    saveProject(project);
  }

  async function exportPng() {
    try {
      const blob = await commands.capture();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project?.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "sketch"}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { report(cause); }
  }

  function report(cause: unknown) {
    error = cause instanceof Error ? cause.message : "The sketch failed.";
    runtimeStatus = "error";
  }
</script>

<svelte:head><title>{project?.name ?? "P5 Studio"} · AniMCP</title></svelte:head>

{#if project}
  <main class="editor-page">
    <header class="editor-bar">
      <a class="brand compact" href="/"><span>ANIMCP</span> / P5</a>
      <input class="project-name" aria-label="Project name" value={project.name} onchange={rename} />
      <div class="editor-actions">
        <span class:bad={runtimeStatus === "error"} class="runtime-pill">{runtimeStatus}</span>
        <button onclick={() => commands.control(runtimeStatus === "paused" ? "play" : "pause")}>{runtimeStatus === "paused" ? "Play" : "Pause"}</button>
        <button onclick={() => commands.control("restart")}>Restart</button>
        <button class="export" onclick={exportPng}>Export PNG</button>
      </div>
    </header>

    <nav class="mobile-tabs" aria-label="Editor panels">
      {#each ["source", "preview", "controls"] as tab}
        <button class:active={mobileTab === tab} onclick={() => mobileTab = tab as typeof mobileTab}>{tab}</button>
      {/each}
    </nav>

    <section class="editor-grid">
      <div class:mobile-active={mobileTab === "source"} class="panel source-panel">
        <SourceEditor bind:value={draft} dirty={draft !== project.source} onapply={applySource} />
        {#if applying}<div class="panel-status">Validating in sandbox…</div>{/if}
      </div>
      <div class:mobile-active={mobileTab === "preview"} class="panel preview-panel">
        <div class="canvas-wrap">
          <SketchRuntime bind:this={runtime} onstatus={(status) => runtimeStatus = status} onerror={(message) => error = message} />
        </div>
        <footer class="preview-footer">
          <span>REV {project.revision.toString().padStart(3, "0")}</span>
          <span>WEBMCP · {webmcp}</span>
          <span>GO · {backendVersion}</span>
        </footer>
        {#if error}<div class="error" role="alert"><strong>Runtime</strong><span>{error}</span><button aria-label="Dismiss error" onclick={() => error = ""}>×</button></div>{/if}
      </div>
      <aside class:mobile-active={mobileTab === "controls"} class="panel controls-panel">
        <div class="controls-head"><span>Art direction</span><small>Live config</small></div>
        <ConfigControls schema={project.schema} config={project.config} onchange={updateConfig} />
      </aside>
    </section>
  </main>
{/if}
