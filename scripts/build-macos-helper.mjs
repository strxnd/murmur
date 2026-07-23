import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import macosDeployment from "./macos-deployment-target.cjs";

const {
  MACOS_DEPLOYMENT_TARGET,
  inspectMacosDeploymentTargets,
  swiftTargetTriple
} = macosDeployment;

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
  ["-O", "-target", swiftTargetTriple(process.arch), source, "-o", output],
  {
    encoding: "utf8",
    env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: MACOS_DEPLOYMENT_TARGET },
    stdio: "pipe"
  }
);
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const targets = inspectMacosDeploymentTargets(output);
if (targets.some((target) => macosDeployment.compareVersions(target, MACOS_DEPLOYMENT_TARGET) > 0)) {
  throw new Error(`Built helper requires macOS ${targets.join(", ")}; expected ${MACOS_DEPLOYMENT_TARGET} or older.`);
}

process.stdout.write(`Built ${output} for macOS ${MACOS_DEPLOYMENT_TARGET}\n`);
