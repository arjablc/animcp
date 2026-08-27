import {
  MAX_ENCODED_BYTES,
  importAsset,
  type KnownFixtureSource,
  type ImportProgress,
  type ImportResult
} from "./importer";

let registrationTail: Promise<void> = Promise.resolve();

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: (input: unknown, options?: { signal: AbortSignal }) => Promise<ImportResult>;
    },
    options?: { signal?: AbortSignal }
  ): Promise<void>;
}

interface Registration {
  available: boolean;
  registered: boolean;
  message: string;
  dispose: () => void;
}

function modelContext() {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

export async function registerImportTool(callbacks: {
  onProgress: (progress: ImportProgress) => void;
  onResult: (result: ImportResult) => void;
  knownFixtureForInput: (input: unknown) => KnownFixtureSource | undefined;
}, lifecycleSignal?: AbortSignal): Promise<Registration> {
  const context = modelContext();
  if (!context) {
    return {
      available: false,
      registered: false,
      message: "document.modelContext is unavailable in this browser.",
      dispose: () => undefined
    };
  }

  const controller = new AbortController();
  const abort = () => controller.abort(lifecycleSignal?.reason);
  if (lifecycleSignal?.aborted) {
    abort();
  } else {
    lifecycleSignal?.addEventListener("abort", abort, { once: true });
  }
  let release!: () => void;
  const previousRegistration = registrationTail;
  registrationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousRegistration;

  let released = false;
  const dispose = () => {
    controller.abort();
    lifecycleSignal?.removeEventListener("abort", abort);
    if (!released) {
      released = true;
      release();
    }
  };

  if (controller.signal.aborted) {
    dispose();
    return {
      available: true,
      registered: false,
      message: "WebMCP registration was cancelled.",
      dispose
    };
  }

  try {
    await context.registerTool(
      {
        name: "import_asset",
        title: "Import PNG asset",
        description:
          "Import one complete PNG encoded as base64. Use a stable transferId for an idempotent retry. Include expectedBytes and sha256 to verify exact transport. The result contains metadata only and never returns image data.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["transferId", "mimeType", "encoding", "data"],
          properties: {
            transferId: { type: "string", minLength: 1, maxLength: 128 },
            name: { type: "string", minLength: 1, maxLength: 128 },
            mimeType: { const: "image/png" },
            encoding: { const: "base64" },
            data: { type: "string", minLength: 1, maxLength: MAX_ENCODED_BYTES },
            expectedBytes: { type: "integer", minimum: 0, maximum: 10 * 1024 * 1024 },
            sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }
          }
        },
        execute: async (input, options) => {
          const result = await importAsset(input, {
            signal: options?.signal,
            onProgress: callbacks.onProgress,
            knownFixtureSource: callbacks.knownFixtureForInput(input)
          });
          callbacks.onResult(result);
          return result;
        }
      },
      { signal: controller.signal }
    );
    if (controller.signal.aborted) {
      dispose();
      return {
        available: true,
        registered: false,
        message: "WebMCP registration was cancelled.",
        dispose
      };
    }
    return {
      available: true,
      registered: true,
      message: "import_asset is registered and ready for an agent.",
      dispose
    };
  } catch {
    dispose();
    return {
      available: true,
      registered: false,
      message: "The browser exposed WebMCP but rejected import_asset registration.",
      dispose
    };
  }
}
