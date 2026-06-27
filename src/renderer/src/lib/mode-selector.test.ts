import { describe, expect, it } from "vitest";
import { modeSelectorOptionId } from "./mode-selector";

describe("modeSelectorOptionId", () => {
  it("creates stable DOM ids for arbitrary mode ids", () => {
    expect(modeSelectorOptionId("voice_to_text")).toBe("mode-selector-option-voice_to_text");
    expect(modeSelectorOptionId("custom mode/with spaces")).toBe("mode-selector-option-custom_mode_with_spaces");
  });
});
