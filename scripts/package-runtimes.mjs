#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultVendorRoot = join(repoRoot, "vendor", "runtimes");
const defaultOutputDir = join(repoRoot, "dist", "runtimes");
const defaultCatalogPath = join(repoRoot, "apps", "desktop", "src", "shared", "stt-runtime-catalog.ts");

if (isMainModule()) {
  await main();
}

async function main() {
  const vendorRoot = process.env.MURMUR_RUNTIME_VENDOR_ROOT ?? defaultVendorRoot;
  const outputDir = process.env.MURMUR_RUNTIME_OUTPUT_DIR ?? defaultOutputDir;
  const catalogPath = process.env.MURMUR_STT_RUNTIME_CATALOG_PATH ?? defaultCatalogPath;
  const {
    getSttRuntimeSupportedAccelerators,
    getSttRuntimeVariantAsset,
    sttRuntimeCatalog,
    sttRuntimeVariantRuntimeDir,
    supportedSttRuntimePlatformKeys
  } = await loadCatalog(catalogPath);
  const platformArg = readPlatformArg(process.argv.slice(2));
  const acceleratorArg = readAcceleratorArg(process.argv.slice(2));
  const platformKeys = resolvePlatformKeys(platformArg, supportedSttRuntimePlatformKeys);

  mkdirSync(outputDir, { recursive: true });
  const results = [];
  for (const platformKey of platformKeys) {
    for (const runtime of Object.values(sttRuntimeCatalog)) {
      const accelerators = resolveAccelerators(runtime, platformKey, acceleratorArg, getSttRuntimeSupportedAccelerators);

      for (const accelerator of accelerators) {
        const asset = getSttRuntimeVariantAsset(runtime, platformKey, accelerator);
        if (!asset) throw new Error(`No ${accelerator} asset metadata for ${runtime.id} on ${platformKey}.`);

        const runtimeDir = sttRuntimeVariantRuntimeDir(runtime, platformKey, accelerator);
        const sourceDir = join(vendorRoot, platformKey, runtimeDir);
        if (!existsSync(sourceDir)) throw new Error(`Missing runtime source directory: ${displayPath(sourceDir)}`);

        const targetPath = join(outputDir, asset.assetName);
        rmSync(targetPath, { force: true });
        await createRuntimeArchive(sourceDir, targetPath);
        const result = {
          runtimeId: runtime.id,
          platformKey,
          accelerator,
          assetName: asset.assetName,
          sizeBytes: statSync(targetPath).size,
          sha256: await sha256File(targetPath)
        };
        verifyPackagedAsset(asset, result, `${runtime.id}/${platformKey}/${accelerator}`);
        results.push(result);
      }
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

export async function createRuntimeArchive(sourceDir, targetPath, platform = process.platform, runImpl = run) {
  const command = archiveCommandForPlatform(platform);
  await runImpl(command, [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-I",
    "gzip -n",
    "-cf",
    targetPath,
    "-C",
    sourceDir,
    "."
  ]);
}

export function archiveCommandForPlatform(platform = process.platform) {
  return platform === "darwin" ? "gtar" : "tar";
}

export function verifyPackagedAsset(asset, result, label) {
  if (asset.sizeBytes !== undefined && result.sizeBytes !== asset.sizeBytes) {
    throw new Error(`${label} packaged size mismatch. Expected ${asset.sizeBytes}, got ${result.sizeBytes}.`);
  }
  if (asset.sha256 !== undefined && result.sha256 !== asset.sha256) {
    throw new Error(`${label} packaged SHA-256 mismatch. Expected ${asset.sha256}, got ${result.sha256}.`);
  }
  if (asset.sizeBytes === undefined || asset.sha256 === undefined) {
    console.warn(`${label} has no complete packaged byte pin; record sizeBytes=${result.sizeBytes} and sha256=${result.sha256} before publishing.`);
  }
}

export function readPlatformArg(args) {
  return readSingleOption(args, "--platform", "current", "current, all, or a platform key");
}

export function readAcceleratorArg(args) {
  const value = readSingleOption(args, "--accelerator", "cpu", "cpu, cuda, or all");
  if (!["cpu", "cuda", "all"].includes(value)) throw new Error(`Unsupported accelerator ${value}.`);
  return value;
}

function readSingleOption(args, name, defaultValue, expectedValues) {
  const indexes = args.flatMap((arg, index) => arg === name ? [index] : []);
  if (indexes.length === 0) return defaultValue;
  if (indexes.length > 1) throw new Error(`${name} may only be specified once.`);
  const value = args[indexes[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value: ${expectedValues}.`);
  return value;
}

function resolveAccelerators(runtime, platformKey, value, getSupportedAccelerators) {
  const supported = getSupportedAccelerators(runtime, platformKey);
  if (value === "all") return supported;
  if (!supported.includes(value)) throw new Error(`${runtime.id} has no ${value} variant for ${platformKey}.`);
  return [value];
}

function resolvePlatformKeys(value, supportedPlatformKeys) {
  if (value === "current") {
    const key = `${process.platform}-${process.arch}`;
    if (!supportedPlatformKeys.includes(key)) throw new Error(`Unsupported current platform ${key}.`);
    return [key];
  }
  if (value === "all") return supportedPlatformKeys;
  if (!supportedPlatformKeys.includes(value)) {
    throw new Error(`Unsupported platform ${value}. Supported: ${supportedPlatformKeys.join(", ")}`);
  }
  return [value];
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

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    console.log(`$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function displayPath(path) {
  const value = relative(repoRoot, path);
  return value && !value.startsWith("..") ? toPosixPath(value) : path;
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
