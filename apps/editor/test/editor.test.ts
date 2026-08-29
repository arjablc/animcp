import { describe, expect, it } from "vitest";
import { fitImageToCanvas, formatTime, layerPositionFromDrag, trackStartFromPointer } from "../src/editor/model";
import { createProject } from "../src/lib/projects";

describe("editor timeline", () => {
  it("formats seconds as a 30 fps timecode", () => {
    expect(formatTime(1.5)).toBe("00:01:15");
  });

  it("creates an independent local project document", () => {
    const project = createProject("Demo", new Date("2026-01-01T00:00:00Z"));
    project.layers[0].name = "Changed";
    expect(createProject("Next").layers).toHaveLength(1);
    expect(createProject("Next").layers[0].name).toBe("Scene");
    expect(project.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps dragged clips inside the timeline", () => {
    expect(trackStartFromPointer(900, 1000, 0, 2)).toBe(3);
    expect(trackStartFromPointer(-20, 1000, 0, 2)).toBe(0);
  });

  it("fits imported images inside the canvas without changing their aspect ratio", () => {
    expect(fitImageToCanvas(1920, 1080)).toEqual({ x: 30, y: 30, width: 40, height: 40 });
    expect(fitImageToCanvas(100, 200)).toEqual({ x: 41.5625, y: 20, width: 16.875, height: 60 });
  });

  it("moves canvas layers in artboard coordinates and keeps them inside", () => {
    const layer = { x: 20, y: 30, width: 25, height: 20 };
    expect(layerPositionFromDrag(layer, 82, -41, 820, 410)).toEqual({ x: 30, y: 20 });
    expect(layerPositionFromDrag(layer, 1000, 1000, 820, 410)).toEqual({ x: 75, y: 80 });
  });
});
