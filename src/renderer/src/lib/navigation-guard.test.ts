import { describe, expect, it } from "vitest";
import { shouldGuardNavigation } from "./navigation-guard";

describe("shouldGuardNavigation", () => {
  it("blocks leaving configuration while settings have unsaved edits", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "configuration",
        nextSection: "history",
        hasUnsavedConfigurationChanges: true,
        hasUnsavedModeChanges: false
      })
    ).toBe(true);
  });

  it("blocks leaving modes while a draft or edit is unsaved", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "modes",
        nextSection: "home",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: true
      })
    ).toBe(true);
  });

  it("does not block unrelated navigation or a section without unsaved changes", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "history",
        nextSection: "models",
        hasUnsavedConfigurationChanges: true,
        hasUnsavedModeChanges: true
      })
    ).toBe(false);
    expect(
      shouldGuardNavigation({
        currentSection: "configuration",
        nextSection: "models",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: false
      })
    ).toBe(false);
  });
});
