<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import * as NativeSelect from "$lib/components/ui/native-select";
  import { Progress } from "$lib/components/ui/progress";
  import type { EditorCommands } from "$lib/features/editor/commands";
  import { lottieBlob } from "./lottie";
  import { exportFrameRates, type ExportSettings, type P5Project } from "$lib/features/projects/project";

  let { open = $bindable(false), project, commands, nativeLottieSupported, ondownload } = $props<{
    open: boolean;
    project: P5Project;
    commands: EditorCommands;
    nativeLottieSupported: boolean;
    ondownload: (blob: Blob) => void;
  }>();

  let exporting = $state(false);
  let progress = $state(0);
  let error = $state("");

  function updateSettings(changes: Partial<ExportSettings>) {
    error = "";
    try { commands.updateExportSettings({ ...project.exportSettings, ...changes }); }
    catch (cause) { error = message(cause, "Invalid export settings."); }
  }

  async function exportLottie() {
    exporting = true;
    progress = 0;
    error = "";
    try {
      const document = await commands.exportLottie((value: number) => progress = value);
      ondownload(lottieBlob(document));
      open = false;
    } catch (cause) {
      error = message(cause, "Lottie export failed.");
    } finally {
      exporting = false;
    }
  }

  function message(cause: unknown, fallback: string) {
    return cause instanceof Error ? cause.message : fallback;
  }
</script>

<Dialog.Root bind:open onOpenChange={(next) => { if (!next && exporting) open = true; else if (!next) error = ""; }}>
  <Dialog.Content class="export-dialog" showCloseButton={!exporting}>
    <Dialog.Header class="dialog-head">
      <small>Animation export</small>
      <Dialog.Title>Lottie JSON</Dialog.Title>
      <Dialog.Description class="sr-only">Configure and download the current sketch as Lottie JSON.</Dialog.Description>
    </Dialog.Header>

    <div class="export-fields">
      <label>
        <span>Renderer</span>
        <NativeSelect.Root value={project.exportSettings.lottieMode} onchange={(event) => updateSettings({ lottieMode: event.currentTarget.value as ExportSettings["lottieMode"] })} disabled={exporting}>
          <option value="vector">Vector Lottie</option>
          <option value="raster">Raster fallback</option>
        </NativeSelect.Root>
      </label>
      <label>
        <span>Duration</span>
        <span class="unit-input"><Input type="number" min="1" max="10" step="0.5" value={project.exportSettings.durationSeconds} onchange={(event) => updateSettings({ durationSeconds: Number(event.currentTarget.value) })} disabled={exporting} /><small>seconds</small></span>
      </label>
      <label>
        <span>Frame rate</span>
        <NativeSelect.Root value={project.exportSettings.frameRate} onchange={(event) => updateSettings({ frameRate: Number(event.currentTarget.value) as ExportSettings["frameRate"] })} disabled={exporting}>
          {#each exportFrameRates as rate}<option value={rate}>{rate} FPS</option>{/each}
        </NativeSelect.Root>
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
      <div class="export-progress"><Progress value={progress} max={1} /><span>{Math.round(progress * 100)}%</span></div>
    {/if}
    {#if error}<p class="export-error" role="alert">{error}</p>{/if}

    <Dialog.Footer class="dialog-actions">
      <Button variant="outline" onclick={() => open = false} disabled={exporting}>Cancel</Button>
      <Button onclick={exportLottie} disabled={exporting || !!error || (project.exportSettings.lottieMode === "vector" && !nativeLottieSupported)}>{exporting ? "Exporting..." : "Download .json"}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
