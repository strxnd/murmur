import { describe, expect, it } from "vitest";
import {
  hasUnsavedNavigationChanges,
  navigationGuardMessage,
  sectionIdFromPathname,
  shouldGuardNavigation
} from "./navigation-guard";

describe("shouldGuardNavigation", () => {
  it("blocks leaving configuration while settings have unsaved edits", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "configuration",
        nextSection: "history",
        hasUnsavedConfigurationChanges: true,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: false
      })
    ).toBe(true);
  });

  it("blocks leaving providers while credentials or endpoints are unsaved", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "providers",
        nextSection: "home",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: true
      })
    ).toBe(true);
  });

  it("blocks leaving modes while a draft or edit is unsaved", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "modes",
        nextSection: "home",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: true,
        hasUnsavedProviderChanges: false
      })
    ).toBe(true);
  });

  it("does not block unrelated navigation or a section without unsaved changes", () => {
    expect(
      shouldGuardNavigation({
        currentSection: "history",
        nextSection: "models",
        hasUnsavedConfigurationChanges: true,
        hasUnsavedModeChanges: true,
        hasUnsavedProviderChanges: false
      })
    ).toBe(false);
    expect(
      shouldGuardNavigation({
        currentSection: "configuration",
        nextSection: "models",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: false
      })
    ).toBe(false);
  });
});

describe("route navigation guard policy", () => {
  it("maps known route paths and tolerates trailing slashes", () => {
    expect(sectionIdFromPathname("/home")).toBe("home");
    expect(sectionIdFromPathname("/configuration/")).toBe("configuration");
    expect(sectionIdFromPathname("/unknown")).toBeNull();
  });

  it("returns the mode warning for any attempted route transition", () => {
    expect(
      navigationGuardMessage({
        currentPathname: "/modes",
        nextPathname: "/providers",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: true,
        hasUnsavedProviderChanges: false
      })
    ).toBe("You have an unsaved mode draft or edits. Discard them and switch views?");
  });

  it("returns the provider warning when leaving an unsaved provider form", () => {
    expect(
      navigationGuardMessage({
        currentPathname: "/providers",
        nextPathname: "/home",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: true
      })
    ).toBe("You have unsaved provider credentials or connection changes. Discard them and switch views?");
  });

  it("returns the configuration warning when navigating to an unknown route", () => {
    expect(
      navigationGuardMessage({
        currentPathname: "/configuration",
        nextPathname: "/not-a-route",
        hasUnsavedConfigurationChanges: true,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: false
      })
    ).toBe("You have unsaved configuration changes. Discard them and switch views?");
  });

  it("does not warn for same-route navigation or unknown current locations", () => {
    expect(
      navigationGuardMessage({
        currentPathname: "/modes",
        nextPathname: "/modes/",
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: true,
        hasUnsavedProviderChanges: false
      })
    ).toBeNull();
    expect(
      navigationGuardMessage({
        currentPathname: "/unknown",
        nextPathname: "/home",
        hasUnsavedConfigurationChanges: true,
        hasUnsavedModeChanges: true,
        hasUnsavedProviderChanges: false
      })
    ).toBeNull();
  });

  it("enables unload protection while either guarded view is dirty", () => {
    expect(
      hasUnsavedNavigationChanges({
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: true,
        hasUnsavedProviderChanges: false
      })
    ).toBe(true);
    expect(
      hasUnsavedNavigationChanges({
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: true
      })
    ).toBe(true);
    expect(
      hasUnsavedNavigationChanges({
        hasUnsavedConfigurationChanges: false,
        hasUnsavedModeChanges: false,
        hasUnsavedProviderChanges: false
      })
    ).toBe(false);
  });
});
