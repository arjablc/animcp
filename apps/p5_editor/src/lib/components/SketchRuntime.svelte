<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import p5Source from "virtual:p5-runtime";
  import type { PlaybackAction, SketchRuntimeHandle } from "../commands";
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
  let captureRequest: Deferred<Blob> | undefined;
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
      definition?.resolve({ config: message.config as ConfigObject, schema: message.schema as SketchDefinition["schema"] });
    } else if (message.type === "sketch-started") {
      onstatus("running");
      started?.resolve();
    } else if (message.type === "runtime-error") {
      const text = typeof message.message === "string" ? message.message : "The sketch failed.";
      onstatus("error");
      onerror(text);
      definition?.reject(new Error(text));
      started?.reject(new Error(text));
    } else if (message.type === "canvas-captured") {
      if (message.blob instanceof Blob) captureRequest?.resolve(message.blob);
      else captureRequest?.reject(new Error("The runtime returned an invalid canvas image."));
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

  export async function start(config: ConfigObject) {
    currentConfig = structuredClone(config);
    started = deferred<void>();
    frame.contentWindow?.postMessage({ type: "start-sketch", instanceId, config }, "*");
    await withTimeout(started.promise, 5_000, "Sketch setup did not finish.");
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
    onstatus(action === "play" ? "running" : "paused");
  }

  export async function capture() {
    captureRequest?.reject(new Error("A newer capture replaced this request."));
    captureRequest = deferred<Blob>();
    frame.contentWindow?.postMessage({ type: "capture-canvas", instanceId }, "*");
    return withTimeout(captureRequest.promise, 5_000, "Canvas export timed out.");
  }

  function rejectPending(error: Error) {
    ready?.reject(error);
    definition?.reject(error);
    started?.reject(error);
    captureRequest?.reject(error);
    ready = definition = started = captureRequest = undefined;
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
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#0a0b09}body{display:grid;place-items:center}canvas{display:block;max-width:100%;max-height:100%;object-fit:contain}</style>
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
        send("definition-loaded", { config: window.sketchConfig, schema: window.sketchConfigSchema });
      } catch (error) { fail(error); }
      return;
    }
    if (message.instanceId !== instanceId) return;
    try {
      if (message.type === "start-sketch") {
        failed = false;
        window.sketchConfig = message.config;
        instance = new window.p5();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!failed && document.querySelector("canvas")) send("sketch-started");
          else if (!failed) fail(new Error("Sketch setup did not create a canvas."));
        }));
      } else if (message.type === "apply-config") {
        window.sketchConfig = message.config;
      } else if (message.type === "control") {
        if (message.action === "play") instance?.loop();
        else instance?.noLoop();
      } else if (message.type === "capture-canvas") {
        const canvas = document.querySelector("canvas");
        if (!canvas) throw new Error("The sketch has no canvas to export.");
        canvas.toBlob((blob) => blob ? send("canvas-captured", { blob }) : fail(new Error("Canvas export failed.")), "image/png");
      }
    } catch (error) { fail(error); }
  });
  parent.postMessage({ type: "runtime-ready", generation: ${generation} }, "*");
})();
<\/script></head><body></body></html>`;
  }
</script>
