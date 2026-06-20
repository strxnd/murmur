import { spawn } from "node:child_process";

forceXWaylandForLinuxWayland();

require("./app-main.cjs");

function forceXWaylandForLinuxWayland(): void {
  if (process.platform !== "linux" || !isWaylandSession() || hasOzonePlatformX11(process.argv)) return;

  // Chromium chooses its display backend before Electron app code can create windows.
  spawn(process.execPath, [...process.argv.slice(1), "--ozone-platform=x11"], {
    detached: true,
    stdio: "inherit"
  }).unref();
  process.exit(0);
}

function isWaylandSession(): boolean {
  return process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY);
}

function hasOzonePlatformX11(args: readonly string[]): boolean {
  return args.some((arg, index) => arg === "--ozone-platform=x11" || (arg === "--ozone-platform" && args[index + 1] === "x11"));
}
