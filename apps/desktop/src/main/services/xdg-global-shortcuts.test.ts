import { describe, expect, it } from "vitest";
import {
  acceleratorToPortalTrigger,
  shortcutDescriptionForActivationMode,
  shortcutDescriptionForModeSelector,
  shortcutPropertiesForPortalVersion
} from "./xdg-global-shortcuts";

describe("acceleratorToPortalTrigger", () => {
  it("maps supported Electron accelerators to portal triggers", () => {
    expect(acceleratorToPortalTrigger("Alt+R")).toBe("ALT+r");
    expect(acceleratorToPortalTrigger("CommandOrControl+Alt+Space")).toBe("CTRL+ALT+space");
    expect(acceleratorToPortalTrigger("Super+Shift+F9")).toBe("LOGO+SHIFT+F9");
    expect(acceleratorToPortalTrigger("CommandOrControl+Left")).toBe("CTRL+Left");
    expect(acceleratorToPortalTrigger("Shift+Return")).toBe("SHIFT+Return");
    expect(acceleratorToPortalTrigger("Alt+,")).toBe("ALT+comma");
    expect(acceleratorToPortalTrigger("Alt+Shift+K")).toBe("ALT+SHIFT+k");
  });

  it("rejects unsupported accelerators", () => {
    expect(acceleratorToPortalTrigger("AltGr+R")).toBeNull();
    expect(acceleratorToPortalTrigger("VolumeUp")).toBeNull();
    expect(acceleratorToPortalTrigger("Alt+VolumeUp")).toBeNull();
    expect(acceleratorToPortalTrigger("CommandOrControl+Alt")).toBeNull();
    expect(acceleratorToPortalTrigger("CommandOrControl+A+B")).toBeNull();
  });

  it("normalizes duplicate modifiers", () => {
    expect(acceleratorToPortalTrigger("Alt+Alt+R")).toBe("ALT+r");
    expect(acceleratorToPortalTrigger("CommandOrControl+Control+Space")).toBe("CTRL+space");
  });

  it("maps CommandOrControl to CTRL on Linux portal triggers", () => {
    expect(acceleratorToPortalTrigger("CommandOrControl+K")).toBe("CTRL+k");
  });
});

describe("shortcutDescriptionForActivationMode", () => {
  it("chooses the portal description for each activation mode", () => {
    expect(shortcutDescriptionForActivationMode("push_to_talk")).toBe("Push to talk with Murmur");
    expect(shortcutDescriptionForActivationMode("toggle")).toBe("Toggle Murmur recording");
    expect(shortcutDescriptionForModeSelector()).toBe("Show Murmur mode selector");
  });
});

describe("shortcutPropertiesForPortalVersion", () => {
  it("omits preferred triggers for portal versions that do not support them", () => {
    expect(shortcutPropertiesForPortalVersion("Toggle Murmur recording", "CTRL+ALT+space", 1)).toEqual([
      ["description", ["s", "Toggle Murmur recording"]]
    ]);
  });

  it("includes preferred triggers for portal versions that support them", () => {
    expect(shortcutPropertiesForPortalVersion("Toggle Murmur recording", "CTRL+ALT+space", 2)).toEqual([
      ["description", ["s", "Toggle Murmur recording"]],
      ["preferred_trigger", ["s", "CTRL+ALT+space"]]
    ]);
  });
});
