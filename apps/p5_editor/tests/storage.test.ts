import { describe, expect, it } from "vitest";
import { defaultExportSettings, legacyDefaultSource } from "../src/lib/project";
import { migrateProject } from "../src/lib/storage";

const project = {
  version: 1,
  id: "old",
  name: "Old sketch",
  source: "source",
  config: {},
  schema: { type: "object", properties: {} },
  revision: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("project migration", () => {
  it("adds export settings to version 1 projects", () => {
    expect(migrateProject(project)).toMatchObject({ version: 2, exportSettings: defaultExportSettings });
  });

  it("normalizes invalid saved export settings", () => {
    expect(migrateProject({ ...project, version: 2, exportSettings: { durationSeconds: 100, frameRate: 60, lottieMode: "video" } })?.exportSettings).toEqual(defaultExportSettings);
  });

  it("adds the fixed vector exporter only to untouched starter source", () => {
    const migrated = migrateProject({ ...project, source: legacyDefaultSource, revision: 0 });
    expect(migrated?.source).toContain("window.exportLottie");
    expect(migrated?.source).not.toContain("h: 1");
    expect(migrated?.revision).toBe(1);
    expect(migrateProject({ ...project, source: `${legacyDefaultSource}\n// user edit` })?.source).toContain("// user edit");
  });
});
