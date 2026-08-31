export function runtimeDocument(library: string, brushLibrary: string, generation: number) {
	// The library is embedded in srcdoc, so closing script tags must be escaped first.
	const safeLibrary = library.replace(/<\/script/gi, '<\\/script');
	const safeBrushLibrary = brushLibrary.replace(/<\/script/gi, '<\\/script');
	return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#0a0b09}body{display:grid;place-items:center}canvas{display:block;max-width:100%;max-height:100%;object-fit:contain}</style>
<script>${safeLibrary}</script>
<script>
// Runtime generation ${generation}
(() => {
  let instanceId = "";
  let instance;
  let failed = false;
  const send = (type, data = {}) => parent.postMessage({ type, instanceId, ...data }, "*");
  const fail = (error) => { failed = true; send("runtime-error", { message: error instanceof Error ? error.message : String(error) }); };
  const brushLibrary = ${JSON.stringify(safeBrushLibrary)};
  let brushInstalled = false;

  const installBrush = () => {
    if (brushInstalled) return;
    (0, eval)(brushLibrary + "\\n//# sourceURL=p5.brush.js");
    brushInstalled = true;

    const brushLoad = window.brush.load.bind(window.brush);
    window.brush.load = (target) => {
      if (!target && window.p5?.instance?.webglVersion !== "webgl2") return;
      return brushLoad(target);
    };
    const createCanvas = window.p5.prototype.createCanvas;
    window.p5.prototype.createCanvas = function (...args) {
      const canvas = createCanvas.apply(this, args);
      if (this.webglVersion === "webgl2") {
        window.brush.instance(this);
        brushLoad();
      }
      return canvas;
    };
  };

  addEventListener("error", (event) => fail(event.error || event.message));
  addEventListener("unhandledrejection", (event) => fail(event.reason));
  addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "load-source") {
      instanceId = message.instanceId;
      try {
        if (/\\bbrush\\s*[.([]/.test(message.source)) installBrush();
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
        instance = new window.p5();
        if (message.paused) instance.noLoop();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const canvases = document.querySelectorAll("canvas");
          if (!failed && canvases.length === 1 && canvases[0].width > 0 && canvases[0].height > 0) send("sketch-started");
          else if (!failed) fail(new Error("Sketch setup did not create a visible canvas."));
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
      } else if (message.type === "record-video") {
        recordVideo(message.settings, message.requestId);
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

  function recordVideo(settings, requestId) {
    let stream;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser does not support video recording.");
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("The sketch has no canvas to record.");
      const mimeType = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1.42001E", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("MP4 export is not supported by this browser. Try a current Chromium browser.");
      stream = canvas.captureStream(settings.frameRate);
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
      let failed = false;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("error", (event) => {
        failed = true;
        stream.getTracks().forEach((track) => track.stop());
        send("export-failed", { requestId, message: event.error?.message || "MP4 recording failed." });
      });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!failed) send("video-recorded", { requestId, blob: new Blob(chunks, { type: mimeType }) });
      });
      instance.frameCount = 0;
      recorder.start(1000);
      instance.loop();
      setTimeout(() => {
        instance.noLoop();
        recorder.stop();
      }, settings.durationSeconds * 1000);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      send("export-failed", { requestId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  addEventListener("load", () => parent.postMessage({ type: "runtime-ready", generation: ${generation} }, "*"), { once: true });
})();
</script></head><body></body></html>`;
}
