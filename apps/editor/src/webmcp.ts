import { svgProperties, type Keyframe, type SvgProperty, type SvgValue } from "./editor/model";

interface ModelContext {
  registerTool(tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }): Promise<void>;
}

type Target = { layerId: string; partId: string };
type Callbacks = {
  getScene: () => unknown;
  getParts: (layerId: string) => unknown;
  setProperty: (target: Target, property: SvgProperty, value: SvgValue) => unknown;
  animate: (target: Target, property: SvgProperty, keyframes: Keyframe[]) => unknown;
  deleteAnimation: (target: Target, property: SvgProperty) => unknown;
  setPlayhead: (time: number) => unknown;
  setPlayback: (playing: boolean) => unknown;
};

function modelContext() {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

const targetProperties = { layerId: { type: "string", minLength: 1, maxLength: 128 }, partId: { type: "string", minLength: 1, maxLength: 128 } };
const propertySchema = { type: "string", enum: [...svgProperties] };

export async function registerEditorTools(callbacks: Callbacks, signal?: AbortSignal) {
  const context = modelContext();
  if (!context) return { message: "document.modelContext is unavailable in this browser." };
  const tools = [
    tool("get_scene", "Get editor scene", "Return the active layers, tagged SVG parts, animations, playhead, and playback state.", { type: "object", additionalProperties: false }, () => callbacks.getScene()),
    tool("get_svg_parts", "Get SVG parts", "List the tagged parts in one SVG layer. Use exact layer and part IDs in mutation tools.", { type: "object", additionalProperties: false, required: ["layerId"], properties: { layerId: targetProperties.layerId } }, (input) => callbacks.getParts(object(input).layerId as string)),
    tool("set_part_property", "Set SVG part property", "Set a static visual property on one exact tagged SVG part.", {
      type: "object", additionalProperties: false, required: ["layerId", "partId", "property", "value"],
      properties: { ...targetProperties, property: propertySchema, value: { anyOf: [{ type: "number" }, { type: "string", maxLength: 64 }] } },
    }, (input) => { const value = object(input); return callbacks.setProperty(target(value), property(value), value.value as SvgValue); }),
    tool("animate_part", "Animate SVG part", "Replace one property track with time/value keyframes. Times are seconds in the 0-5 second project range.", {
      type: "object", additionalProperties: false, required: ["layerId", "partId", "property", "keyframes"],
      properties: { ...targetProperties, property: propertySchema, keyframes: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["time", "value"], properties: { time: { type: "number", minimum: 0, maximum: 5 }, value: { anyOf: [{ type: "number" }, { type: "string", maxLength: 64 }] } } } } },
    }, (input) => { const value = object(input); return callbacks.animate(target(value), property(value), value.keyframes as Keyframe[]); }),
    tool("delete_part_animation", "Delete SVG part animation", "Delete one animated property track from an SVG part.", { type: "object", additionalProperties: false, required: ["layerId", "partId", "property"], properties: { ...targetProperties, property: propertySchema } }, (input) => { const value = object(input); return callbacks.deleteAnimation(target(value), property(value)); }),
    tool("set_playhead", "Set playhead", "Seek the editor playhead to a time in seconds.", { type: "object", additionalProperties: false, required: ["time"], properties: { time: { type: "number", minimum: 0, maximum: 5 } } }, (input) => callbacks.setPlayhead(object(input).time as number)),
    tool("set_playback", "Set playback", "Start or pause editor playback.", { type: "object", additionalProperties: false, required: ["playing"], properties: { playing: { type: "boolean" } } }, (input) => callbacks.setPlayback(object(input).playing as boolean)),
  ];
  try {
    for (const editorTool of tools) await context.registerTool(editorTool, { signal });
    return { message: `${tools.length} SVG editor tools registered.` };
  } catch {
    return { message: "The browser exposed WebMCP but rejected editor tool registration." };
  }
}

function tool(name: string, title: string, description: string, inputSchema: Record<string, unknown>, execute: (input: unknown) => unknown) {
  return { name, title, description, inputSchema, execute: async (input: unknown) => { try { return execute(input); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Invalid tool input." }; } } };
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool input must be an object.");
  return input as Record<string, unknown>;
}

function target(value: Record<string, unknown>): Target {
  if (typeof value.layerId !== "string" || typeof value.partId !== "string") throw new Error("A valid layerId and partId are required.");
  return { layerId: value.layerId, partId: value.partId };
}

function property(value: Record<string, unknown>): SvgProperty {
  if (!svgProperties.includes(value.property as SvgProperty)) throw new Error("Unsupported SVG property.");
  return value.property as SvgProperty;
}
