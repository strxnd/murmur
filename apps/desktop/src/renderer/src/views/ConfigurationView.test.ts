import { describe, expect, it } from "vitest";
import { editableSettingsKeys } from "./ConfigurationView";

describe("ConfigurationView privacy settings", () => {
  it("persists the selected-text capture control with normal settings", () => {
    expect(editableSettingsKeys).toContain("selectedTextCapture");
  });
});
