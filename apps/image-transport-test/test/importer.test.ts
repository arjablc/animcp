import { describe, expect, it } from "vitest";
import { decodeBase64, inspectPng } from "../src/importer";

const transparentPixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

describe("PNG transport primitives", () => {
  it("decodes and identifies a valid PNG", () => {
    const bytes = decodeBase64(transparentPixel);

    expect(inspectPng(bytes)).toEqual({ width: 1, height: 1 });
  });

  it("rejects malformed base64 before image processing", () => {
    expect(() => decodeBase64("not-base64")).toThrow("not valid base64");
  });

  it("rejects decoded data that is not a PNG", () => {
    expect(() => inspectPng(decodeBase64("aGVsbG8="))).toThrow("not a PNG");
  });
});
