import { afterEach, describe, expect, it, vi } from "vitest";
import { registerEditorTools } from "../src/webmcp";

describe("WebMCP editor tools", () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, "document"); });

  it("registers SVG discovery, property, animation, and playback tools", async () => {
    const tools = new Map<string, { execute: (input: unknown) => Promise<unknown> }>();
    Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: { registerTool: vi.fn(async (tool) => { tools.set(tool.name, tool); }) } } });
    const callbacks = {
      getScene: vi.fn(() => ({ ok: true })), getParts: vi.fn(() => ({ ok: true })), setProperty: vi.fn(() => ({ ok: true })),
      animate: vi.fn(() => ({ ok: true })), deleteAnimation: vi.fn(() => ({ ok: true })), setPlayhead: vi.fn(() => ({ ok: true })), setPlayback: vi.fn(() => ({ ok: true })),
    };

    await registerEditorTools(callbacks);

    expect([...tools.keys()]).toEqual(["get_scene", "get_svg_parts", "set_part_property", "animate_part", "delete_part_animation", "set_playhead", "set_playback"]);
    await tools.get("set_part_property")!.execute({ layerId: "car", partId: "left-wheel", property: "fill", value: "#ff0000" });
    expect(callbacks.setProperty).toHaveBeenCalledWith({ layerId: "car", partId: "left-wheel" }, "fill", "#ff0000");
    expect(await tools.get("set_part_property")!.execute(null)).toMatchObject({ ok: false });
  });
});
