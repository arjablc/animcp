<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import ConfigControls from "$lib/components/ConfigControls.svelte";
  import SketchRuntime from "$lib/components/SketchRuntime.svelte";
  import SourceEditor from "$lib/components/SourceEditor.svelte";
  import { createEditorCommands, type EditorCommands, type SketchRuntimeHandle } from "$lib/commands";
  import { lottieBlob } from "$lib/lottie";
  import { exportFrameRates, type ExportSettings, type P5Project } from "$lib/project";
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
  let exportDialog = $state<HTMLDialogElement>();
  let exporting = $state(false);
  let exportProgress = $state(0);
  let exportError = $state("");
  let nativeLottieSupported = $state(false);

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
      try { await commands.load(); runtimeStatus = "running"; nativeLottieSupported = commands.supportsNativeLottie(); }
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
    try { await commands.replaceSource(draft); runtimeStatus = "running"; nativeLottieSupported = commands.supportsNativeLottie(); }
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
      download(blob, `${filename()}.png`);
    } catch (cause) { report(cause); }
  }

  function updateExportSettings(changes: Partial<ExportSettings>) {
    if (!project) return;
    exportError = "";
    try { commands.updateExportSettings({ ...project.exportSettings, ...changes }); }
    catch (cause) { exportError = cause instanceof Error ? cause.message : "Invalid export settings."; }
  }

  async function exportLottie() {
    exporting = true;
    exportProgress = 0;
    exportError = "";
    try {
      const document = await commands.exportLottie((progress) => exportProgress = progress);
      download(lottieBlob(document), `${filename()}.json`);
      exportDialog?.close();
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : "Lottie export failed.";
    } finally {
      exporting = false;
    }
  }

  function filename() {
    return project?.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "sketch";
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url));
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
        <button class="export png-export" onclick={exportPng}>Export PNG</button>
        <button class="export" onclick={() => exportDialog?.showModal()}>Export Lottie</button>
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

  <dialog class="export-dialog" bind:this={exportDialog} oncancel={(event) => { if (exporting) event.preventDefault(); }} onclose={() => exportError = ""}>
    <form method="dialog" class="dialog-head">
      <div><small>Animation export</small><h2>Lottie JSON</h2></div>
      <button aria-label="Close export dialog" disabled={exporting}>×</button>
    </form>
    <div class="export-fields">
      <label>
        <span>Renderer</span>
        <select value={project.exportSettings.lottieMode} onchange={(event) => updateExportSettings({ lottieMode: event.currentTarget.value as ExportSettings["lottieMode"] })} disabled={exporting}>
          <option value="vector">Vector Lottie</option>
          <option value="raster">Raster fallback</option>
        </select>
      </label>
      <label>
        <span>Duration</span>
        <span class="unit-input"><input type="number" min="1" max="10" step="0.5" value={project.exportSettings.durationSeconds} onchange={(event) => updateExportSettings({ durationSeconds: Number(event.currentTarget.value) })} disabled={exporting} /><small>seconds</small></span>
      </label>
      <label>
        <span>Frame rate</span>
        <select value={project.exportSettings.frameRate} onchange={(event) => updateExportSettings({ frameRate: Number(event.currentTarget.value) as ExportSettings["frameRate"] })} disabled={exporting}>
          {#each exportFrameRates as rate}<option value={rate}>{rate} FPS</option>{/each}
        </select>
      </label>
    </div>
    <div class="export-summary">
      <strong>{Math.round(project.exportSettings.durationSeconds * project.exportSettings.frameRate)} frames</strong>
      {#if project.exportSettings.lottieMode === "vector"}
        <p class:warning={!nativeLottieSupported}>{nativeLottieSupported ? "Native vector output supplied by this sketch." : "This sketch has no vector exporter. Choose Raster fallback or ask the agent to add window.exportLottie."}</p>
      {:else}
        <p class="warning">Raster Lottie embeds one PNG per frame. It is large, not vector-editable, and is most reliable for frameCount-driven sketches.</p>
      {/if}
    </div>
    {#if exporting && project.exportSettings.lottieMode === "raster"}
      <div class="export-progress"><progress value={exportProgress} max="1"></progress><span>{Math.round(exportProgress * 100)}%</span></div>
    {/if}
    {#if exportError}<p class="export-error" role="alert">{exportError}</p>{/if}
    <div class="dialog-actions">
      <button onclick={() => exportDialog?.close()} disabled={exporting}>Cancel</button>
      <button class="primary" onclick={exportLottie} disabled={exporting || !!exportError || (project.exportSettings.lottieMode === "vector" && !nativeLottieSupported)}>{exporting ? "Exporting…" : "Download .json"}</button>
    </div>
  </dialog>
{/if}
