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
const { sttRuntimeCatalog, supportedSttRuntimePlatformKeys } = await loadCatalog(join(repoRoot, "src", "shared", "stt-runtime-catalog.ts"));
const target = readTarget(process.argv.slice(2), process.env);
const platformKey = resolvePlatformKey(target);

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

function readTarget(args, env) {
  return {
    platform: optionValue(args, "--platform") || optionValue(args, "-p") || env.npm_config_platform || platformFromEnvFlags(env) || "current",
    arch: optionValue(args, "--arch") || optionValue(args, "-a") || env.npm_config_arch || archFromEnvFlags(env)
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

  if (platform === "linux" && arch) {
    const key = `${platform}-${normalizeArch(arch)}`;
    if (supportedSttRuntimePlatformKeys.includes(key)) return key;
    throw new Error(`Unsupported runtime target ${key}. Supported: ${supportedSttRuntimePlatformKeys.join(", ")}`);
  }

  throw new Error(
    `Unsupported runtime target ${arch ? `${platform}-${arch}` : platform}. Use current, a platform key, or --platform linux --arch ${supportedLinuxArchHints()}. Supported: ${supportedSttRuntimePlatformKeys.join(", ")}`
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

function platformFromEnvFlags(env) {
  if (env.npm_config_linux === "true" || env.npm_config_linux === "") return "linux";
  return undefined;
}

function archFromEnvFlags(env) {
  if (env.npm_config_x64 === "true" || env.npm_config_x64 === "") return "x64";
  if (env.npm_config_arm64 === "true" || env.npm_config_arm64 === "") return "arm64";
  return undefined;
}

function normalizeArch(value) {
  if (value === "amd64") return "x64";
  if (value === "aarch64") return "arm64";
  return value;
}

function supportedLinuxArchHints() {
  return supportedSttRuntimePlatformKeys
    .filter((key) => key.startsWith("linux-"))
    .map((key) => key.slice("linux-".length))
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
