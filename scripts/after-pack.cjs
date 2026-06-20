const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;

  const appDir = context.appOutDir;
  const binaryName = context.packager.executableName;
  const binaryPath = path.join(appDir, binaryName);
  const realBinaryPath = path.join(appDir, `${binaryName}-app`);

  if (!fs.existsSync(binaryPath) || fs.existsSync(realBinaryPath)) return;

  fs.renameSync(binaryPath, realBinaryPath);
  fs.writeFileSync(binaryPath, linuxLauncher(binaryName), { mode: 0o755 });
};

function linuxLauncher(binaryName) {
  return `#!/usr/bin/env bash
# Murmur launcher
# User flags: ~/.config/${binaryName}-flags.conf (one per line, # = comment)

HERE="$(dirname "$(readlink -f "\${BASH_SOURCE[0]}")")"
FLAGS=()

# Wayland: force XWayland because Electron overlay positioning/focus hints
# are not reliable for normal native Wayland toplevel windows.
if [ "\${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "\${WAYLAND_DISPLAY:-}" ]; then
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
