import { describe, expect, it, vi } from "vitest";
import { createEditorCommands, type SketchRuntimeHandle } from "../src/lib/commands";
import type { P5Project } from "../src/lib/project";

const schema = { type: "object" as const, properties: { orb: { type: "object" as const, properties: { size: { type: "number" as const } } } } };

function setup() {
  let project: P5Project = {
    version: 1, id: "project", name: "Test", source: "old", config: { orb: { size: 9 } }, schema,
    revision: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const runtime: SketchRuntimeHandle = {
    loadSource: vi.fn(async () => ({ config: { orb: { size: 2 } }, schema })),
    start: vi.fn(async () => {}),
    applyConfig: vi.fn(),
    control: vi.fn(),
    capture: vi.fn(async () => new Blob()),
  };
  const commands = createEditorCommands({ getProject: () => project, setProject: (next) => { project = next; }, runtime: () => runtime });
  return { commands, runtime, project: () => project };
}

describe("editor commands", () => {
  it("preserves human config when replacing source", async () => {
    const test = setup();
    const project = await test.commands.replaceSource("new", 3);
    expect(project.source).toBe("new");
    expect(project.config).toEqual({ orb: { size: 9 } });
    expect(project.revision).toBe(4);
    expect(test.runtime.start).toHaveBeenCalledWith({ orb: { size: 9 } });
  });

  it("rejects stale agent revisions", async () => {
    const test = setup();
    await expect(test.commands.replaceSource("new", 2)).rejects.toThrow("Revision conflict");
    expect(test.runtime.loadSource).not.toHaveBeenCalled();
  });

  it("routes config updates into the runtime", () => {
    const test = setup();
    const project = test.commands.patchConfig([{ path: ["orb", "size"], value: 12 }], 3);
    expect(project.config).toEqual({ orb: { size: 12 } });
    expect(test.runtime.applyConfig).toHaveBeenCalledWith({ orb: { size: 12 } });
  });

  it("does not accept config edits during source validation", async () => {
    const test = setup();
    let finish!: (value: { config: { orb: { size: number } }; schema: typeof schema }) => void;
    vi.mocked(test.runtime.loadSource).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const replacement = test.commands.replaceSource("new", 3);
    expect(() => test.commands.patchConfig([{ path: ["orb", "size"], value: 12 }], 3)).toThrow("source replacement");
    finish({ config: { orb: { size: 2 } }, schema });
    await expect(replacement).resolves.toMatchObject({ revision: 4 });
  });
});
