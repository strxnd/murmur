#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const catalogPath = join(repoRoot, "src", "shared", "stt-runtime-catalog.ts");
const { sttRuntimeCatalog, supportedSttRuntimePlatformKeys } = await loadCatalog(catalogPath);

let failed = false;
for (const [runtimeId, runtime] of Object.entries(sttRuntimeCatalog)) {
  for (const platformKey of supportedSttRuntimePlatformKeys) {
    const asset = runtime.platforms?.[platformKey];
    const expectedName = `murmur-stt-runtime-${runtimeId}-${runtime.version}-${platformKey}.tar.gz`;
    if (!asset) {
      failed = report(`missing ${runtimeId} asset metadata for ${platformKey}`);
      continue;
    }
    if (asset.assetName !== expectedName) failed = report(`${runtimeId}/${platformKey} asset name must be ${expectedName}`);
    if (asset.url && !asset.url.endsWith(`/${asset.assetName}`)) failed = report(`${runtimeId}/${platformKey} URL must end with the asset name`);
    if (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes <= 0) failed = report(`${runtimeId}/${platformKey} sizeBytes must be positive`);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) failed = report(`${runtimeId}/${platformKey} sha256 must be 64 lowercase hex characters`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("STT runtime catalog entries include asset names, size, and SHA-256 for every supported runtime/platform.");
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
