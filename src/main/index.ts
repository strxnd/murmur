import { spawn } from "node:child_process";

if (!forceXWaylandForLinuxWayland()) {
  require("./app-main.cjs");
}

function forceXWaylandForLinuxWayland(): boolean {
  if (process.platform !== "linux" || !isWaylandSession() || hasOzonePlatformX11(process.argv) || process.env.MURMUR_XWAYLAND_RELAUNCHED === "1") {
    return false;
  }

  // Chromium chooses its display backend before Electron app code can create windows.
  const child = spawn(process.execPath, ["--ozone-platform=x11", ...process.argv.slice(1)], {
    env: { ...process.env, MURMUR_XWAYLAND_RELAUNCHED: "1" },
    stdio: "inherit"
  });
  const exitWithChild = (code: number | null): never => {
    process.exit(code ?? 0);
  };
  const stopChild = (): void => {
    if (!child.killed) child.kill();
  };
  child.on("exit", exitWithChild);
  process.once("SIGINT", stopChild);
  process.once("SIGTERM", stopChild);
  return true;
}

function isWaylandSession(): boolean {
  return process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY);
}

function hasOzonePlatformX11(args: readonly string[]): boolean {
  return args.some((arg, index) => arg === "--ozone-platform=x11" || (arg === "--ozone-platform" && args[index + 1] === "x11"));
}
