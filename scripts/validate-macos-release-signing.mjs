import { pathToFileURL } from "node:url";

const requiredVariables = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];

export function validateMacosReleaseSigningEnvironment(env = process.env, platform = process.platform) {
  if (platform !== "darwin") return [];
  return requiredVariables.filter((name) => !env[name]?.trim());
}

export function assertMacosReleaseSigningEnvironment(env = process.env, platform = process.platform) {
  const missing = validateMacosReleaseSigningEnvironment(env, platform);
  if (missing.length === 0) return;
  throw new Error(
    `Signed macOS release packaging requires these environment variables: ${missing.join(", ")}. Use bun run dist for explicitly unsigned development artifacts.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    assertMacosReleaseSigningEnvironment();
    process.stdout.write(
      process.platform === "darwin"
        ? "macOS release signing and notarization credentials are configured.\n"
        : "Skipping macOS release signing validation on non-macOS host.\n"
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
