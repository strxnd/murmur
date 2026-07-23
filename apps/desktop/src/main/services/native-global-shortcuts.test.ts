import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../shared/defaults";
import {
  acceleratorToGnomeShortcut,
  acceleratorToHyprlandBinding,
  acceleratorToKdeQtKey,
  detectNativeShortcutBackends,
  findGnomeBindingInSettingsOutput,
  isAuthorizedNativeShortcutCallback,
  nativeShortcutCallbackCommand
} from "./native-global-shortcuts";

describe("detectNativeShortcutBackends", () => {
  it("detects GNOME-like desktops", () => {
    expect(detectNativeShortcutBackends({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" }, "linux")).toEqual([
      "gnome_custom_shortcut"
    ]);
    expect(detectNativeShortcutBackends({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME", XDG_SESSION_TYPE: "wayland" }, "linux")).toEqual([
      "gnome_custom_shortcut"
    ]);
  });

  it("detects Hyprland only on Wayland", () => {
    expect(
      detectNativeShortcutBackends(
        { HYPRLAND_INSTANCE_SIGNATURE: "instance", XDG_CURRENT_DESKTOP: "Hyprland", XDG_SESSION_TYPE: "wayland" },
        "linux"
      )
    ).toEqual(["hyprland_bind"]);
    expect(
      detectNativeShortcutBackends(
        { HYPRLAND_INSTANCE_SIGNATURE: "instance", XDG_CURRENT_DESKTOP: "Hyprland", XDG_SESSION_TYPE: "x11" },
        "linux"
      )
    ).toEqual([]);
  });

  it("detects KDE", () => {
    expect(detectNativeShortcutBackends({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland" }, "linux")).toEqual([
      "kde_kglobalaccel"
    ]);
  });
});

describe("acceleratorToGnomeShortcut", () => {
  it("maps Electron accelerators to GNOME custom shortcut syntax", () => {
    expect(acceleratorToGnomeShortcut("Alt+R")).toBe("<Alt>r");
    expect(acceleratorToGnomeShortcut("CommandOrControl+Alt+Space")).toBe("<Control><Alt>space");
    expect(acceleratorToGnomeShortcut("Super+Shift+F9")).toBe("<Super><Shift>F9");
    expect(acceleratorToGnomeShortcut("CommandOrControl+Left")).toBe("<Control>Left");
    expect(acceleratorToGnomeShortcut("Alt+,")).toBe("<Alt>comma");
    expect(acceleratorToGnomeShortcut("Alt+Shift+K")).toBe("<Alt><Shift>k");
  });

  it("rejects unsupported GNOME shortcuts", () => {
    expect(acceleratorToGnomeShortcut("AltGr+R")).toBeNull();
    expect(acceleratorToGnomeShortcut("VolumeUp")).toBeNull();
    expect(acceleratorToGnomeShortcut("CommandOrControl+Alt")).toBeNull();
    expect(acceleratorToGnomeShortcut("CommandOrControl+A+B")).toBeNull();
  });

  it("normalizes duplicate modifiers", () => {
    expect(acceleratorToGnomeShortcut("Alt+Alt+R")).toBe("<Alt>r");
    expect(acceleratorToGnomeShortcut("CommandOrControl+Control+Space")).toBe("<Control>space");
  });
});

describe("acceleratorToHyprlandBinding", () => {
  it("maps Electron accelerators to Hyprland bind syntax", () => {
    expect(acceleratorToHyprlandBinding("Alt+R")).toMatchObject({ bindKey: "ALT, R" });
    expect(acceleratorToHyprlandBinding("CommandOrControl+Alt+Space")).toMatchObject({ bindKey: "CTRL ALT, space" });
    expect(acceleratorToHyprlandBinding("Super+Shift+F9")).toMatchObject({ bindKey: "SUPER SHIFT, F9" });
    expect(acceleratorToHyprlandBinding("CommandOrControl+Left")).toMatchObject({ bindKey: "CTRL, Left" });
    expect(acceleratorToHyprlandBinding("Alt+,")).toMatchObject({ bindKey: "ALT, comma" });
    expect(acceleratorToHyprlandBinding("Alt+Shift+K")).toMatchObject({ bindKey: "ALT SHIFT, K" });
  });

  it("supports modifier-only combinations by using the last modifier as the trigger key", () => {
    expect(acceleratorToHyprlandBinding("CommandOrControl+Super")).toMatchObject({ bindKey: "CTRL, Super_L" });
  });

  it("rejects unsupported Hyprland shortcuts", () => {
    expect(acceleratorToHyprlandBinding("AltGr+R")).toBeNull();
    expect(acceleratorToHyprlandBinding("VolumeUp")).toBeNull();
    expect(acceleratorToHyprlandBinding("Super")).toBeNull();
    expect(acceleratorToHyprlandBinding("CommandOrControl+A+B")).toBeNull();
  });
});

describe("native shortcut callback authorization", () => {
  it("requires the per-registration capability in exported D-Bus callbacks", () => {
    expect(isAuthorizedNativeShortcutCallback("secret", undefined)).toBe(false);
    expect(isAuthorizedNativeShortcutCallback("secret", "wrong")).toBe(false);
    expect(isAuthorizedNativeShortcutCallback("secret", "secret")).toBe(true);
    expect(nativeShortcutCallbackCommand("Activate", "secret")).toContain("string:secret");
  });
});

describe("GNOME built-in shortcut conflicts", () => {
  it("uses a default that does not collide with GNOME's window menu", () => {
    expect(defaultSettings.activationHotkey).toBe("Alt+Shift+R");
  });

  it("finds accelerators owned by built-in GNOME schemas", () => {
    const output = [
      "org.gnome.desktop.wm.keybindings activate-window-menu ['<Alt>space']",
      "org.gnome.desktop.wm.keybindings close ['<Alt>F4']"
    ].join("\n");

    expect(findGnomeBindingInSettingsOutput(output, "<alt>space")).toBe("activate-window-menu");
    expect(findGnomeBindingInSettingsOutput(output, "<alt><shift>r")).toBeNull();
  });
});

describe("acceleratorToKdeQtKey", () => {
  it("maps Electron accelerators to KDE Qt key codes", () => {
    expect(acceleratorToKdeQtKey("Alt+R")).toBe(0x08000000 | 0x52);
    expect(acceleratorToKdeQtKey("CommandOrControl+Alt+Space")).toBe(0x04000000 | 0x08000000 | 0x20);
    expect(acceleratorToKdeQtKey("Super+Shift+F9")).toBe(0x10000000 | 0x02000000 | 0x01000038);
    expect(acceleratorToKdeQtKey("CommandOrControl+Left")).toBe(0x04000000 | 0x01000012);
    expect(acceleratorToKdeQtKey("Alt+,")).toBe(0x08000000 | 0x2c);
    expect(acceleratorToKdeQtKey("Alt+Shift+K")).toBe(0x08000000 | 0x02000000 | 0x4b);
  });

  it("supports modifier-only combinations and normalizes duplicate modifiers", () => {
    expect(acceleratorToKdeQtKey("CommandOrControl+Super")).toBe(0x04000000 | 0x10000000);
    expect(acceleratorToKdeQtKey("Alt+Alt+R")).toBe(0x08000000 | 0x52);
  });

  it("rejects unsupported KDE shortcuts", () => {
    expect(acceleratorToKdeQtKey("AltGr+R")).toBeNull();
    expect(acceleratorToKdeQtKey("VolumeUp")).toBeNull();
    expect(acceleratorToKdeQtKey("CommandOrControl+A+B")).toBeNull();
  });
});
