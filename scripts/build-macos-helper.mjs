import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectMacOSDeploymentTargets,
  macosDeploymentTarget,
  swiftTargetForArch
} from "./macos-deployment-target.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repoRoot, "resources", "macos", "MurmurAutomationHelper.swift");
const output = join(repoRoot, "resources", "bin", "murmur-macos-helper");

if (process.platform !== "darwin") {
  process.stdout.write("Skipping macOS helper build on non-macOS host.\n");
  process.exit(0);
}

await mkdir(dirname(output), { recursive: true });

const result = spawnSync(
  "swiftc",
  ["-O", "-target", swiftTargetForArch(process.arch), source, "-o", output],
  { encoding: "utf8", stdio: "pipe" }
);
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

await inspectMacOSDeploymentTargets([output]);
process.stdout.write(`Built ${output} for macOS ${macosDeploymentTarget}+\n`);
