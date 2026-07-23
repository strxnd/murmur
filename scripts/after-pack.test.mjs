import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { linuxLauncher, shouldForceXWayland } = require("./after-pack.cjs");

describe("Linux packaged launcher", () => {
  it("keeps native Wayland when the packaged app has no X11 display", () => {
    expect(shouldForceXWayland({
      WAYLAND_DISPLAY: "wayland-0",
      XDG_SESSION_TYPE: "wayland"
    })).toBe(false);
  });

  it("selects XWayland only when a Wayland session exposes X11", () => {
    expect(shouldForceXWayland({
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_SESSION_TYPE: "wayland"
    })).toBe(true);

    const launcher = linuxLauncher("murmur");
    expect(launcher).toContain("} && [ -n \"${DISPLAY:-}\" ]; then");
    expect(launcher).toContain("FLAGS+=(--ozone-platform=x11)");
  });
});
