import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../../shared/defaults";
import {
  editableSettingsKeys,
  reconcileConfigurationSave,
  shouldReconcileConfigurationSnapshot
} from "./ConfigurationView";

describe("ConfigurationView privacy settings", () => {
  it("persists the selected-text capture control with normal settings", () => {
    expect(editableSettingsKeys).toContain("selectedTextCapture");
  });

  it("keeps snapshot reconciliation paused for the full save request", () => {
    expect(shouldReconcileConfigurationSnapshot(true, false)).toBe(false);
    expect(shouldReconcileConfigurationSnapshot(false, false)).toBe(true);
  });

  it("keeps edits made after a save submission as a dirty draft", () => {
    const submittedValues = { settings: { ...defaultSettings, theme: "dark" as const } };
    const currentValues = { settings: { ...submittedValues.settings, typingBaselineWpm: 87 } };

    const reconciliation = reconcileConfigurationSave(submittedValues, currentValues);

    expect(reconciliation.persistedValues.settings).toEqual(submittedValues.settings);
    expect(reconciliation.draftValues.settings).toEqual(currentValues.settings);
    expect(reconciliation.draftValues.settings.typingBaselineWpm).not.toBe(
      reconciliation.persistedValues.settings.typingBaselineWpm
    );
  });
});
