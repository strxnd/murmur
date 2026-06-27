import { describe, expect, it } from "vitest";
import { shouldGuardConfigurationNavigation } from "./navigation-guard";

describe("shouldGuardConfigurationNavigation", () => {
  it("blocks leaving configuration while settings have unsaved edits", () => {
    expect(
      shouldGuardConfigurationNavigation({
        currentSection: "configuration",
        nextSection: "history",
        hasUnsavedConfigurationChanges: true
      })
    ).toBe(true);
  });

  it("does not block non-configuration navigation or saved configuration", () => {
    expect(
      shouldGuardConfigurationNavigation({
        currentSection: "history",
        nextSection: "models",
        hasUnsavedConfigurationChanges: true
      })
    ).toBe(false);
    expect(
      shouldGuardConfigurationNavigation({
        currentSection: "configuration",
        nextSection: "models",
        hasUnsavedConfigurationChanges: false
      })
    ).toBe(false);
  });
});
