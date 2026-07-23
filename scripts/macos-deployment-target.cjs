const { spawnSync } = require("node:child_process");
const {
  closeSync,
  openSync,
  readSync,
  readdirSync
} = require("node:fs");
const path = require("node:path");

const MACOS_DEPLOYMENT_TARGET = "13.0";
const MACH_O_MAGICS = new Set([
  "cafebabe",
  "cafebabf",
  "cefaedfe",
  "cffaedfe",
  "bebafeca",
  "bfbafeca",
  "feedface",
  "feedfacf"
]);

function swiftTargetTriple(arch) {
  const targetArch = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!targetArch) throw new Error(`Unsupported macOS architecture ${arch}.`);
  return `${targetArch}-apple-macosx${MACOS_DEPLOYMENT_TARGET}`;
}

function cmakeDeploymentTargetArgs(platformKey) {
  return platformKey.startsWith("darwin-")
    ? [`-DCMAKE_OSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}`]
    : [];
}

function parseMacosDeploymentTargets(output) {
  const targets = [];
  let readsLegacyMinimum = false;

  for (const line of output.split("\n")) {
    const command = line.match(/^\s*cmd\s+(LC_[A-Z0-9_]+)\s*$/);
    if (command) {
      readsLegacyMinimum = command[1] === "LC_VERSION_MIN_MACOSX";
      continue;
    }

    const modernMinimum = line.match(/^\s*minos\s+(\d+(?:\.\d+){0,2})\s*$/);
    if (modernMinimum) {
      targets.push(modernMinimum[1]);
      continue;
    }

    const legacyMinimum = readsLegacyMinimum
      ? line.match(/^\s*version\s+(\d+(?:\.\d+){0,2})\s*$/)
      : null;
    if (legacyMinimum) {
      targets.push(legacyMinimum[1]);
      readsLegacyMinimum = false;
    }
  }

  return targets;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function inspectMacosDeploymentTargets(filePath, run = spawnSync) {
  const result = run("xcrun", ["vtool", "-show-build", filePath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`vtool failed for ${filePath}: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }

  const targets = parseMacosDeploymentTargets(result.stdout);
  if (targets.length === 0) {
    throw new Error(`No macOS deployment target metadata found in ${filePath}.`);
  }
  return targets;
}

function verifyMacosDeploymentTargets(root, options = {}) {
  const inspect = options.inspect ?? inspectMacosDeploymentTargets;
  const maximum = options.maximum ?? MACOS_DEPLOYMENT_TARGET;
  const failures = [];

  for (const filePath of findMachOFiles(root)) {
    try {
      const incompatible = inspect(filePath).filter((target) => compareVersions(target, maximum) > 0);
      if (incompatible.length > 0) {
        failures.push(`${path.relative(root, filePath)} requires macOS ${incompatible.join(", ")}`);
      }
    } catch (error) {
      failures.push(`${path.relative(root, filePath)} could not be verified: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Packaged Mach-O files must support macOS ${maximum}:\n${failures.map((failure) => `- ${failure}`).join("\n")}`
    );
  }
}

function findMachOFiles(root) {
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findMachOFiles(filePath));
    } else if (entry.isFile() && isMachOFile(filePath)) {
      matches.push(filePath);
    }
  }
  return matches;
}

function isMachOFile(filePath) {
  const descriptor = openSync(filePath, "r");
  const magic = Buffer.alloc(4);
  try {
    if (readSync(descriptor, magic, 0, magic.length, 0) !== magic.length) return false;
  } finally {
    closeSync(descriptor);
  }
  return MACH_O_MAGICS.has(magic.toString("hex"));
}

module.exports = {
  MACOS_DEPLOYMENT_TARGET,
  cmakeDeploymentTargetArgs,
  compareVersions,
  findMachOFiles,
  inspectMacosDeploymentTargets,
  parseMacosDeploymentTargets,
  swiftTargetTriple,
  verifyMacosDeploymentTargets
};
