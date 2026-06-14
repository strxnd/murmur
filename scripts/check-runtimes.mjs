#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifest = JSON.parse(await readFile(join(scriptDir, "runtime-manifest.json"), "utf8"));
const platformArg = readPlatformArg(process.argv.slice(2));
const platformKeys = resolvePlatformKeys(platformArg);

let failed = false;
for (const platformKey of platformKeys) {
  console.log(`Checking STT runtimes for ${platformKey}`);
  failed = !checkRuntime(platformKey, "whisper.cpp", ["whisper-server", "whisper-server.exe"]) || failed;
  failed = !checkRuntime(platformKey, "sherpa-onnx", [
    "sherpa-onnx-offline",
    "sherpa-onnx-offline.exe",
    join("bin", "sherpa-onnx-offline"),
    join("bin", "sherpa-onnx-offline.exe")
  ]) || failed;
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
    if (!manifest.platforms.includes(key)) throw new Error(`Unsupported current platform ${key}.`);
    return [key];
  }
  if (value === "all") return manifest.platforms;
  if (!manifest.platforms.includes(value)) throw new Error(`Unsupported platform ${value}. Supported: ${manifest.platforms.join(", ")}`);
  return [value];
}

function checkRuntime(platformKey, runtimeDir, executableCandidates) {
  const root = join(repoRoot, "vendor", "runtimes", platformKey, runtimeDir);
  const binary = executableCandidates.map((candidate) => join(root, candidate)).find((candidate) => existsSync(candidate));

  if (!binary) {
    console.error(`missing: ${runtimeDir} for ${platformKey}. Expected one of:`);
    for (const candidate of executableCandidates) console.error(`  ${join(root, candidate)}`);
    return false;
  }

  console.log(`available: ${runtimeDir} -> ${relative(binary)}`);
  return true;
}

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : basename(path);
}
