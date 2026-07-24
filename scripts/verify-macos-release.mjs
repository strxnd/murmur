import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function findPackagedMacosApps(root) {
  const apps = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(".app")) {
        apps.push(path);
      } else {
        visit(path);
      }
    }
  };
  visit(root);
  return apps.sort();
}

export function verifyPackagedMacosApp(appPath, run = spawnSync) {
  const checks = [
    ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]],
    ["xcrun", ["stapler", "validate", appPath]],
    ["spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]]
  ];
  for (const [command, args] of checks) {
    const result = run(command, args, { encoding: "utf8", stdio: "pipe" });
    if (result.status === 0) continue;
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || `exit ${result.status ?? "unknown"}`).trim()}`
    );
  }
}

export function verifyMacosRelease(root = resolve(repoRoot, "dist"), platform = process.platform) {
  if (platform !== "darwin") return [];
  const apps = findPackagedMacosApps(root);
  if (apps.length === 0) throw new Error(`No packaged macOS application was found under ${root}.`);
  for (const appPath of apps) verifyPackagedMacosApp(appPath);
  return apps;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const apps = verifyMacosRelease();
    process.stdout.write(
      process.platform === "darwin"
        ? `Verified Developer ID signature, notarization ticket, and Gatekeeper assessment for ${apps.join(", ")}\n`
        : "Skipping macOS release verification on non-macOS host.\n"
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
