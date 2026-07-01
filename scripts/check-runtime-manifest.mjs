#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const catalogPath = join(repoRoot, "src", "shared", "stt-runtime-catalog.ts");
const releaseMode = process.argv.includes("--release");
const {
  getSttRuntimeExpectedAssetName,
  getSttRuntimeSupportedAccelerators,
  getSttRuntimeVariantAsset,
  isSemverVersion,
  sttRuntimeReleaseVersion,
  sttRuntimeCatalog,
  supportedSttRuntimePlatformKeys
} = await loadCatalog(catalogPath);

let failed = false;
let releaseChecks = 0;

if (!isSemverVersion(sttRuntimeReleaseVersion)) {
  failed = report(`STT runtime release version must be SemVer: ${sttRuntimeReleaseVersion}`);
}

for (const [runtimeId, runtime] of Object.entries(sttRuntimeCatalog)) {
  if (!isSemverVersion(runtime.version)) failed = report(`${runtimeId} runtime bundle version must be SemVer: ${runtime.version}`);
  if (!isSemverVersion(runtime.upstreamVersion)) {
    failed = report(`${runtimeId} upstream version must be SemVer: ${runtime.upstreamVersion}`);
  }

  for (const platformKey of supportedSttRuntimePlatformKeys) {
    const accelerators = getSttRuntimeSupportedAccelerators(runtime, platformKey);
    if (!accelerators.length) {
      failed = report(`missing ${runtimeId} variant metadata for ${platformKey}`);
      continue;
    }

    for (const accelerator of accelerators) {
      const asset = getSttRuntimeVariantAsset(runtime, platformKey, accelerator);
      const expectedName = getSttRuntimeExpectedAssetName(runtime, platformKey, accelerator);
      const label = `${runtimeId}/${platformKey}/${accelerator}`;
      if (!asset) {
        failed = report(`missing ${label} asset metadata`);
        continue;
      }
      if (asset.assetName !== expectedName) failed = report(`${label} asset name must be ${expectedName}`);
      if (asset.archiveFormat && asset.archiveFormat !== "tar.gz") {
        failed = report(`${label} archiveFormat must be tar.gz for app-downloadable runtimes`);
      }
      if (asset.url && !asset.url.endsWith(`/${asset.assetName}`)) failed = report(`${label} URL must end with the asset name`);
      if (asset.url && (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes <= 0)) {
        failed = report(`${label} sizeBytes must be positive when url is configured`);
      }
      if (asset.url && !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) {
        failed = report(`${label} sha256 must be 64 lowercase hex characters when url is configured`);
      }
      if (!asset.url && (asset.sizeBytes !== undefined || asset.sha256 !== undefined) && accelerator !== "cpu") {
        console.warn(`${label} has partial release metadata; install remains disabled until url, sizeBytes, and sha256 are all configured.`);
      }
      if (releaseMode && asset.url) {
        releaseChecks += 1;
        failed = !(await checkReleaseAsset(asset.url, label)) || failed;
      }
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    releaseMode
      ? `STT runtime catalog release URLs are reachable for ${releaseChecks} configured asset(s).`
      : "STT runtime catalog entries include valid variant asset metadata for every supported runtime/platform."
  );
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

function report(message) {
  console.error(message);
  return true;
}

async function checkReleaseAsset(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "murmur-runtime-manifest-check" },
      signal: controller.signal
    });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "murmur-runtime-manifest-check", Range: "bytes=0-0" },
        signal: controller.signal
      });
    }
    if (!response.ok && response.status !== 206) {
      console.error(`${label} release URL is not reachable: HTTP ${response.status} ${url}`);
      return false;
    }
    console.log(`reachable: ${label} ${url}`);
    return true;
  } catch (error) {
    console.error(`${label} release URL check failed: ${error instanceof Error ? error.message : String(error)} ${url}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
