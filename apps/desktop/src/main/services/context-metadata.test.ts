import { describe, expect, it } from "vitest";
import {
  detectContextMetadataBackends,
  parseGnomeShellEvalOutput,
  parseHyprlandActiveWindow,
  parseX11ActiveWindow,
  type ContextCommandAvailability
} from "./context-metadata";

const allCommands: ContextCommandAvailability = {
  gdbus: true,
  hyprctl: true,
  qdbus: true,
  qdbus6: true,
  xdotool: true,
  xprop: true
};

describe("detectContextMetadataBackends", () => {
  it("detects Hyprland metadata when the native shortcut backend is available", () => {
    expect(
      detectContextMetadataBackends({
        commands: allCommands,
        env: {
          HYPRLAND_INSTANCE_SIGNATURE: "instance",
          XDG_CURRENT_DESKTOP: "Hyprland",
          XDG_SESSION_TYPE: "wayland"
        },
        platform: "linux"
      })
    ).toEqual(["hyprland"]);
  });

  it("detects KDE metadata only when D-Bus and qdbus are available", () => {
    expect(
      detectContextMetadataBackends({
        commands: { ...allCommands, qdbus6: false },
        env: {
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
          XDG_CURRENT_DESKTOP: "KDE",
          XDG_SESSION_TYPE: "wayland"
        },
        platform: "linux"
      })
    ).toEqual(["kde_kwin"]);

    expect(
      detectContextMetadataBackends({
        commands: allCommands,
        env: { XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland" },
        platform: "linux"
      })
    ).toEqual([]);
  });

  it("uses X11 tools before desktop-specific metadata on X11 sessions", () => {
    expect(
      detectContextMetadataBackends({
        commands: allCommands,
        env: {
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
          XDG_CURRENT_DESKTOP: "KDE",
          XDG_SESSION_TYPE: "x11"
        },
        platform: "linux"
      })
    ).toEqual(["x11", "kde_kwin"]);
  });
});

describe("active window metadata parsers", () => {
  it("parses Hyprland active window JSON", () => {
    expect(
      parseHyprlandActiveWindow(
        JSON.stringify({ address: "0x1234", class: "firefox", title: "Murmur docs - Mozilla Firefox" })
      )
    ).toEqual({
      appId: "firefox",
      appName: "firefox",
      windowId: "0x1234",
      windowTitle: "Murmur docs - Mozilla Firefox"
    });
  });

  it("parses GNOME Shell Eval output", () => {
    expect(
      parseGnomeShellEvalOutput(
        `(true, '{"appId":"org.gnome.Terminal","appName":"Gnome-terminal","windowId":"42","windowTitle":"Terminal"}')`
      )
    ).toEqual({
      appId: "org.gnome.Terminal",
      appName: "Gnome-terminal",
      windowId: "42",
      windowTitle: "Terminal"
    });
  });

  it("parses X11 WM_CLASS and title output", () => {
    expect(parseX11ActiveWindow("Inbox - Mozilla Firefox", 'WM_CLASS(STRING) = "Navigator", "firefox"', "73400327")).toEqual({
      appId: "firefox",
      appName: "firefox",
      windowId: "73400327",
      windowTitle: "Inbox - Mozilla Firefox"
    });
  });
});
