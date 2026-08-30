import type { ConfigPatch, EditorCommands, PlaybackAction } from "./commands";
import type { P5Project } from "./project";

interface ModelContext {
  registerTool(tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }): Promise<void>;
}

type Callbacks = {
  getProject: () => P5Project;
  getRuntimeStatus: () => string;
  commands: EditorCommands;
};

export async function registerP5Tools(callbacks: Callbacks, signal?: AbortSignal) {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!context) return { supported: false, message: "WebMCP unavailable" };

  const revision = { type: "integer", minimum: 0 };
  const tools = [
    tool("get_sketch", "Get p5 sketch", "Return the applied source, editable configuration, schema, revision, runtime status, and Lottie export capability.", { type: "object", additionalProperties: false }, () => {
      const project = callbacks.getProject();
      return { ok: true, source: project.source, config: project.config, schema: project.schema, revision: project.revision, runtimeStatus: callbacks.getRuntimeStatus(), lottie: { nativeSupported: callbacks.commands.supportsNativeLottie(), settings: project.exportSettings } };
    }),
    tool("replace_sketch", "Replace p5 sketch", "Replace the complete p5.js source. Existing compatible config values are preserved.", {
      type: "object", additionalProperties: false, required: ["source", "expectedRevision"],
      properties: { source: { type: "string", minLength: 1, maxLength: 200_000 }, expectedRevision: revision },
    }, async (input) => {
      const value = object(input);
      if (typeof value.source !== "string" || !Number.isInteger(value.expectedRevision)) throw new Error("A source string and expectedRevision are required.");
      const project = await callbacks.commands.replaceSource(value.source, value.expectedRevision as number);
      return { ok: true, revision: project.revision, message: "Sketch replaced." };
    }),
    tool("patch_sketch_config", "Patch sketch config", "Update schema-approved config paths without replacing sketch logic.", {
      type: "object", additionalProperties: false, required: ["patches", "expectedRevision"], properties: {
        expectedRevision: revision,
        patches: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", additionalProperties: false, required: ["path", "value"], properties: {
          path: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 80 } }, value: {},
        } } },
      },
    }, (input) => {
      const value = object(input);
      if (!Number.isInteger(value.expectedRevision) || !Array.isArray(value.patches)) throw new Error("Patches and expectedRevision are required.");
      const patches = value.patches.map(patch);
      const project = callbacks.commands.patchConfig(patches, value.expectedRevision as number);
      return { ok: true, revision: project.revision, message: `${patches.length} config value(s) updated.` };
    }),
    tool("control_sketch", "Control sketch playback", "Play, pause, or restart the current sketch.", {
      type: "object", additionalProperties: false, required: ["action"], properties: { action: { type: "string", enum: ["play", "pause", "restart"] } },
    }, (input) => {
      const action = object(input).action;
      if (!["play", "pause", "restart"].includes(action as string)) throw new Error("Unsupported playback action.");
      callbacks.commands.control(action as PlaybackAction);
      return { ok: true, action };
    }),
  ];

  try {
    for (const registered of tools) await context.registerTool(registered, { signal });
    return { supported: true, message: `${tools.length} tools ready` };
  } catch {
    return { supported: true, message: "Tool registration rejected" };
  }
}

function tool(name: string, title: string, description: string, inputSchema: Record<string, unknown>, execute: (input: unknown) => unknown) {
  return { name, title, description, inputSchema, execute: async (input: unknown) => {
    try { return await execute(input); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Invalid tool input.";
      return { ok: false, category: message.startsWith("Revision conflict") ? "conflict" : "validation", message };
    }
  } };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool input must be an object.");
  return value as Record<string, unknown>;
}

function patch(value: unknown): ConfigPatch {
  const input = object(value);
  if (!Array.isArray(input.path) || input.path.some((part) => typeof part !== "string")) throw new Error("Every patch needs a string path array.");
  return { path: input.path as string[], value: input.value };
}
