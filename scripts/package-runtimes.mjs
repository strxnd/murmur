#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const vendorRoot = join(repoRoot, "vendor", "runtimes");
const outputDir = join(repoRoot, "dist", "runtimes");
const {
  getSttRuntimeSupportedAccelerators,
  getSttRuntimeVariantAsset,
  sttRuntimeCatalog,
  sttRuntimeVariantRuntimeDir,
  supportedSttRuntimePlatformKeys
} = await loadCatalog(join(repoRoot, "src", "shared", "stt-runtime-catalog.ts"));
const platformArg = readPlatformArg(process.argv.slice(2));
const acceleratorArg = readAcceleratorArg(process.argv.slice(2));
const platformKeys = resolvePlatformKeys(platformArg);

mkdirSync(outputDir, { recursive: true });

const results = [];
for (const platformKey of platformKeys) {
  for (const runtime of Object.values(sttRuntimeCatalog)) {
    const accelerators = resolveAccelerators(runtime, platformKey, acceleratorArg);

    for (const accelerator of accelerators) {
      const asset = getSttRuntimeVariantAsset(runtime, platformKey, accelerator);
      if (!asset) throw new Error(`No ${accelerator} asset metadata for ${runtime.id} on ${platformKey}.`);

      const runtimeDir = sttRuntimeVariantRuntimeDir(runtime, platformKey, accelerator);
      const sourceDir = join(vendorRoot, platformKey, runtimeDir);
      if (!existsSync(sourceDir)) throw new Error(`Missing runtime source directory: ${relative(sourceDir)}`);

      const targetPath = join(outputDir, asset.assetName);
      rmSync(targetPath, { force: true });
      await run("tar", [
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
      const sha256 = await sha256File(targetPath);
      const sizeBytes = statSync(targetPath).size;
      results.push({
        runtimeId: runtime.id,
        platformKey,
        accelerator,
        assetName: asset.assetName,
        sizeBytes,
        sha256
      });
    }
  }
}

console.log(JSON.stringify(results, null, 2));

function readPlatformArg(args) {
  const index = args.indexOf("--platform");
  if (index === -1) return "current";
  const value = args[index + 1];
  if (!value) throw new Error("--platform needs a value: current, all, or a platform key.");
  return value;
}

function readAcceleratorArg(args) {
  const index = args.indexOf("--accelerator");
  if (index === -1) return "cpu";
  const value = args[index + 1];
  if (!value) throw new Error("--accelerator needs a value: cpu, cuda, hip, or all.");
  if (!["cpu", "cuda", "hip", "all"].includes(value)) throw new Error(`Unsupported accelerator ${value}.`);
  return value;
}

function resolveAccelerators(runtime, platformKey, value) {
  const supported = getSttRuntimeSupportedAccelerators(runtime, platformKey);
  if (value === "all") return supported;
  if (!supported.includes(value)) throw new Error(`${runtime.id} has no ${value} variant for ${platformKey}.`);
  return [value];
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

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
