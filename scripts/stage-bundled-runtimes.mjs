#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { inspectMacOSDeploymentTargets } from "./macos-deployment-target.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultVendorRoot = join(repoRoot, "vendor", "runtimes");
const defaultStagingParent = join(repoRoot, ".cache", "bundled-runtimes");
const defaultStagingRoot = join(defaultStagingParent, "runtimes");
const stagingParentMarkerName = ".murmur-runtime-staging-parent";
const stagingLeafMarkerName = ".murmur-runtime-staging";
const stagingMarkerContents = "murmur-runtime-staging-v1\n";
const vendorRoot = canonicalPath(process.env.MURMUR_RUNTIME_VENDOR_ROOT || defaultVendorRoot);
const rawStagingRoot = resolve(process.env.MURMUR_RUNTIME_STAGING_ROOT || defaultStagingRoot);
const stagingRoot = canonicalPath(rawStagingRoot);
const {
  getSttRuntimeVariantAsset,
  sttRuntimeCatalog,
  sttRuntimeVariantRuntimeDir,
  supportedSttRuntimePlatformKeys
} = await loadCatalog(join(repoRoot, "apps", "desktop", "src", "shared", "stt-runtime-catalog.ts"));
const target = readTarget(process.argv.slice(2), process.env);
const platformKey = resolvePlatformKey(target);
const stagingPlan = buildStagingPlan(platformKey);

validateStagingRoot(stagingRoot, vendorRoot);
validateSources(stagingPlan, stagingRoot);
if (platformKey.startsWith("darwin-")) {
  await inspectMacOSDeploymentTargets(stagingPlan.map((item) => item.sourceDir));
}
resetStagingRoot(stagingRoot);

for (const item of stagingPlan) {
  cpSync(item.sourceDir, item.targetDir, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true
  });
  console.log(`Staged ${item.runtime.id} CPU for ${platformKey}: ${relative(item.targetDir)}`);
}

function buildStagingPlan(targetPlatformKey) {
  return Object.values(sttRuntimeCatalog).map((runtime) => {
    if (!getSttRuntimeVariantAsset(runtime, targetPlatformKey, "cpu")) {
      throw new Error(`No CPU asset metadata for ${runtime.id} on ${targetPlatformKey}.`);
    }

    const runtimeDir = sttRuntimeVariantRuntimeDir(runtime, targetPlatformKey, "cpu");
    return {
      runtime,
      sourceDir: canonicalPath(join(vendorRoot, targetPlatformKey, runtimeDir)),
      targetDir: canonicalPath(join(stagingRoot, targetPlatformKey, runtimeDir))
    };
  });
}

function validateSources(plan, destinationRoot) {
  for (const item of plan) {
    if (!existsSync(item.sourceDir) || !statSync(item.sourceDir).isDirectory()) {
      throw new Error(`Missing ${item.runtime.id} for ${platformKey}. Run bun run runtimes:prepare before packaging.`);
    }

    const executable = item.runtime.executableCandidates
      .map((candidate) => join(item.sourceDir, ...candidate.split("/")))
      .find((candidate) => existsSync(candidate));
    if (!executable) {
      throw new Error(`Missing ${item.runtime.id} for ${platformKey}. Run bun run runtimes:prepare before packaging.`);
    }

    if (pathsOverlap(item.sourceDir, destinationRoot)) {
      throw new Error(`Runtime source and staging destination must be disjoint: ${item.sourceDir} and ${destinationRoot}`);
    }
  }
}

function validateStagingRoot(destinationRoot, sourceRoot) {
  const destinationParent = dirname(destinationRoot);
  const canonicalRepoRoot = canonicalPath(repoRoot);
  const canonicalDefaultParent = canonicalPath(defaultStagingParent);
  const protectedPaths = new Set([
    canonicalPath(resolve(sep)),
    canonicalRepoRoot,
    canonicalPath(dirname(canonicalRepoRoot)),
    canonicalPath(process.env.HOME || repoRoot),
    canonicalPath(sourceRoot),
    canonicalDefaultParent
  ]);

  if (protectedPaths.has(destinationRoot)) {
    throw new Error(`Refusing to use protected runtime staging path: ${destinationRoot}`);
  }
  if (hasUnexpectedSymlink(rawStagingRoot, destinationRoot)) {
    throw new Error(`Runtime staging path must not contain symbolic links: ${destinationRoot}`);
  }
  if (dirname(destinationRoot) === destinationRoot || destinationRoot.split(sep).filter(Boolean).length < 3) {
    throw new Error(`Runtime staging path is too broad: ${destinationRoot}`);
  }
  if (destinationRoot.slice(destinationParent.length + 1) !== "runtimes") {
    throw new Error(`Runtime staging path must be the runtimes leaf under an approved parent: ${destinationRoot}`);
  }
  if (destinationParent !== canonicalDefaultParent) {
    requireMarker(join(destinationParent, stagingParentMarkerName), "runtime staging parent");
  }
  if (existsSync(destinationRoot)) {
    if (!statSync(destinationRoot).isDirectory()) {
      throw new Error(`Runtime staging path is not a directory: ${destinationRoot}`);
    }
    requireMarker(join(destinationRoot, stagingLeafMarkerName), "runtime staging leaf");
  }
}

function resetStagingRoot(destinationRoot) {
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(destinationRoot, stagingLeafMarkerName), stagingMarkerContents, { mode: 0o600 });
}

function requireMarker(path, label) {
  if (!existsSync(path) || readFileSync(path, "utf8") !== stagingMarkerContents) {
    throw new Error(`Refusing to delete an unmarked ${label}: ${dirname(path)}`);
  }
}

function canonicalPath(path) {
  const absolute = resolve(path);
  const missing = [];
  let existing = absolute;

  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }

  const canonicalExisting = existsSync(existing) ? realpathSync.native(existing) : existing;
  return resolve(canonicalExisting, ...missing);
}

function hasUnexpectedSymlink(rawPath, canonical) {
  if (rawPath === canonical) return false;

  for (const allowedRoot of [resolve(tmpdir()), resolve(repoRoot)]) {
    const pathFromRoot = relativePath(allowedRoot, rawPath);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) continue;
    if (canonicalPath(join(allowedRoot, pathFromRoot)) === join(canonicalPath(allowedRoot), pathFromRoot)) return false;
  }

  return true;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`);
}

function readTarget(args, env) {
  return {
    platform: optionValue(args, "--platform") || optionValue(args, "-p") || env.MURMUR_RUNTIME_PLATFORM || "current",
    arch: optionValue(args, "--arch") || optionValue(args, "-a") || env.MURMUR_RUNTIME_ARCH
  };
}

function resolvePlatformKey(target) {
  const platform = target.platform;
  const arch = target.arch;

  if (platform === "current") {
    const key = `${process.platform}-${process.arch}`;
    if (!supportedSttRuntimePlatformKeys.includes(key)) throw new Error(`Unsupported current platform ${key}.`);
    return key;
  }

  if (supportedSttRuntimePlatformKeys.includes(platform)) return platform;

  if ((platform === "linux" || platform === "darwin") && arch) {
    const key = `${platform}-${normalizeArch(arch)}`;
    if (supportedSttRuntimePlatformKeys.includes(key)) return key;
    throw new Error(`Unsupported runtime target ${key}. Supported: ${supportedSttRuntimePlatformKeys.join(", ")}`);
  }

  throw new Error(
    `Unsupported runtime target ${arch ? `${platform}-${arch}` : platform}. Use current, a platform key, or --platform linux|darwin --arch ${supportedArchHints()}. Supported: ${supportedSttRuntimePlatformKeys.join(", ")}`
  );
}

function optionValue(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} needs a value.`);
  return value;
}

function normalizeArch(value) {
  if (value === "amd64") return "x64";
  if (value === "aarch64") return "arm64";
  return value;
}

function supportedArchHints() {
  return supportedSttRuntimePlatformKeys
    .map((key) => key.split("-").at(-1))
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join("|");
}

async function loadCatalog(path) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} };
  const require = () => ({});
  new Function("exports", "require", "module", output)(module.exports, require, module);
  return module.exports;
}

function relative(path) {
  const result = relativePath(repoRoot, path);
  return result && !result.startsWith("..") && !isAbsolute(result) ? result : path;
}
