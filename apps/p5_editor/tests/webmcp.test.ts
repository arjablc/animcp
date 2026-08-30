import { afterEach, describe, expect, it, vi } from "vitest";
import { registerP5Tools } from "../src/lib/webmcp";

afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe("p5 WebMCP", () => {
  it("registers the minimal tool surface", async () => {
    const tools: Array<{ name: string; execute: (input: unknown) => Promise<unknown> }> = [];
    (globalThis as { document?: unknown }).document = { modelContext: { registerTool: vi.fn(async (tool) => { tools.push(tool); }) } };
    const commands = {
      load: vi.fn(), replaceSource: vi.fn(async () => ({ revision: 2 })), patchConfig: vi.fn(() => ({ revision: 2 })), control: vi.fn(), capture: vi.fn(),
    } as never;
    const result = await registerP5Tools({
      getProject: () => ({ source: "source", config: {}, schema: {}, revision: 1 } as never),
      getRuntimeStatus: () => "running",
      commands,
    });
    expect(result.supported).toBe(true);
    expect(tools.map((tool) => tool.name)).toEqual(["get_sketch", "replace_sketch", "patch_sketch_config", "control_sketch"]);
    expect(await tools[0].execute({})).toMatchObject({ ok: true, revision: 1, runtimeStatus: "running" });
  });
});
