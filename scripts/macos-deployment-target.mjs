#!/usr/bin/env node
import { execFile } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const macosDeploymentTarget = "13.0";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const machOMagic = new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);

export async function inspectMacOSDeploymentTargets(roots, options = {}) {
  const maxVersion = options.maxVersion ?? macosDeploymentTarget;
  const runCommand = options.runCommand ?? runVtool;
  const files = [];

  for (const root of roots) files.push(...(await findMachOFiles(root)));

  const uniqueFiles = [...new Set(files)].sort();
  if (uniqueFiles.length === 0) throw new Error(`No Mach-O files found under: ${roots.join(", ")}`);

  const results = [];
  const violations = [];
  for (const file of uniqueFiles) {
    const output = await runCommand(file);
    const versions = parseMacOSDeploymentTargets(output);
    if (versions.length === 0) throw new Error(`Mach-O file has no macOS deployment target: ${file}`);

    const tooNew = versions.filter((version) => compareVersions(version, maxVersion) > 0);
    if (tooNew.length > 0) violations.push(`${displayPath(file)} requires ${tooNew.join(", ")} (maximum ${maxVersion})`);
    results.push({ file, versions });
  }

  if (violations.length > 0) {
    throw new Error(`Mach-O deployment target check failed:\n${violations.map((violation) => `- ${violation}`).join("\n")}`);
  }

  return results;
}

export function parseMacOSDeploymentTargets(output) {
  const versions = [];
  let loadCommand = null;

  for (const line of output.split(/\r?\n/)) {
    if (/^Load command \d+/.test(line.trim())) {
      loadCommand = null;
      continue;
    }

    const commandMatch = line.match(/^\s*cmd\s+(LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX)\s*$/);
    if (commandMatch) {
      loadCommand = commandMatch[1];
      continue;
    }

    const versionMatch =
      loadCommand === "LC_BUILD_VERSION"
        ? line.match(/^\s*minos\s+(\d+(?:\.\d+){1,2})\s*$/)
        : loadCommand === "LC_VERSION_MIN_MACOSX"
          ? line.match(/^\s*version\s+(\d+(?:\.\d+){1,2})\s*$/)
          : null;
    if (versionMatch) versions.push(versionMatch[1]);
  }

  return [...new Set(versions)];
}

export function swiftTargetForArch(arch, deploymentTarget = macosDeploymentTarget) {
  const architecture = arch === "arm64" ? "arm64" : arch === "x64" ? "x86_64" : null;
  if (!architecture) throw new Error(`Unsupported macOS architecture: ${arch}`);
  return `${architecture}-apple-macosx${deploymentTarget}`;
}

export function cmakeMacOSCompatibilityArgs(platformKey, deploymentTarget = macosDeploymentTarget) {
  return platformKey.startsWith("darwin-")
    ? [`-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`, "-DGGML_BLAS=OFF"]
    : [];
}

async function findMachOFiles(root) {
  const rootStats = await stat(root).catch(() => null);
  if (!rootStats) throw new Error(`Deployment target root does not exist: ${root}`);
  if (rootStats.isFile()) return (await isMachO(root)) ? [root] : [];
  if (!rootStats.isDirectory()) return [];

  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await findMachOFiles(path)));
    else if (entry.isFile() && (await isMachO(path))) files.push(path);
  }
  return files;
}

async function isMachO(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === 4 && machOMagic.has(buffer.toString("hex"));
  } finally {
    await handle.close();
  }
}

async function runVtool(path) {
  const { stdout } = await execFileAsync("vtool", ["-show-build", path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function displayPath(path) {
  const pathFromRoot = relative(repoRoot, path);
  return pathFromRoot && !pathFromRoot.startsWith("..") ? pathFromRoot.split(sep).join("/") : path;
}
