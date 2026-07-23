const fs = require("node:fs");
const path = require("node:path");
const macosDeployment = require("./macos-deployment-target.cjs");

async function afterPack(context, dependencies = {}) {
  if (context.electronPlatformName === "darwin") {
    const verify = dependencies.verifyMacosDeploymentTargets ?? macosDeployment.verifyMacosDeploymentTargets;
    verify(context.appOutDir);
    return;
  }
  if (context.electronPlatformName !== "linux") return;

  const appDir = context.appOutDir;
  const binaryName = context.packager.executableName;
  const binaryPath = path.join(appDir, binaryName);
  const realBinaryPath = path.join(appDir, `${binaryName}-app`);

  if (!fs.existsSync(binaryPath) || fs.existsSync(realBinaryPath)) return;

  fs.renameSync(binaryPath, realBinaryPath);
  fs.writeFileSync(binaryPath, linuxLauncher(binaryName), { mode: 0o755 });
}

function shouldForceXWayland(environment) {
  return (environment.XDG_SESSION_TYPE === "wayland" || Boolean(environment.WAYLAND_DISPLAY))
    && Boolean(environment.DISPLAY);
}

function linuxLauncher(binaryName) {
  return `#!/usr/bin/env bash
# Murmur launcher
# User flags: ~/.config/${binaryName}-flags.conf (one per line, # = comment)

HERE="$(dirname "$(readlink -f "\${BASH_SOURCE[0]}")")"
FLAGS=()

# Prefer XWayland for overlay positioning only when an X11 display is available.
if { [ "\${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "\${WAYLAND_DISPLAY:-}" ]; } && [ -n "\${DISPLAY:-}" ]; then
  FLAGS+=(--ozone-platform=x11)
  export MURMUR_XWAYLAND_RELAUNCHED=1
fi

FLAGS_FILE="\${XDG_CONFIG_HOME:-$HOME/.config}/${binaryName}-flags.conf"
if [ -f "$FLAGS_FILE" ]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    FLAGS+=("$line")
  done < "$FLAGS_FILE"
fi

exec -a "$0" "$HERE/${binaryName}-app" "\${FLAGS[@]}" "$@"
`;
}

module.exports = afterPack;
module.exports.linuxLauncher = linuxLauncher;
module.exports.shouldForceXWayland = shouldForceXWayland;
