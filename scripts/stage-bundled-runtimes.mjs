#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const vendorRoot = process.env.MURMUR_RUNTIME_VENDOR_ROOT || join(repoRoot, "vendor", "runtimes");
const stagingRoot = process.env.MURMUR_RUNTIME_STAGING_ROOT || join(repoRoot, ".cache", "bundled-runtimes", "runtimes");
const {
  getSttRuntimeVariantAsset,
  sttRuntimeCatalog,
  sttRuntimeVariantRuntimeDir,
  supportedSttRuntimePlatformKeys
} = await loadCatalog(join(repoRoot, "apps", "desktop", "src", "shared", "stt-runtime-catalog.ts"));
const target = readTarget(process.argv.slice(2), process.env);
const platformKey = resolvePlatformKey(target);

rmSync(stagingRoot, { recursive: true, force: true });

for (const runtime of Object.values(sttRuntimeCatalog)) {
  if (!getSttRuntimeVariantAsset(runtime, platformKey, "cpu")) {
    throw new Error(`No CPU asset metadata for ${runtime.id} on ${platformKey}.`);
  }

  const runtimeDir = sttRuntimeVariantRuntimeDir(runtime, platformKey, "cpu");
  const sourceDir = join(vendorRoot, platformKey, runtimeDir);
  const targetDir = join(stagingRoot, platformKey, runtimeDir);
  const executable = runtime.executableCandidates.map((candidate) => join(sourceDir, ...candidate.split("/"))).find((candidate) => existsSync(candidate));

  if (!executable) {
    throw new Error(`Missing ${runtime.id} for ${platformKey}. Run bun run runtimes:prepare before packaging.`);
  }

  cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true
  });
  console.log(`Staged ${runtime.id} CPU for ${platformKey}: ${relative(targetDir)}`);
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
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
