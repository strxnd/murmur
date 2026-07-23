import { describe, expect, it } from "vitest";
import { shouldForceXWayland } from "./linux-display-backend";

describe("shouldForceXWayland", () => {
  it("keeps native Wayland when X11 is unavailable", () => {
    expect(shouldForceXWayland("linux", ["electron"], {
      WAYLAND_DISPLAY: "wayland-0",
      XDG_SESSION_TYPE: "wayland"
    })).toBe(false);
  });

  it("uses XWayland when a Wayland session also exposes X11", () => {
    expect(shouldForceXWayland("linux", ["electron"], {
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_SESSION_TYPE: "wayland"
    })).toBe(true);
  });

  it("does not relaunch when X11 was already selected", () => {
    const env = {
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_SESSION_TYPE: "wayland"
    };

    expect(shouldForceXWayland("linux", ["electron", "--ozone-platform=x11"], env)).toBe(false);
    expect(shouldForceXWayland("linux", ["electron", "--ozone-platform", "x11"], env)).toBe(false);
    expect(shouldForceXWayland("linux", ["electron"], { ...env, MURMUR_XWAYLAND_RELAUNCHED: "1" })).toBe(false);
  });

  it("does not alter non-Linux or non-Wayland launches", () => {
    expect(shouldForceXWayland("darwin", ["electron"], { DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" })).toBe(false);
    expect(shouldForceXWayland("linux", ["electron"], { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" })).toBe(false);
  });
});
