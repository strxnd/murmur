#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestPath = join(scriptDir, "runtime-manifest.json");
const vendorRoot = join(repoRoot, "vendor", "runtimes");
const cacheRoot = join(repoRoot, ".cache", "runtimes");

let manifest;

if (isMainModule()) {
  await main();
}

async function main() {
  manifest = JSON.parse(await readFile(process.env.MURMUR_RUNTIME_MANIFEST_PATH ?? manifestPath, "utf8"));
  const platformArg = readPlatformArg(process.argv.slice(2));
  const acceleratorArg = readAcceleratorArg(process.argv.slice(2));
  const platformKeys = resolvePlatformKeys(platformArg);
  const accelerators = resolveAccelerators(acceleratorArg);
  const currentKey = currentPlatformKey();

  for (const platformKey of platformKeys) {
    console.log(`Preparing STT runtimes for ${platformKey}`);
    for (const accelerator of accelerators) {
      if (sherpaAsset(platformKey, accelerator)) {
        await prepareSherpaOnnx(platformKey, accelerator);
      } else {
        console.warn(`Skipping Sherpa ONNX ${accelerator} for ${platformKey}; no source asset is configured.`);
      }
      if (supportsWhisperCpp(platformKey, accelerator)) {
        if (platformKey === currentKey) {
          await prepareWhisperCpp(platformKey, accelerator);
        } else if (platformArg === "all") {
          console.warn(`Skipping whisper.cpp ${accelerator} build for ${platformKey}; cross-compilation is not configured. Build it on that platform.`);
        } else {
          throw new Error(`Cannot build whisper.cpp for ${platformKey} on ${currentKey}. Run this script on the target platform.`);
        }
      } else {
        console.warn(`Skipping whisper.cpp ${accelerator} for ${platformKey}; that variant is not supported.`);
      }
    }
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

function resolveAccelerators(value) {
  if (value === "all") return ["cpu", "cuda"];
  return [value];
}

function resolvePlatformKeys(value) {
  if (value === "current") {
    const key = currentPlatformKey();
    if (!manifest.platforms.includes(key)) throw new Error(`Unsupported current platform ${key}.`);
    return [key];
  }
  if (value === "all") return manifest.platforms;
  if (!manifest.platforms.includes(value)) throw new Error(`Unsupported platform ${value}. Supported: ${manifest.platforms.join(", ")}`);
  return [value];
}

function currentPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

async function prepareSherpaOnnx(platformKey, accelerator) {
  const runtime = manifest.runtimes["sherpa-onnx"];
  const asset = sherpaAsset(platformKey, accelerator);
  if (!asset?.name || !asset.sha256) {
    throw new Error(
      `No Sherpa ONNX ${accelerator} source asset is configured for ${platformKey}. Repackage upstream archives into Murmur tar.gz assets before app cataloging.`
    );
  }

  mkdirSync(cacheRoot, { recursive: true });
  const archivePath = join(cacheRoot, asset.name);
  const url = `${runtime.releaseBaseUrl}/${asset.name}`;

  if (!existsSync(archivePath) || (await sha256File(archivePath)) !== asset.sha256) {
    rmSync(archivePath, { force: true });
    console.log(`Downloading ${url}`);
    await downloadFile(url, archivePath);
  }

  const actualHash = await sha256File(archivePath);
  if (actualHash !== asset.sha256) {
    rmSync(archivePath, { force: true });
    throw new Error(`SHA-256 mismatch for ${asset.name}. Expected ${asset.sha256}, got ${actualHash}.`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), `murmur-sherpa-${platformKey}-`));
  const extractDir = join(tempDir, "extract");
  mkdirSync(extractDir, { recursive: true });

  try {
    await run("tar", ["-xjf", archivePath, "-C", extractDir]);
    const sourceRoot = singleChildDirectory(extractDir) ?? extractDir;
    const offlineBinary = findFile(sourceRoot, (file) => basename(file) === "sherpa-onnx-offline");
    if (!offlineBinary) throw new Error(`Could not find sherpa-onnx-offline in ${asset.name}.`);

    const dest = join(vendorRoot, platformKey, runtimeDirForVariant(runtime.runtimeDir, accelerator));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(sourceRoot, dest, { recursive: true });
    chmodExecutables(dest, platformKey);
    console.log(`Installed Sherpa ONNX to ${relative(dest)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function prepareWhisperCpp(platformKey, accelerator) {
  const runtime = manifest.runtimes["whisper.cpp"];
  const tempDir = mkdtempSync(join(tmpdir(), `murmur-whisper-${platformKey}-`));
  const sourceDir = join(tempDir, "whisper.cpp");
  const buildDir = join(tempDir, "build");

  try {
    await checkoutPinnedGitSource(runtime, sourceDir);
    await run("git", ["apply", join(repoRoot, runtime.patch)], { cwd: sourceDir });
    const cmakeArgs = [
      "-S",
      sourceDir,
      "-B",
      buildDir,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_EXAMPLES=ON",
      "-DWHISPER_BUILD_SERVER=ON",
      "-DWHISPER_COMMON_FFMPEG=OFF",
      "-DGGML_NATIVE=OFF"
    ];
    if (accelerator === "cuda") cmakeArgs.push("-DGGML_CUDA=ON");
    await run("cmake", cmakeArgs);
    await run("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-server"]);

    const binaryName = "whisper-server";
    const binary = findFile(buildDir, (file) => basename(file) === binaryName);
    if (!binary) throw new Error(`Could not find built ${binaryName}.`);

    const dest = join(vendorRoot, platformKey, runtimeDirForVariant(runtime.runtimeDir, accelerator));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    copyFileSync(binary, join(dest, binaryName));
    copySharedLibraries(buildDir, dest, platformKey);
    chmodExecutables(dest, platformKey);
    console.log(`Installed whisper.cpp to ${relative(dest)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function checkoutPinnedGitSource(runtime, sourceDir) {
  if (!/^[a-f0-9]{40}$/.test(runtime.commit ?? "")) {
    throw new Error(`whisper.cpp commit must be a full lowercase Git SHA: ${runtime.commit ?? "missing"}`);
  }
  if (!/^[a-f0-9]{40}$/.test(runtime.tree ?? "")) {
    throw new Error(`whisper.cpp tree must be a full lowercase Git SHA: ${runtime.tree ?? "missing"}`);
  }

  await run("git", ["init", "--quiet", sourceDir]);
  await run("git", ["-C", sourceDir, "remote", "add", "origin", runtime.repository]);
  await run("git", ["-C", sourceDir, "fetch", "--depth", "1", "origin", runtime.commit]);
  await run("git", ["-C", sourceDir, "-c", "advice.detachedHead=false", "checkout", "--detach", "FETCH_HEAD"]);

  const actualCommit = await capture("git", ["-C", sourceDir, "rev-parse", "HEAD"]);
  if (actualCommit !== runtime.commit) {
    throw new Error(`whisper.cpp commit mismatch. Expected ${runtime.commit}, got ${actualCommit}.`);
  }
  const actualTree = await capture("git", ["-C", sourceDir, "rev-parse", "HEAD^{tree}"]);
  if (actualTree !== runtime.tree) {
    throw new Error(`whisper.cpp tree mismatch. Expected ${runtime.tree}, got ${actualTree}.`);
  }
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, { headers: { "User-Agent": "murmur-runtime-prep" } });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
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

function copySharedLibraries(buildDir, dest, platformKey) {
  const libraries = findFiles(buildDir, isSharedLibrary);
  if (!libraries.length) return;

  const libraryDest = join(dest, "lib");
  mkdirSync(libraryDest, { recursive: true });
  for (const library of libraries) {
    copyFileSync(library, join(libraryDest, basename(library)));
  }
}

function isSharedLibrary(file) {
  const name = basename(file);
  return (
    /\.so(?:\.\d+)*$/.test(name) || /\.dylib$/.test(name)
  );
}

function chmodExecutables(root, platformKey) {
  for (const file of findFiles(root, (candidate) => ["whisper-server", "sherpa-onnx-offline"].includes(basename(candidate)))) {
    chmodSync(file, 0o755);
  }
}

function runtimeDirForVariant(runtimeDir, accelerator) {
  return accelerator === "cpu" ? runtimeDir : `${runtimeDir}-${accelerator}`;
}

function sherpaAsset(platformKey, accelerator) {
  const runtime = manifest.runtimes["sherpa-onnx"];
  return runtime.assets[platformKey]?.[accelerator] ?? undefined;
}

function supportsWhisperCpp(platformKey, accelerator) {
  return manifest.runtimes["whisper.cpp"].variants?.[platformKey]?.includes(accelerator) ?? false;
}

function singleChildDirectory(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
  if (entries.length !== 1 || !entries[0].isDirectory()) return null;
  return join(dir, entries[0].name);
}

function findFile(root, predicate) {
  return findFiles(root, predicate)[0] ?? null;
}

function findFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findFiles(path, predicate));
    } else if ((entry.isFile() || entry.isSymbolicLink()) && predicate(path)) {
      matches.push(path);
    }
  }
  return matches;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    console.log(`$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveCapture(Buffer.concat(stdout).toString("utf8").trim());
      else reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
