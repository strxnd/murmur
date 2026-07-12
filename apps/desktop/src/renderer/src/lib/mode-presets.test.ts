import { describe, expect, it } from "vitest";
import { modePresets } from "../../../shared/defaults";
import { matchingModePresetId, modeFromPreset } from "./mode-presets";

describe("mode presets", () => {
  it("applies a preset while preserving the mode id", () => {
    const mailPreset = modePresets.find((preset) => preset.id === "mail")!;

    expect(modeFromPreset(mailPreset, "mode-existing")).toMatchObject({
      id: "mode-existing",
      name: "Mail",
      iconKey: "mail",
      instructionPrompt: mailPreset.instructionPrompt
    });
  });

  it("recognizes an unchanged preset and treats edits as custom", () => {
    const notePreset = modePresets.find((preset) => preset.id === "note")!;
    const noteMode = modeFromPreset(notePreset, "mode-note");

    expect(matchingModePresetId(noteMode, modePresets)).toBe("note");
    expect(matchingModePresetId({ ...noteMode, instructionPrompt: "Use paragraphs." }, modePresets)).toBe("custom");
  });

  it("creates a blank custom mode", () => {
    const customPreset = modePresets.find((preset) => preset.id === "custom")!;

    expect(modeFromPreset(customPreset, "mode-new")).toMatchObject({
      id: "mode-new",
      name: "New mode",
      description: "",
      instructionPrompt: ""
    });
  });
});
