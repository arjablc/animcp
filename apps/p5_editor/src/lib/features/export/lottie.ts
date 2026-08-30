import { exportFrameRates, type ExportSettings } from "$lib/features/projects/project";

export type LottieDocument = Record<string, unknown>;

export const maxRasterFrames = 150;
const maxLottieBytes = 50 * 1024 * 1024;

export function validateExportSettings(settings: ExportSettings) {
  if (!Number.isFinite(settings.durationSeconds) || settings.durationSeconds < 1 || settings.durationSeconds > 10) throw new Error("Export duration must be between 1 and 10 seconds.");
  if (!exportFrameRates.includes(settings.frameRate)) throw new Error("Export frame rate must be 12, 15, 24, or 30 FPS.");
  if (settings.lottieMode !== "vector" && settings.lottieMode !== "raster") throw new Error("Unsupported Lottie export mode.");
  const frames = Math.round(settings.durationSeconds * settings.frameRate);
  if (settings.lottieMode === "raster" && frames > maxRasterFrames) throw new Error(`Raster Lottie exports are limited to ${maxRasterFrames} frames.`);
  return { ...settings, frames };
}

export function validateNativeLottie(value: unknown, settings: ExportSettings): LottieDocument {
  const { frames } = validateExportSettings(settings);
  if (!isRecord(value)) throw new Error("The sketch's Lottie exporter must return an object.");
  if (typeof value.v !== "string" || !value.v) throw new Error("Lottie output requires a version string.");
  if (value.fr !== settings.frameRate || value.ip !== 0 || value.op !== frames) throw new Error("Lottie timing must match the project's duration and frame rate.");
  validateDimensions(value.w, value.h);
  if (!Array.isArray(value.layers) || value.layers.length > 500) throw new Error("Lottie output requires at most 500 layers.");
  if (value.assets !== undefined && (!Array.isArray(value.assets) || value.assets.length > 500)) throw new Error("Lottie output supports at most 500 assets.");
  assertSize(value);
  return value;
}

export function buildRasterLottie(name: string, width: number, height: number, settings: ExportSettings, frames: string[]): LottieDocument {
  const validated = validateExportSettings({ ...settings, lottieMode: "raster" });
  validateDimensions(width, height);
  if (frames.length !== validated.frames) throw new Error(`Expected ${validated.frames} raster frames, received ${frames.length}.`);
  if (frames.some((frame) => !frame.startsWith("data:image/png;base64,"))) throw new Error("Raster frames must be embedded PNG data URLs.");

  const assets = frames.map((frame, index) => ({ id: `frame_${index}`, w: width, h: height, e: 1, p: frame, u: "" }));
  const layers = frames.map((_, index) => ({
    ddd: 0,
    ind: index + 1,
    ty: 2,
    nm: `Frame ${index + 1}`,
    refId: `frame_${index}`,
    sr: 1,
    ks: identityTransform(width, height),
    ao: 0,
    ip: index,
    op: index + 1,
    st: index,
    bm: 0,
  }));
  const document = {
    v: "5.12.2",
    fr: settings.frameRate,
    ip: 0,
    op: validated.frames,
    w: width,
    h: height,
    nm: name.slice(0, 200),
    ddd: 0,
    assets,
    layers,
  };
  assertSize(document);
  return document;
}

export function lottieBlob(document: LottieDocument) {
  return new Blob([JSON.stringify(document)], { type: "application/json" });
}

function identityTransform(width: number, height: number) {
  return {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [width / 2, height / 2, 0] },
    a: { a: 0, k: [width / 2, height / 2, 0] },
    s: { a: 0, k: [100, 100, 100] },
  };
}

function validateDimensions(width: unknown, height: unknown) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 || (width as number) > 4096 || (height as number) > 4096) {
    throw new Error("Lottie dimensions must be integers between 1 and 4096 pixels.");
  }
}

function assertSize(value: unknown) {
  let json: string;
  try { json = JSON.stringify(value); }
  catch { throw new Error("Lottie output must be JSON serializable."); }
  if (new Blob([json]).size > maxLottieBytes) throw new Error("Lottie output exceeds the 50 MiB limit.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
