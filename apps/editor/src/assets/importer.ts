import { z } from "zod";

export const MAX_DECODED_BYTES = 10 * 1024 * 1024;
export const MAX_ENCODED_BYTES = Math.ceil(MAX_DECODED_BYTES / 3) * 4;
export const IMPORT_TIMEOUT_MS = 30_000;

const MAX_DIMENSION = 4_096;
const MAX_PIXELS = 2 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const databaseName = "animcp-editor";
const assetStoreName = "assets";

export const importAssetSchema = z.object({
  transferId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(128).optional(),
  mimeType: z.literal("image/png"),
  encoding: z.literal("base64"),
  data: z.string().min(1).max(MAX_ENCODED_BYTES),
  expectedBytes: z.number().int().nonnegative().max(MAX_DECODED_BYTES).optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional()
}).strict();

export type ImportAssetInput = z.infer<typeof importAssetSchema>;
export type ImportErrorCategory =
  | "DUPLICATE_RETRY" | "HASH_MISMATCH" | "IMPORT_ABORTED" | "IMPORT_TIMEOUT"
  | "INVALID_BASE64" | "INVALID_IMAGE" | "INVALID_INPUT" | "PAYLOAD_TRUNCATED"
  | "STORAGE_ERROR" | "TOOL_ARGUMENT_TOO_LARGE";
export type ImportProgress = "Decoding" | "Persisting" | "Validating" | "Verifying";

export interface StoredAsset {
  id: string;
  name: string;
  mimeType: "image/png";
  blob: Blob;
  encodedBytes: number;
  decodedBytes: number;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
}

export type ImportResult =
  | { ok: true; asset: Omit<StoredAsset, "blob">; durationMs: number; alreadyImported: boolean }
  | { ok: false; error: { category: ImportErrorCategory; message: string }; durationMs: number };

class ImportProblem extends Error {
  constructor(readonly category: ImportErrorCategory, message: string) {
    super(message);
  }
}

function durationSince(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function failure(startedAt: number, category: ImportErrorCategory, message: string): ImportResult {
  return { ok: false, error: { category, message }, durationMs: durationSince(startedAt) };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof ImportProblem
      ? signal.reason
      : new ImportProblem("IMPORT_ABORTED", "The tool execution was cancelled.");
  }
}

function waitFor<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof ImportProblem
      ? signal.reason : new ImportProblem("IMPORT_ABORTED", "The tool execution was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function timedSignal(source?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(source?.reason instanceof ImportProblem
    ? source.reason : new ImportProblem("IMPORT_ABORTED", "The tool execution was cancelled."));
  if (source?.aborted) onAbort();
  else source?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => {
    controller.abort(new ImportProblem("IMPORT_TIMEOUT", "Image import exceeded the 30 second limit."));
  }, IMPORT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timeout);
      source?.removeEventListener("abort", onAbort);
    }
  };
}

export function decodeBase64(data: string): Uint8Array {
  const normalized = data.replace(/\s/g, "");
  if (normalized.length === 0 || normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new ImportProblem("INVALID_BASE64", "The image data is not valid base64.");
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  if (normalized.length / 4 * 3 - padding > MAX_DECODED_BYTES) {
    throw new ImportProblem("TOOL_ARGUMENT_TOO_LARGE", `Decoded image data exceeds the ${MAX_DECODED_BYTES / 1024 / 1024} MiB limit.`);
  }
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ImportProblem("INVALID_BASE64", "The image data could not be decoded.");
  }
}

export function inspectPng(bytes: Uint8Array) {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new ImportProblem("INVALID_IMAGE", "The decoded data is not a PNG.");
  }
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
    throw new ImportProblem("INVALID_IMAGE", "The PNG is missing its IHDR header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new ImportProblem("INVALID_IMAGE", "The PNG dimensions exceed the editor limits.");
  }
  return { width, height };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function decodeImage(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(assetStoreName)) {
        request.result.createObjectStore(assetStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeAsset(asset: StoredAsset, signal?: AbortSignal) {
  const database = await waitFor(openDatabase(), signal);
  try {
    return await new Promise<{ asset: StoredAsset; alreadyImported: boolean }>((resolve, reject) => {
      const transaction = database.transaction(assetStoreName, "readwrite");
      const store = transaction.objectStore(assetStoreName);
      let outcome: { asset: StoredAsset; alreadyImported: boolean } | undefined;
      let problem: Error | undefined;
      const request = store.get(asset.id);
      const onAbort = () => {
        problem = signal?.reason instanceof ImportProblem ? signal.reason : new ImportProblem("IMPORT_ABORTED", "The tool execution was cancelled.");
        transaction.abort();
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      request.onerror = () => { problem = request.error ?? new Error("Could not read the existing asset."); transaction.abort(); };
      request.onsuccess = () => {
        const existing = request.result as StoredAsset | undefined;
        if (!existing) { outcome = { asset, alreadyImported: false }; store.add(asset); return; }
        if (existing.sha256 === asset.sha256) { outcome = { asset: existing, alreadyImported: true }; return; }
        problem = new ImportProblem("DUPLICATE_RETRY", "This transfer ID already belongs to a different image.");
        transaction.abort();
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      transaction.oncomplete = () => { cleanup(); resolve(outcome!); };
      transaction.onerror = transaction.onabort = () => { cleanup(); reject(problem ?? transaction.error ?? new Error("Could not save the asset.")); };
    });
  } finally {
    database.close();
  }
}

function withoutBlob(asset: StoredAsset): Omit<StoredAsset, "blob"> {
  const { blob: _blob, ...metadata } = asset;
  return metadata;
}

export async function importAsset(input: unknown, options: {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
} = {}): Promise<ImportResult> {
  const startedAt = performance.now();
  const cancellation = timedSignal(options.signal);
  const signal = cancellation.signal;
  try {
    if (typeof input === "object" && input !== null && "data" in input && typeof input.data === "string" && input.data.length > MAX_ENCODED_BYTES) {
      return failure(startedAt, "TOOL_ARGUMENT_TOO_LARGE", `Encoded image data exceeds the ${Math.ceil(MAX_ENCODED_BYTES / 1024 / 1024)} MiB limit.`);
    }
    options.onProgress?.("Validating");
    throwIfAborted(signal);
    const parsed = importAssetSchema.safeParse(input);
    if (!parsed.success) return failure(startedAt, "INVALID_INPUT", "The tool input does not match the import contract.");
    options.onProgress?.("Decoding");
    const encodedBytes = parsed.data.data.replace(/\s/g, "").length;
    const bytes = decodeBase64(parsed.data.data);
    throwIfAborted(signal);
    if (parsed.data.expectedBytes !== undefined && bytes.byteLength !== parsed.data.expectedBytes) {
      return failure(startedAt, "PAYLOAD_TRUNCATED", "Decoded byte count does not match expectedBytes.");
    }
    options.onProgress?.("Verifying");
    const header = inspectPng(bytes);
    const sha256 = await waitFor(sha256Hex(bytes), signal);
    if (parsed.data.sha256 && parsed.data.sha256.toLowerCase() !== sha256) {
      return failure(startedAt, "HASH_MISMATCH", "Decoded image data does not match the supplied SHA-256.");
    }
    const blob = new Blob([toArrayBuffer(bytes)], { type: parsed.data.mimeType });
    let decoded: { width: number; height: number };
    try { decoded = await waitFor(decodeImage(blob), signal); }
    catch { throwIfAborted(signal); return failure(startedAt, "INVALID_IMAGE", "The PNG could not be decoded by this browser."); }
    if (decoded.width !== header.width || decoded.height !== header.height) {
      return failure(startedAt, "INVALID_IMAGE", "Browser-decoded dimensions do not match the PNG header.");
    }
    options.onProgress?.("Persisting");
    const saved = await storeAsset({
      id: parsed.data.transferId, name: parsed.data.name ?? "Imported PNG", mimeType: parsed.data.mimeType,
      blob, encodedBytes, decodedBytes: bytes.byteLength, sha256, width: decoded.width, height: decoded.height,
      createdAt: new Date().toISOString()
    }, signal);
    return { ok: true, asset: withoutBlob(saved.asset), durationMs: durationSince(startedAt), alreadyImported: saved.alreadyImported };
  } catch (error) {
    if (error instanceof ImportProblem) return failure(startedAt, error.category, error.message);
    return failure(startedAt, "STORAGE_ERROR", "The image could not be decoded or stored locally.");
  } finally {
    cancellation.dispose();
  }
}
