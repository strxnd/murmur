import { spawn } from "node:child_process";
import { shouldForceXWayland } from "./linux-display-backend";

if (!forceXWaylandForLinuxWayland()) {
  require("./app-main.cjs");
}

function forceXWaylandForLinuxWayland(): boolean {
  if (!shouldForceXWayland(process.platform, process.argv, process.env)) {
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
