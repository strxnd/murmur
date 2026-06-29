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

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const platformArg = readPlatformArg(process.argv.slice(2));
const acceleratorArg = readAcceleratorArg(process.argv.slice(2));
const platformKeys = resolvePlatformKeys(platformArg);
const accelerators = resolveAccelerators(acceleratorArg);
const currentKey = currentPlatformKey();

for (const platformKey of platformKeys) {
  console.log(`Preparing STT runtimes for ${platformKey}`);
  for (const accelerator of accelerators) {
    if (accelerator === "hip") {
      console.warn("Skipping Sherpa ONNX HIP; Sherpa ONNX has no HIP/ROCm runtime in this Murmur version.");
    } else {
      await prepareSherpaOnnx(platformKey, accelerator);
    }
    if (platformKey === currentKey) {
      await prepareWhisperCpp(platformKey, accelerator);
    } else if (platformArg === "all") {
      console.warn(`Skipping whisper.cpp ${accelerator} build for ${platformKey}; cross-compilation is not configured. Build it on that platform.`);
    } else {
      throw new Error(`Cannot build whisper.cpp for ${platformKey} on ${currentKey}. Run this script on the target platform.`);
    }
  }
}

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

function resolveAccelerators(value) {
  if (value === "all") return ["cpu", "cuda", "hip"];
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
  const asset = runtime.assets[platformKey]?.[accelerator] ?? (accelerator === "cpu" ? runtime.assets[platformKey] : undefined);
  if (!asset?.name || !asset.sha256) {
    throw new Error(
      `No Sherpa ONNX ${accelerator} source asset is configured for ${platformKey}. Repackage upstream GPU archives into Murmur tar.gz assets before app cataloging.`
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

    const dest = join(vendorRoot, platformKey, runtimeDirForVariant("sherpa-onnx", accelerator));
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
    await run("git", ["clone", "--depth", "1", "--branch", runtime.gitTag ?? runtime.version, runtime.repository, sourceDir]);
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
    if (accelerator === "hip") {
      cmakeArgs.push("-DGGML_HIP=ON");
      if (process.env.MURMUR_ROCM_TARGETS) cmakeArgs.push(`-DAMDGPU_TARGETS=${process.env.MURMUR_ROCM_TARGETS}`);
    }
    await run("cmake", cmakeArgs);
    await run("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-server"]);

    const binaryName = "whisper-server";
    const binary = findFile(buildDir, (file) => basename(file) === binaryName);
    if (!binary) throw new Error(`Could not find built ${binaryName}.`);

    const dest = join(vendorRoot, platformKey, runtimeDirForVariant("whisper.cpp", accelerator));
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
    /\.so(?:\.\d+)*$/.test(name)
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

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
