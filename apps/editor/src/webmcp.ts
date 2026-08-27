import { MAX_ENCODED_BYTES, importAsset, type ImportResult } from "./assets/importer";

interface ModelContext {
  registerTool(tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: unknown, options?: { signal: AbortSignal }) => Promise<ImportResult>;
  }, options?: { signal?: AbortSignal }): Promise<void>;
}

function modelContext() {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

export async function registerImportTool(callbacks: { onResult: (result: ImportResult) => void }, signal?: AbortSignal) {
  const context = modelContext();
  if (!context) return { message: "document.modelContext is unavailable in this browser." };
  try {
    await context.registerTool({
      name: "import_asset",
      title: "Import PNG asset",
      description: "Import one complete PNG encoded as base64. Use a stable transferId for an idempotent retry. Include expectedBytes and sha256 to verify exact transport. The result contains metadata only and never returns image data.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["transferId", "mimeType", "encoding", "data"],
        properties: {
          transferId: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 128 },
          mimeType: { const: "image/png" }, encoding: { const: "base64" }, data: { type: "string", minLength: 1, maxLength: MAX_ENCODED_BYTES },
          expectedBytes: { type: "integer", minimum: 0, maximum: 10 * 1024 * 1024 }, sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }
        }
      },
      execute: async (input, options) => {
        const result = await importAsset(input, { signal: options?.signal });
        callbacks.onResult(result);
        return result;
      }
    }, { signal });
    return { message: "import_asset is registered and ready for an agent." };
  } catch {
    return { message: "The browser exposed WebMCP but rejected import_asset registration." };
  }
}
