import { describe, expect, it } from "vitest";
import { layerValue, partValue, setLayerKeyframes, setPartKeyframes, setPartProperty, toggleLayerKeyframe, togglePartKeyframe } from "../src/editor/animation";
import type { Layer, SvgPart } from "../src/editor/model";
import { validViewBox, viewBoxFromDimensions } from "../src/svg/document";

const part: SvgPart = { id: "left-wheel", name: "left wheel", tag: "circle", fill: "#000000" };
const layer: Layer = { id: "car", assetId: "svg:car", type: "svg", name: "Car", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, fill: "#fff", visible: true, start: 0, duration: 5, svgParts: [part] };

describe("tagged SVG animation", () => {
  it("validates scalable SVG dimensions", () => {
    expect(validViewBox("0 0 1920 1080")).toBe(true);
    expect(validViewBox("0 0 0 10")).toBe(false);
    expect(viewBoxFromDimensions("320", "180")).toBe("0 0 320 180");
  });

  it("stores a property override on an exact tagged part", () => {
    const next = setPartProperty([layer], "car", "left-wheel", "fill", "#ff0000")[0];
    expect(next.partOverrides?.["left-wheel"]?.fill).toBe("#ff0000");
    expect(setPartProperty([layer], "car", "missing", "fill", "#ff0000")[0]).toBe(layer);
  });

  it("interpolates numeric and color keyframes", () => {
    let layers = setPartKeyframes([layer], "car", "left-wheel", "translateX", [{ time: 0, value: 0 }, { time: 2, value: 20 }]);
    layers = setPartKeyframes(layers, "car", "left-wheel", "fill", [{ time: 0, value: "#000000" }, { time: 2, value: "#ffffff" }]);
    expect(partValue(layers[0], part, "translateX", 1)).toBe(10);
    expect(partValue(layers[0], part, "fill", 1)).toBe("#808080");
  });

  it("toggles a keyframe at the playhead", () => {
    const added = togglePartKeyframe([layer], "car", "left-wheel", "opacity", 1, .5);
    expect(added[0].animations?.[0].keyframes).toEqual([{ time: 1, value: .5 }]);
    expect(togglePartKeyframe(added, "car", "left-wheel", "opacity", 1, .5)[0].animations).toEqual([]);
  });

  it("animates every whole-layer property", () => {
    let layers = setLayerKeyframes([layer], "car", "x", [{ time: 0, value: 0 }, { time: 2, value: 100 }]);
    layers = setLayerKeyframes(layers, "car", "fill", [{ time: 0, value: "#000000" }, { time: 2, value: "#ffffff" }]);
    expect(layerValue(layers[0], "x", 1)).toBe(50);
    expect(layerValue(layers[0], "fill", 1)).toBe("#808080");
    expect(toggleLayerKeyframe(layers, "car", "opacity", 1, 50)[0].animations?.at(-1)?.keyframes).toEqual([{ time: 1, value: 50 }]);
  });
});
