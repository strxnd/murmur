export type SupportedPlatform = "linux" | "darwin";

export function isSupportedPlatform(platform: NodeJS.Platform = process.platform): platform is SupportedPlatform {
  return platform === "linux" || platform === "darwin";
}

export function unsupportedPlatformMessage(platform: NodeJS.Platform | string = process.platform): string {
  return `Murmur supports Linux and macOS 13 or later. Platform "${platform}" is not supported.`;
}
