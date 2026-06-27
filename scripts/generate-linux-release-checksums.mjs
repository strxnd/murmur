#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const options = readOptions(process.argv.slice(2));
const distDir = resolve(repoRoot, options.distDir);
const outputPath = resolve(repoRoot, options.outputPath ?? join(options.distDir, "SHA256SUMS-linux.txt"));
const outputRelativePath = toPosixPath(relative(distDir, outputPath));

const artifacts = (await findArtifacts(distDir))
  .filter((artifact) => artifact.relativePath !== outputRelativePath)
  .sort((a, b) => compareStrings(a.relativePath, b.relativePath));

if (artifacts.length === 0) {
  console.error(`No Linux release artifacts found in ${toDisplayPath(distDir)}.`);
  console.error("Run `mise run dist` first, then generate checksums from the populated dist/ directory.");
  process.exitCode = 1;
} else {
  const lines = [];
  for (const artifact of artifacts) {
    lines.push(`${await sha256File(artifact.absolutePath)}  ${artifact.relativePath}`);
  }

  await writeFile(outputPath, `${lines.join("\n")}\n`);
  console.log(`Wrote ${toDisplayPath(outputPath)} with ${artifacts.length} artifact checksum${artifacts.length === 1 ? "" : "s"}.`);
}

function readOptions(args) {
  const options = {
    distDir: "dist",
    outputPath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dist") {
      options.distDir = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readValue(args, index, name) {
  const value = args[index + 1];
  if (!value) throw new Error(`${name} needs a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-linux-release-checksums.mjs [--dist dist] [--output dist/SHA256SUMS-linux.txt]

Writes a deterministic SHA-256 manifest for Linux release payloads:
  - top-level AppImage, deb, and rpm packages in dist/
  - runtime tar.gz archives under dist/runtimes/ when present

Metadata files such as latest-linux.yml and .blockmap files are intentionally excluded.`);
}

async function findArtifacts(root) {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return [];

  const artifacts = [];
  await walk(root, artifacts);
  return artifacts;

  async function walk(directory, results) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, results);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = toPosixPath(relative(root, absolutePath));
      if (isLinuxReleasePayload(relativePath)) {
        results.push({ absolutePath, relativePath });
      }
    }
  }
}

function isLinuxReleasePayload(path) {
  if (/^[^/]+\.(AppImage|deb|rpm)$/.test(path)) return true;
  return /^runtimes\/[^/]+\.tar\.gz$/.test(path);
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

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function toDisplayPath(path) {
  const relativePath = relative(repoRoot, path);
  return relativePath && !relativePath.startsWith("..") ? toPosixPath(relativePath) : path;
}
