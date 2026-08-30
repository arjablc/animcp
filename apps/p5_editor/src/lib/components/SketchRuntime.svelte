<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import p5Source from "virtual:p5-runtime";
  import type { PlaybackAction, SketchRuntimeHandle } from "../commands";
  import type { ExportSettings } from "../project";
  import type { ConfigObject, SketchDefinition } from "../schema";

  let { onstatus = (_status: string) => {}, onerror = (_message: string) => {} } = $props<{
    onstatus?: (status: string) => void;
    onerror?: (message: string) => void;
  }>();

  let frame: HTMLIFrameElement;
  let generation = $state(0);
  let instanceId = "";
  let currentSource = "";
  let currentConfig: ConfigObject = {};
  let ready: Deferred<void> | undefined;
  let definition: Deferred<SketchDefinition> | undefined;
  let started: Deferred<void> | undefined;
  let nativeLottieSupported = false;
  let playback: "running" | "paused" = "running";
  let startingPaused = false;
  const requests = new Map<string, Deferred<unknown>>();
  const progressCallbacks = new Map<string, (progress: number) => void>();
  let srcdoc = $derived(runtimeDocument(p5Source, generation));

  function handleMessage(event: MessageEvent) {
    if (event.source !== frame?.contentWindow || !event.data || typeof event.data !== "object") return;
    const message = event.data as Record<string, unknown>;
    if (message.type === "runtime-ready" && message.generation === generation) {
      ready?.resolve();
      return;
    }
    if (message.instanceId !== instanceId) return;
    if (message.type === "definition-loaded") {
      nativeLottieSupported = message.supportsNativeLottie === true;
      definition?.resolve({ config: message.config as ConfigObject, schema: message.schema as SketchDefinition["schema"] });
    } else if (message.type === "sketch-started") {
      onstatus(startingPaused ? "paused" : "running");
      started?.resolve();
    } else if (message.type === "runtime-error") {
      const text = typeof message.message === "string" ? message.message : "The sketch failed.";
      onstatus("error");
      onerror(text);
      definition?.reject(new Error(text));
      started?.reject(new Error(text));
      rejectRequests(new Error(text));
    } else if (message.type === "canvas-captured") {
      resolveRequest(message.requestId, message.blob instanceof Blob ? message.blob : new Error("The runtime returned an invalid canvas image."));
    } else if (message.type === "native-lottie-exported") {
      resolveRequest(message.requestId, message.document);
    } else if (message.type === "raster-lottie-exported") {
      resolveRequest(message.requestId, { frames: message.frames, width: message.width, height: message.height });
    } else if (message.type === "lottie-export-progress" && typeof message.progress === "number") {
      progressCallbacks.get(message.requestId as string)?.(message.progress);
    } else if (message.type === "export-failed") {
      resolveRequest(message.requestId, new Error(typeof message.message === "string" ? message.message : "Lottie export failed."));
    }
  }

  $effect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  onDestroy(() => rejectPending(new Error("Sketch runtime closed.")));

  export async function loadSource(source: string): Promise<SketchDefinition> {
    rejectPending(new Error("Sketch runtime replaced."));
    currentSource = source;
    instanceId = crypto.randomUUID();
    ready = deferred<void>();
    definition = deferred<SketchDefinition>();
    onstatus("loading");
    generation += 1;
    await tick();
    await withTimeout(ready.promise, 5_000, "Sketch sandbox did not start.");
    frame.contentWindow?.postMessage({ type: "load-source", instanceId, source }, "*");
    return withTimeout(definition.promise, 5_000, "Sketch definition did not load.");
  }

  export async function start(config: ConfigObject, paused = false) {
    currentConfig = structuredClone(config);
    startingPaused = paused;
    started = deferred<void>();
    frame.contentWindow?.postMessage({ type: "start-sketch", instanceId, config, paused }, "*");
    await withTimeout(started.promise, 5_000, "Sketch setup did not finish.");
    playback = paused ? "paused" : "running";
  }

  export function applyConfig(config: ConfigObject) {
    currentConfig = structuredClone(config);
    frame.contentWindow?.postMessage({ type: "apply-config", instanceId, config }, "*");
  }

  export function control(action: PlaybackAction) {
    if (action === "restart") {
      void loadSource(currentSource).then(() => start(currentConfig)).catch((error) => onerror(message(error)));
      return;
    }
    frame.contentWindow?.postMessage({ type: "control", instanceId, action }, "*");
    playback = action === "play" ? "running" : "paused";
    onstatus(action === "play" ? "running" : "paused");
  }

  export async function capture() {
    return request<Blob>("capture-canvas", {}, 5_000, "Canvas export timed out.");
  }

  export function supportsNativeLottie() {
    return nativeLottieSupported;
  }

  export function exportNativeLottie(settings: ExportSettings) {
    return request<unknown>("export-native-lottie", { settings }, 10_000, "Vector Lottie export timed out.");
  }

  export async function captureLottieFrames(settings: ExportSettings, onProgress?: (progress: number) => void) {
    const previousPlayback = playback;
    await loadSource(currentSource);
    await start(currentConfig, true);
    try {
      return await request<{ frames: string[]; width: number; height: number }>("capture-lottie-frames", { settings }, 60_000, "Raster Lottie export timed out.", onProgress);
    } finally {
      await loadSource(currentSource);
      await start(currentConfig, previousPlayback === "paused");
    }
  }

  function rejectPending(error: Error) {
    ready?.reject(error);
    definition?.reject(error);
    started?.reject(error);
    rejectRequests(error);
    ready = undefined;
    definition = undefined;
    started = undefined;
  }

  async function request<T>(type: string, payload: Record<string, unknown>, timeout: number, timeoutMessage: string, onProgress?: (progress: number) => void) {
    const requestId = crypto.randomUUID();
    const pending = deferred<unknown>();
    requests.set(requestId, pending);
    if (onProgress) progressCallbacks.set(requestId, onProgress);
    frame.contentWindow?.postMessage({ type, instanceId, requestId, ...payload }, "*");
    try { return await withTimeout(pending.promise, timeout, timeoutMessage) as T; }
    finally { requests.delete(requestId); progressCallbacks.delete(requestId); }
  }

  function resolveRequest(requestId: unknown, value: unknown) {
    if (typeof requestId !== "string") return;
    const pending = requests.get(requestId);
    if (!pending) return;
    if (value instanceof Error) pending.reject(value);
    else pending.resolve(value);
  }

  function rejectRequests(error: Error) {
    for (const pending of requests.values()) pending.reject(error);
    requests.clear();
    progressCallbacks.clear();
  }

  function message(error: unknown) {
    return error instanceof Error ? error.message : "The sketch failed.";
  }
</script>

<iframe
  bind:this={frame}
  title="p5.js sketch preview"
  sandbox="allow-scripts"
  {srcdoc}
></iframe>

<style>
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 260px;
    border: 0;
    background: #0a0b09;
  }
</style>

<script lang="ts" module>
  type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
    promise.catch(() => {});
    return { promise, resolve, reject };
  }

  function withTimeout<T>(promise: Promise<T>, timeout: number, timeoutMessage: string) {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeout);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }

  function runtimeDocument(library: string, generation: number) {
    const safeLibrary = library.replace(/<\/script/gi, "<\\/script");
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'">
<style>html,body{width:100vw;height:100vh;margin:0;overflow:hidden;background:#0a0b09}body{display:flex;align-items:center;justify-content:center}canvas{display:block;max-width:100%;max-height:100%}</style>
<script>${safeLibrary}<\/script>
<script>
// Runtime generation ${generation}
(() => {
  let instanceId = "";
  let instance;
  let failed = false;
  const send = (type, data = {}) => parent.postMessage({ type, instanceId, ...data }, "*");
  const fail = (error) => { failed = true; send("runtime-error", { message: error instanceof Error ? error.message : String(error) }); };

  addEventListener("error", (event) => fail(event.error || event.message));
  addEventListener("unhandledrejection", (event) => fail(event.reason));
  addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "load-source") {
      instanceId = message.instanceId;
      try {
        (0, eval)(message.source + "\\n//# sourceURL=agent-sketch.js");
        send("definition-loaded", { config: window.sketchConfig, schema: window.sketchConfigSchema, supportsNativeLottie: typeof window.exportLottie === "function" });
      } catch (error) { fail(error); }
      return;
    }
    if (message.instanceId !== instanceId) return;
    try {
      if (message.type === "start-sketch") {
        failed = false;
        window.sketchConfig = message.config;
        window.p5.instance?.remove();
        document.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
        instance = new window.p5();
        if (message.paused) instance.noLoop();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!failed && document.querySelectorAll("canvas").length === 1) send("sketch-started");
          else if (!failed) fail(new Error("Sketch setup did not create exactly one canvas."));
        }));
      } else if (message.type === "apply-config") {
        window.sketchConfig = message.config;
      } else if (message.type === "control") {
        if (message.action === "play") instance?.loop();
        else instance?.noLoop();
      } else if (message.type === "capture-canvas") {
        const canvas = document.querySelector("canvas");
        if (!canvas) throw new Error("The sketch has no canvas to export.");
        canvas.toBlob((blob) => blob ? send("canvas-captured", { requestId: message.requestId, blob }) : send("export-failed", { requestId: message.requestId, message: "Canvas export failed." }), "image/png");
      } else if (message.type === "export-native-lottie") {
        if (typeof window.exportLottie !== "function") throw new Error("This sketch does not provide window.exportLottie.");
        Promise.resolve(window.exportLottie(message.settings)).then(
          (document) => {
            const json = JSON.stringify(document);
            if (json.length > 10 * 1024 * 1024) throw new Error("Vector Lottie output exceeds the 10 MiB runtime limit.");
            send("native-lottie-exported", { requestId: message.requestId, document });
          },
          (error) => send("export-failed", { requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
        ).catch((error) => send("export-failed", { requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
      } else if (message.type === "capture-lottie-frames") {
        captureRaster(message.settings, message.requestId);
      }
    } catch (error) { fail(error); }
  });

  async function captureRaster(settings, requestId) {
    try {
      const count = Math.round(settings.durationSeconds * settings.frameRate);
      if (!Number.isFinite(count) || count < 1 || count > 150) throw new Error("Raster Lottie exports require 1-150 frames.");
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("The sketch has no canvas to export.");
      if (canvas.width * canvas.height > 2500000) throw new Error("Raster Lottie canvas area is limited to 2.5 million pixels.");
      instance.noLoop();
      instance.frameCount = 0;
      instance.deltaTime = 1000 / settings.frameRate;
      const frames = [];
      let encodedCharacters = 0;
      for (let index = 0; index < count; index += 1) {
        await instance.redraw();
        const frame = canvas.toDataURL("image/png");
        encodedCharacters += frame.length;
        if (encodedCharacters > 32 * 1024 * 1024) throw new Error("Raster frames exceed the 32 MiB runtime limit.");
        frames.push(frame);
        send("lottie-export-progress", { requestId, progress: (index + 1) / count });
      }
      send("raster-lottie-exported", { requestId, frames, width: canvas.width, height: canvas.height });
    } catch (error) {
      send("export-failed", { requestId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  addEventListener("load", () => parent.postMessage({ type: "runtime-ready", generation: ${generation} }, "*"), { once: true });
})();
<\/script></head><body></body></html>`;
  }
</script>
