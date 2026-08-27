import { describe, expect, it } from "vitest";
import { formatTime } from "../src/App";

describe("editor timeline", () => {
  it("formats seconds as a 30 fps timecode", () => {
    expect(formatTime(1.5)).toBe("00:01:15");
  });
});
