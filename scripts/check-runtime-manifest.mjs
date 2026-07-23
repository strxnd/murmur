#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultCatalogPath = join(repoRoot, "apps", "desktop", "src", "shared", "stt-runtime-catalog.ts");
const defaultManifestPath = join(scriptDir, "runtime-manifest.json");

if (isMainModule()) {
  await main();
}

async function main() {
  const releaseMode = process.argv.includes("--release");
  const catalogPath = process.env.MURMUR_STT_RUNTIME_CATALOG_PATH ?? defaultCatalogPath;
  const manifestPath = process.env.MURMUR_RUNTIME_MANIFEST_PATH ?? defaultManifestPath;
  const catalog = await loadCatalog(catalogPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const errors = validateManifestCoordination(manifest, catalog);

  for (const error of errors) console.error(error);
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  const releaseAssets = [];
  for (const [runtimeId, runtime] of Object.entries(catalog.sttRuntimeCatalog)) {
    for (const platformKey of catalog.supportedSttRuntimePlatformKeys) {
      for (const accelerator of catalog.getSttRuntimeSupportedAccelerators(runtime, platformKey)) {
        const asset = catalog.getSttRuntimeVariantAsset(runtime, platformKey, accelerator);
        if (releaseMode && asset?.url) {
          releaseAssets.push({ asset, label: `${runtimeId}/${platformKey}/${accelerator}` });
        }
      }
    }
  }

  if (releaseMode) {
    const results = await Promise.all(releaseAssets.map(({ asset, label }) => checkReleaseAsset(asset, label)));
    if (results.some((result) => !result)) {
      process.exitCode = 1;
      return;
    }
    console.log(`STT runtime catalog release bytes match size and SHA-256 for ${releaseAssets.length} configured asset(s).`);
    return;
  }

  console.log("STT runtime source manifest and app catalog are coordinated for every supported runtime variant.");
}

export function validateManifestCoordination(manifest, catalog) {
  const errors = [];
  const {
    getSttRuntimeExpectedAssetName,
    getSttRuntimeSupportedAccelerators,
    getSttRuntimeVariantAsset,
    isSemverVersion,
    sttRuntimeReleaseVersion,
    sttRuntimeCatalog,
    supportedSttRuntimePlatformKeys
  } = catalog;

  if (!isSemverVersion(sttRuntimeReleaseVersion)) {
    errors.push(`STT runtime release version must be SemVer: ${sttRuntimeReleaseVersion}`);
  }

  compareSets(errors, "supported platform keys", manifest.platforms ?? [], supportedSttRuntimePlatformKeys);
  compareSets(errors, "runtime IDs", Object.keys(manifest.runtimes ?? {}), Object.keys(sttRuntimeCatalog));

  for (const [runtimeId, runtime] of Object.entries(sttRuntimeCatalog)) {
    const sourceRuntime = manifest.runtimes?.[runtimeId];
    if (!sourceRuntime) continue;

    if (!isSemverVersion(runtime.version)) errors.push(`${runtimeId} runtime bundle version must be SemVer: ${runtime.version}`);
    if (!isSemverVersion(runtime.upstreamVersion)) {
      errors.push(`${runtimeId} upstream version must be SemVer: ${runtime.upstreamVersion}`);
    }
    if (sourceRuntime.version !== runtime.upstreamVersion) {
      errors.push(`${runtimeId} upstream version differs: source manifest=${sourceRuntime.version}, app catalog=${runtime.upstreamVersion}`);
    }
    if (sourceRuntime.runtimeDir !== runtime.runtimeDir) {
      errors.push(`${runtimeId} runtime directory differs: source manifest=${sourceRuntime.runtimeDir}, app catalog=${runtime.runtimeDir}`);
    }

    if (runtimeId === "whisper.cpp") {
      if (!/^[a-f0-9]{40}$/.test(sourceRuntime.commit ?? "")) {
        errors.push("whisper.cpp source commit must be a full lowercase 40-character Git SHA");
      }
      if (!/^[a-f0-9]{40}$/.test(sourceRuntime.tree ?? "")) {
        errors.push("whisper.cpp source tree must be a full lowercase 40-character Git SHA");
      }
      if (!sourceRuntime.gitTag) errors.push("whisper.cpp descriptive gitTag is missing");
    } else if (runtimeId === "sherpa-onnx") {
      if (sourceRuntime.releaseTag !== `v${sourceRuntime.version}`) {
        errors.push(`sherpa-onnx releaseTag must be v${sourceRuntime.version}`);
      }
      if (!sourceRuntime.releaseBaseUrl?.endsWith(`/${sourceRuntime.releaseTag}`)) {
        errors.push("sherpa-onnx releaseBaseUrl must end with its pinned releaseTag");
      }
    }

    compareSets(errors, `${runtimeId} variant platform keys`, Object.keys(sourceRuntime.variants ?? {}), supportedSttRuntimePlatformKeys);
    compareSets(errors, `${runtimeId} bundle platform keys`, Object.keys(sourceRuntime.bundles ?? {}), supportedSttRuntimePlatformKeys);
    if (runtimeId === "sherpa-onnx") {
      compareSets(errors, "sherpa-onnx source asset platform keys", Object.keys(sourceRuntime.assets ?? {}), supportedSttRuntimePlatformKeys);
    }

    for (const platformKey of supportedSttRuntimePlatformKeys) {
      const catalogAccelerators = getSttRuntimeSupportedAccelerators(runtime, platformKey);
      const manifestAccelerators = sourceRuntime.variants?.[platformKey] ?? [];
      compareSets(errors, `${runtimeId}/${platformKey} accelerator variants`, manifestAccelerators, catalogAccelerators);
      compareSets(
        errors,
        `${runtimeId}/${platformKey} bundle variants`,
        Object.keys(sourceRuntime.bundles?.[platformKey] ?? {}),
        catalogAccelerators
      );
      if (runtimeId === "sherpa-onnx") {
        const sourceAssets = sourceRuntime.assets?.[platformKey] ?? {};
        compareSets(errors, `${runtimeId}/${platformKey} source asset variants`, Object.keys(sourceAssets), catalogAccelerators);
        for (const accelerator of catalogAccelerators) {
          const sourceAsset = sourceAssets[accelerator];
          if (!sourceAsset?.name) errors.push(`missing sherpa-onnx/${platformKey}/${accelerator} upstream asset name`);
          if (!/^[a-f0-9]{64}$/.test(sourceAsset?.sha256 ?? "")) {
            errors.push(`sherpa-onnx/${platformKey}/${accelerator} upstream asset SHA-256 must be 64 lowercase hex characters`);
          }
        }
      }

      if (!catalogAccelerators.length) {
        errors.push(`missing ${runtimeId} variant metadata for ${platformKey}`);
        continue;
      }

      for (const accelerator of catalogAccelerators) {
        const asset = getSttRuntimeVariantAsset(runtime, platformKey, accelerator);
        const expectedName = getSttRuntimeExpectedAssetName(runtime, platformKey, accelerator);
        const bundle = sourceRuntime.bundles?.[platformKey]?.[accelerator];
        const label = `${runtimeId}/${platformKey}/${accelerator}`;
        if (!asset) {
          errors.push(`missing ${label} asset metadata`);
          continue;
        }
        if (!bundle) {
          errors.push(`missing ${label} bundle metadata in source manifest`);
          continue;
        }
        if (asset.assetName !== expectedName) errors.push(`${label} asset name must be ${expectedName}`);
        if (bundle.assetName !== asset.assetName) {
          errors.push(`${label} asset identity differs: source manifest=${bundle.assetName}, app catalog=${asset.assetName}`);
        }
        compareOptional(errors, label, "sizeBytes", bundle.sizeBytes, asset.sizeBytes);
        compareOptional(errors, label, "sha256", bundle.sha256, asset.sha256);
        if (asset.archiveFormat && asset.archiveFormat !== "tar.gz") {
          errors.push(`${label} archiveFormat must be tar.gz for app-downloadable runtimes`);
        }
        if (asset.url && !asset.url.endsWith(`/${asset.assetName}`)) errors.push(`${label} URL must end with the asset name`);
        if (asset.url && (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes <= 0)) {
          errors.push(`${label} sizeBytes must be positive when url is configured`);
        }
        if (asset.url && !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) {
          errors.push(`${label} sha256 must be 64 lowercase hex characters when url is configured`);
        }
      }
    }
  }

  return errors;
}

export async function checkReleaseAsset(asset, label, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 300000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(asset.url, {
      headers: { "Accept-Encoding": "identity", "User-Agent": "murmur-runtime-manifest-check" },
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      console.error(`${label} release asset download failed: HTTP ${response.status} ${asset.url}`);
      return false;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const declaredSize = Number(contentLength);
      if (!Number.isFinite(declaredSize) || declaredSize !== asset.sizeBytes) {
        console.error(`${label} release asset size mismatch. Expected ${asset.sizeBytes}, server declared ${contentLength}.`);
        await response.body.cancel();
        return false;
      }
    }

    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of response.body) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > asset.sizeBytes) {
        console.error(`${label} release asset exceeds pinned size ${asset.sizeBytes}.`);
        return false;
      }
      hash.update(chunk);
    }

    const sha256 = hash.digest("hex");
    if (sizeBytes !== asset.sizeBytes) {
      console.error(`${label} release asset size mismatch. Expected ${asset.sizeBytes}, downloaded ${sizeBytes}.`);
      return false;
    }
    if (sha256 !== asset.sha256) {
      console.error(`${label} release asset SHA-256 mismatch. Expected ${asset.sha256}, downloaded ${sha256}.`);
      return false;
    }
    console.log(`verified: ${label} ${sizeBytes} bytes ${sha256}`);
    return true;
  } catch (error) {
    console.error(`${label} release asset check failed: ${error instanceof Error ? error.message : String(error)} ${asset.url}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
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

function compareSets(errors, label, left, right) {
  const leftValues = [...left].sort();
  const rightValues = [...right].sort();
  if (JSON.stringify(leftValues) !== JSON.stringify(rightValues)) {
    errors.push(`${label} differ: source manifest=[${leftValues.join(", ")}], app catalog=[${rightValues.join(", ")}]`);
  }
}

function compareOptional(errors, label, field, left, right) {
  if (left !== right) errors.push(`${label} ${field} differs: source manifest=${left}, app catalog=${right}`);
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
