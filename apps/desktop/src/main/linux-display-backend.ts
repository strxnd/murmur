export interface LinuxDisplayEnvironment {
  DISPLAY?: string;
  MURMUR_XWAYLAND_RELAUNCHED?: string;
  WAYLAND_DISPLAY?: string;
  XDG_SESSION_TYPE?: string;
}

export function shouldForceXWayland(
  platform: NodeJS.Platform,
  args: readonly string[],
  env: LinuxDisplayEnvironment
): boolean {
  return platform === "linux"
    && isWaylandSession(env)
    && Boolean(env.DISPLAY)
    && !hasOzonePlatformX11(args)
    && env.MURMUR_XWAYLAND_RELAUNCHED !== "1";
}

function isWaylandSession(env: LinuxDisplayEnvironment): boolean {
  return env.XDG_SESSION_TYPE === "wayland" || Boolean(env.WAYLAND_DISPLAY);
}

function hasOzonePlatformX11(args: readonly string[]): boolean {
  return args.some((arg, index) => arg === "--ozone-platform=x11" || (arg === "--ozone-platform" && args[index + 1] === "x11"));
}
