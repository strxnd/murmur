#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const {
  getSttRuntimeSupportedAccelerators,
  sttRuntimeCatalog,
  sttRuntimeVariantRuntimeDir,
  supportedSttRuntimePlatformKeys
} = await loadCatalog(join(repoRoot, "apps", "desktop", "src", "shared", "stt-runtime-catalog.ts"));
const platformArg = readPlatformArg(process.argv.slice(2));
const acceleratorArg = readAcceleratorArg(process.argv.slice(2));
const platformKeys = resolvePlatformKeys(platformArg);

let failed = false;
for (const platformKey of platformKeys) {
  console.log(`Checking STT runtimes for ${platformKey}`);
  for (const runtime of Object.values(sttRuntimeCatalog)) {
    for (const accelerator of resolveAccelerators(runtime, platformKey, acceleratorArg)) {
      failed = !checkRuntime(platformKey, runtime, accelerator) || failed;
    }
  }
}

if (failed) process.exitCode = 1;

function readPlatformArg(args) {
  const index = args.indexOf("--platform");
  if (index === -1) return "current";
  const value = args[index + 1];
  if (!value) throw new Error("--platform needs a value: current, all, or a platform key.");
  return value;
}

function resolvePlatformKeys(value) {
  if (value === "current") {
    const key = `${process.platform}-${process.arch}`;
    if (!supportedSttRuntimePlatformKeys.includes(key)) throw new Error(`Unsupported current platform ${key}.`);
    return [key];
  }
  if (value === "all") return supportedSttRuntimePlatformKeys;
  if (!supportedSttRuntimePlatformKeys.includes(value)) {
    throw new Error(`Unsupported platform ${value}. Supported: ${supportedSttRuntimePlatformKeys.join(", ")}`);
  }
  return [value];
}

function readAcceleratorArg(args) {
  const index = args.indexOf("--accelerator");
  if (index === -1) return "cpu";
  const value = args[index + 1];
  if (!value) throw new Error("--accelerator needs a value: cpu, cuda, or all.");
  if (!["cpu", "cuda", "all"].includes(value)) throw new Error(`Unsupported accelerator ${value}.`);
  return value;
}

function resolveAccelerators(runtime, platformKey, value) {
  const supported = getSttRuntimeSupportedAccelerators(runtime, platformKey);
  if (value === "all") return supported;
  if (!supported.includes(value)) throw new Error(`${runtime.id} has no ${value} variant for ${platformKey}.`);
  return [value];
}

function checkRuntime(platformKey, runtime, accelerator) {
  const runtimeDir = sttRuntimeVariantRuntimeDir(runtime, platformKey, accelerator);
  const root = join(repoRoot, "vendor", "runtimes", platformKey, runtimeDir);
  const binary = runtime.executableCandidates.map((candidate) => join(root, candidate)).find((candidate) => existsSync(candidate));

  if (!binary) {
    console.error(`missing: ${runtime.id} ${accelerator} for ${platformKey}. Expected one of:`);
    for (const candidate of runtime.executableCandidates) console.error(`  ${join(root, candidate)}`);
    return false;
  }

  console.log(`available: ${runtime.id} ${accelerator} -> ${relative(binary)}`);
  return true;
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
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : basename(path);
}
