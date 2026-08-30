import type { P5Project } from "./project";
import { mergeConfig, parseDefinition, setConfigValue, type ConfigObject, type SketchDefinition } from "./schema";

export type PlaybackAction = "play" | "pause" | "restart";
export type ConfigPatch = { path: string[]; value: unknown };

export interface SketchRuntimeHandle {
  loadSource(source: string): Promise<SketchDefinition>;
  start(config: ConfigObject): Promise<void>;
  applyConfig(config: ConfigObject): void;
  control(action: PlaybackAction): void;
  capture(): Promise<Blob>;
}

type Dependencies = {
  getProject: () => P5Project;
  setProject: (project: P5Project) => void;
  runtime: () => SketchRuntimeHandle;
};

export function createEditorCommands(deps: Dependencies) {
  let replacingSource = false;

  function commit(changes: Partial<P5Project>) {
    const project = deps.getProject();
    const next = { ...project, ...changes, revision: project.revision + 1, updatedAt: new Date().toISOString() };
    deps.setProject(next);
    return next;
  }

  function assertRevision(expected?: number) {
    if (expected !== undefined && expected !== deps.getProject().revision) throw new Error(`Revision conflict: expected ${expected}, current ${deps.getProject().revision}.`);
  }

  return {
    async load() {
      const project = deps.getProject();
      const definition = await deps.runtime().loadSource(project.source);
      const parsed = parseDefinition(definition.config, definition.schema);
      const config = mergeConfig(parsed.schema, parsed.config, project.config);
      await deps.runtime().start(config);
      return config;
    },

    async replaceSource(source: string, expectedRevision?: number) {
      if (replacingSource) throw new Error("A source replacement is already in progress.");
      assertRevision(expectedRevision);
      if (!source.trim() || source.length > 200_000) throw new Error("Sketch source must contain 1-200,000 characters.");
      const previous = deps.getProject();
      replacingSource = true;
      try {
        const definition = await deps.runtime().loadSource(source);
        const parsed = parseDefinition(definition.config, definition.schema);
        if (deps.getProject().revision !== previous.revision) throw new Error(`Revision conflict: expected ${previous.revision}, current ${deps.getProject().revision}.`);
        const config = mergeConfig(parsed.schema, parsed.config, previous.config);
        await deps.runtime().start(config);
        return commit({ source, config, schema: parsed.schema });
      } catch (error) {
        const current = deps.getProject();
        try {
          await deps.runtime().loadSource(current.source);
          await deps.runtime().start(current.config);
        } catch {}
        throw error;
      } finally {
        replacingSource = false;
      }
    },

    patchConfig(patches: ConfigPatch[], expectedRevision?: number) {
      if (replacingSource) throw new Error("Wait for the source replacement to finish.");
      assertRevision(expectedRevision);
      if (!Array.isArray(patches) || patches.length === 0 || patches.length > 50) throw new Error("Provide 1-50 config patches.");
      const project = deps.getProject();
      const config = patches.reduce((current, patch) => setConfigValue(current, project.schema, patch.path, patch.value), project.config);
      const next = commit({ config });
      deps.runtime().applyConfig(config);
      return next;
    },

    control(action: PlaybackAction) {
      deps.runtime().control(action);
      return { action };
    },

    capture() {
      return deps.runtime().capture();
    },
  };
}

export type EditorCommands = ReturnType<typeof createEditorCommands>;
