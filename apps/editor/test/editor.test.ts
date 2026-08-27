import { describe, expect, it } from "vitest";
import { formatTime, trackStartFromPointer } from "../src/editor/model";
import { createProject } from "../src/lib/projects";

describe("editor timeline", () => {
  it("formats seconds as a 30 fps timecode", () => {
    expect(formatTime(1.5)).toBe("00:01:15");
  });

  it("creates an independent local project document", () => {
    const project = createProject("Demo", new Date("2026-01-01T00:00:00Z"));
    project.layers[0].name = "Changed";
    expect(createProject("Next").layers[0].name).toBe("Hero scene");
    expect(project.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps dragged clips inside the timeline", () => {
    expect(trackStartFromPointer(900, 1000, 0, 2)).toBe(3);
    expect(trackStartFromPointer(-20, 1000, 0, 2)).toBe(0);
  });
});
