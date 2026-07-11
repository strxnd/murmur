import { describe, expect, it } from "vitest";
import { defaultModes, modePresets } from "./defaults";

describe("mode presets", () => {
  it("offers the five familiar presets and a blank custom preset", () => {
    expect(modePresets.map((preset) => preset.id)).toEqual([
      "default",
      "voice_to_text",
      "message",
      "mail",
      "note",
      "custom"
    ]);
  });

  it("seeds familiar modes without persisting the custom template", () => {
    expect(defaultModes.map((mode) => mode.id)).toEqual(["default", "voice_to_text", "message", "mail", "note"]);
    expect(defaultModes.every((mode) => !("kind" in mode))).toBe(true);
  });
});
