#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const vendorRoot = join(repoRoot, "vendor", "runtimes");
const stagingRoot = join(repoRoot, ".cache", "bundled-runtimes", "runtimes");
const { sttRuntimeCatalog, supportedSttRuntimePlatformKeys } = await loadCatalog(join(repoRoot, "src", "shared", "stt-runtime-catalog.ts"));
const platformArg = readPlatformArg(process.argv.slice(2));
const platformKey = resolvePlatformKey(platformArg);

rmSync(stagingRoot, { recursive: true, force: true });

for (const runtime of Object.values(sttRuntimeCatalog)) {
  if (!runtime.platforms[platformKey]) {
    throw new Error(`No asset metadata for ${runtime.id} on ${platformKey}.`);
  }

  const sourceDir = join(vendorRoot, platformKey, runtime.runtimeDir);
  const targetDir = join(stagingRoot, platformKey, runtime.runtimeDir);
  const executable = runtime.executableCandidates.map((candidate) => join(sourceDir, ...candidate.split("/"))).find((candidate) => existsSync(candidate));

  if (!executable) {
    throw new Error(`Missing ${runtime.id} for ${platformKey}. Run mise run runtimes:prepare before packaging.`);
  }

  cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true
  });
  console.log(`Staged ${runtime.id} for ${platformKey}: ${relative(targetDir)}`);
}

function readPlatformArg(args) {
  const index = args.indexOf("--platform");
  if (index === -1) return "current";
  const value = args[index + 1];
  if (!value) throw new Error("--platform needs a value: current or a platform key.");
  return value;
}

function resolvePlatformKey(value) {
  if (value === "current") {
    const key = `${process.platform}-${process.arch}`;
    if (!supportedSttRuntimePlatformKeys.includes(key)) throw new Error(`Unsupported current platform ${key}.`);
    return key;
  }
  if (!supportedSttRuntimePlatformKeys.includes(value)) {
    throw new Error(`Unsupported platform ${value}. Supported: ${supportedSttRuntimePlatformKeys.join(", ")}`);
  }
  return value;
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
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
