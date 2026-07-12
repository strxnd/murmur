import { access, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanAll = process.argv.includes("--all");

const baseTargets = [
  "apps/desktop/out",
  "dist",
  "release",
  "build/Release",
  ".cache/bundled-runtimes",
  "resources/bin/linux-fast-paste"
];

const allTargets = [".cache", "vendor/runtimes"];
const targets = cleanAll ? [...baseTargets.filter((target) => !target.startsWith(".cache/")), ...allTargets] : baseTargets;

for (const target of targets) {
  const absolute = resolve(repoRoot, target);
  if (!absolute.startsWith(`${repoRoot}${sep}`)) {
    throw new Error(`Refusing to clean path outside repo: ${target}`);
  }

  if (!(await exists(absolute))) {
    console.log(`skipped ${target}`);
    continue;
  }

  await rm(absolute, { recursive: true, force: true });
  console.log(`removed ${target}`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
