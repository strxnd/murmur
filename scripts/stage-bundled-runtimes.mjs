#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative as pathRelative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = realpathSync(resolve(scriptDir, ".."));
const defaultVendorRoot = join(repoRoot, "vendor", "runtimes");
const defaultStagingRoot = join(repoRoot, ".cache", "bundled-runtimes", "runtimes");
const stagingParentMarkerName = ".murmur-runtime-staging-parent";
const stagingLeafMarkerName = ".murmur-runtime-staging";
const stagingMarkerContents = "murmur-runtime-staging-v1\n";
const requestedVendorRoot = process.env.MURMUR_RUNTIME_VENDOR_ROOT || defaultVendorRoot;
const requestedStagingRoot = process.env.MURMUR_RUNTIME_STAGING_ROOT || defaultStagingRoot;
const {
  getSttRuntimeVariantAsset,
  sttRuntimeCatalog,
  sttRuntimeVariantRuntimeDir,
  supportedSttRuntimePlatformKeys
} = await loadCatalog(join(repoRoot, "apps", "desktop", "src", "shared", "stt-runtime-catalog.ts"));
const target = readTarget(process.argv.slice(2), process.env);
const platformKey = resolvePlatformKey(target);
const staging = validateStagingRoot(requestedStagingRoot);
const sources = validateRuntimeSources(requestedVendorRoot, staging.root, platformKey);
const freshStagingRoot = resetStagingRoot(staging);

for (const source of sources) {
  const targetDir = join(freshStagingRoot, platformKey, source.runtimeDir);
  cpSync(source.sourceDir, targetDir, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true
  });
  console.log(`Staged ${source.runtimeId} CPU for ${platformKey}: ${displayPath(targetDir)}`);
}

function validateStagingRoot(input) {
  const requestedRoot = resolve(input);
  if (basename(requestedRoot) !== "runtimes") {
    throw new Error("Runtime staging root must be a leaf directory named runtimes.");
  }

  const rootEntry = lstatIfExists(requestedRoot);
  if (rootEntry?.isSymbolicLink()) throw new Error("Runtime staging root must not be a symbolic link.");
  if (rootEntry && !rootEntry.isDirectory()) throw new Error("Runtime staging root must be a directory.");

  const root = canonicalizePath(requestedRoot);
  const parent = dirname(root);
  const protectedParents = [parse(parent).root, canonicalizePath(homedir()), repoRoot];
  if (protectedParents.includes(parent)) {
    throw new Error(`Unsafe runtime staging parent: ${parent}`);
  }

  const requestedDefault = requestedRoot === defaultStagingRoot;
  if (requestedDefault && root !== defaultStagingRoot) {
    throw new Error(`Default runtime staging root must not contain symbolic links: ${root}`);
  }
  const isDefault = requestedDefault;
  const parentMarkerPath = join(parent, stagingParentMarkerName);
  const parentMarkerEntry = lstatIfExists(parentMarkerPath);

  if (parentMarkerEntry) {
    validateMarker(parentMarkerPath, parentMarkerEntry, "runtime staging parent");
  } else if (!isDefault) {
    throw new Error(`Refusing unmarked runtime staging parent: ${parent}`);
  }

  if (rootEntry && readdirSync(root).length > 0) {
    const leafMarkerPath = join(root, stagingLeafMarkerName);
    const leafMarkerEntry = lstatIfExists(leafMarkerPath);
    if (leafMarkerEntry) {
      validateMarker(leafMarkerPath, leafMarkerEntry, "runtime staging leaf");
    } else if (!isDefault) {
      throw new Error(`Refusing unmarked runtime staging leaf: ${root}`);
    }
  }

  return { root, parent, parentMarkerPath, needsParentMarker: !parentMarkerEntry };
}

function validateRuntimeSources(input, stagingRoot, platformKey) {
  const vendorRoot = canonicalizeExistingDirectory(input, "Runtime vendor root");
  if (pathsOverlap(vendorRoot, stagingRoot)) {
    throw new Error(`Runtime vendor and staging roots must not overlap: ${vendorRoot} and ${stagingRoot}`);
  }

  const sources = [];
  for (const runtime of Object.values(sttRuntimeCatalog)) {
    if (!getSttRuntimeVariantAsset(runtime, platformKey, "cpu")) {
      throw new Error(`No CPU asset metadata for ${runtime.id} on ${platformKey}.`);
    }

    const runtimeDir = sttRuntimeVariantRuntimeDir(runtime, platformKey, "cpu");
    const requestedSourceDir = join(vendorRoot, platformKey, runtimeDir);
    const sourceDir = canonicalizeExistingDirectory(requestedSourceDir, `${runtime.id} runtime source`);
    if (!isPathWithin(vendorRoot, sourceDir) || pathsOverlap(sourceDir, stagingRoot)) {
      throw new Error(`Unsafe ${runtime.id} runtime source: ${sourceDir}`);
    }

    const executablePath = runtime.executableCandidates
      .map((candidate) => join(sourceDir, ...candidate.split("/")))
      .find((candidate) => isFile(candidate));
    if (!executablePath) {
      throw new Error(`Missing ${runtime.id} for ${platformKey}. Run bun run runtimes:prepare before packaging.`);
    }
    const executable = realpathSync(executablePath);
    if (!isPathWithin(sourceDir, executable) || pathsOverlap(executable, stagingRoot)) {
      throw new Error(`Unsafe ${runtime.id} runtime executable: ${executable}`);
    }

    sources.push({ runtimeId: runtime.id, runtimeDir, sourceDir });
  }

  return sources;
}

function resetStagingRoot(staging) {
  mkdirSync(staging.parent, { recursive: true, mode: 0o700 });
  if (staging.needsParentMarker) {
    writeFileSync(staging.parentMarkerPath, stagingMarkerContents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }

  const replacementRoot = mkdtempSync(join(staging.parent, ".murmur-runtime-staging-"));
  try {
    chmodSync(replacementRoot, 0o700);
    writeFileSync(join(replacementRoot, stagingLeafMarkerName), stagingMarkerContents, { mode: 0o600 });
    rmSync(staging.root, { recursive: true, force: true });
    renameSync(replacementRoot, staging.root);
  } catch (error) {
    rmSync(replacementRoot, { recursive: true, force: true });
    throw error;
  }

  const freshRoot = realpathSync(staging.root);
  if (freshRoot !== staging.root) throw new Error(`Runtime staging root changed during reset: ${staging.root}`);
  return freshRoot;
}

function validateMarker(path, entry, label) {
  if (!entry.isFile() || entry.isSymbolicLink() || readFileSync(path, "utf8") !== stagingMarkerContents) {
    throw new Error(`Invalid ${label} marker: ${path}`);
  }
}

function canonicalizeExistingDirectory(input, label) {
  const path = resolve(input);
  let entry;
  try {
    entry = statSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!entry.isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
  return realpathSync(path);
}

function canonicalizePath(input) {
  let current = resolve(input);
  const missingSegments = [];

  while (!existsSync(current)) {
    const entry = lstatIfExists(current);
    if (entry?.isSymbolicLink()) throw new Error(`Path contains an unresolved symbolic link: ${current}`);
    const parent = dirname(current);
    if (parent === current) throw new Error(`Unable to canonicalize path: ${input}`);
    missingSegments.unshift(basename(current));
    current = parent;
  }

  return resolve(realpathSync(current), ...missingSegments);
}

function pathsOverlap(first, second) {
  return isPathWithin(first, second) || isPathWithin(second, first);
}

function isPathWithin(parent, child) {
  const relativePath = pathRelative(parent, child);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
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

function displayPath(path) {
  return isPathWithin(repoRoot, path) ? pathRelative(repoRoot, path) : path;
}
