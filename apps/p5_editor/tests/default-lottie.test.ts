import { describe, expect, it } from "vitest";
import { defaultSource } from "../src/lib/features/projects/starter";

describe("default sketch Lottie exporter", () => {
  it("emits smooth, spec-shaped position keyframes and a centered background", () => {
    const sketchWindow: Record<string, unknown> = {};
    const exporter = new Function("window", `${defaultSource}; return window.exportLottie;`)(sketchWindow) as (settings: { durationSeconds: number; frameRate: number }) => Record<string, unknown>;
    const document = exporter({ durationSeconds: 1, frameRate: 12 });
    const layers = document.layers as Array<Record<string, unknown>>;
    const orbTransform = layers[0].ks as Record<string, { k: Array<Record<string, unknown>> }>;
    const positions = orbTransform.p.k;
    const backgroundTransform = layers[1].ks as Record<string, { k: number[] }>;

    expect(positions).toHaveLength(13);
    expect(positions[0]).toMatchObject({ t: 0, i: { x: [1, 1, 1], y: [1, 1, 1] }, o: { x: [0, 0, 0], y: [0, 0, 0] } });
    expect(positions[0]).not.toHaveProperty("h");
    expect(positions.at(-1)).toEqual({ t: 12, s: expect.any(Array) });
    expect(backgroundTransform.a.k).toEqual([360, 240, 0]);
    expect(backgroundTransform.p.k).toEqual([360, 240, 0]);
  });
});
