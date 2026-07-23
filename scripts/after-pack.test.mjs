import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const afterPack = require("./after-pack.cjs");
const { linuxLauncher, shouldForceXWayland } = afterPack;

describe("packaged native resources", () => {
  it("blocks a macOS package when an embedded Mach-O target is incompatible", async () => {
    await expect(afterPack({ electronPlatformName: "darwin", appOutDir: "/package" }, {
      verifyMacosDeploymentTargets: () => {
        throw new Error("requires macOS 14.0");
      }
    })).rejects.toThrow("requires macOS 14.0");
  });
});

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
