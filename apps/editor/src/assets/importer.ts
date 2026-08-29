import type { SvgPart } from "../editor/model";
import { inspectSvg, sanitizeSvg } from "../svg/document";

export const MAX_SVG_BYTES = 5 * 1024 * 1024;
const databaseName = "animcp-editor";
const assetStoreName = "assets";

export type StoredSvgAsset = { id: string; name: string; mimeType: "image/svg+xml"; svg: string; width: number; height: number; parts: SvgPart[]; createdAt: string };
export type SvgAssetMetadata = Omit<StoredSvgAsset, "svg">;
export type ImportResult = { ok: true; asset: SvgAssetMetadata } | { ok: false; error: { message: string } };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(assetStoreName)) request.result.createObjectStore(assetStoreName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredAsset(id: string): Promise<StoredSvgAsset | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(assetStoreName).objectStore(assetStoreName).get(id);
      request.onsuccess = () => resolve(request.result as StoredSvgAsset | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function storeSvgAsset(asset: StoredSvgAsset) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(assetStoreName, "readwrite");
      transaction.objectStore(assetStoreName).put(asset);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the SVG asset."));
    });
  } finally { database.close(); }
}

export async function importSvgFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_SVG_BYTES) return { ok: false, error: { message: "SVG files must be 5 MiB or smaller." } };
  if (file.type && file.type !== "image/svg+xml" && !file.name.toLowerCase().endsWith(".svg")) return { ok: false, error: { message: "Only SVG files can be imported." } };
  try {
    const svg = sanitizeSvg(await file.text());
    const inspected = inspectSvg(svg);
    const asset: StoredSvgAsset = { id: `svg:${crypto.randomUUID()}`, name: file.name.slice(0, 128) || "Imported SVG", mimeType: "image/svg+xml", svg, width: inspected.width, height: inspected.height, parts: inspected.parts, createdAt: new Date().toISOString() };
    await storeSvgAsset(asset);
    const { svg: _svg, ...metadata } = asset;
    return { ok: true, asset: metadata };
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : "The SVG could not be imported." } };
  }
}
