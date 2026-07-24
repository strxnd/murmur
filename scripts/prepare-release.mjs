#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const releaseTagPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
let options;
let rl;

if (isMainModule()) {
  options = readOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const canPrompt = !options.yes && input.isTTY && output.isTTY;
  rl = canPrompt ? createInterface({ input, output }) : null;
  try {
    await main();
  } finally {
    rl?.close();
  }
}

async function main() {
  const packageJson = await readJson(join(repoRoot, "apps", "desktop", "package.json"));
  const version = packageJson.version;
  const releaseNotesPath = join(repoRoot, "docs", "releases", `${version}.md`);
  const initialGitStatus = await capture("git", ["status", "--short"]);

  printHeader(version);
  await checkReleaseVersion(version);
  await checkReleaseNotes(releaseNotesPath, version);
  await checkGitStatus(initialGitStatus);

  const runDist = await chooseStep({
    label: "Build current-platform release artifacts with bun run dist:release (requires signing and notarization credentials on macOS)",
    skip: options.skipDist
  });
  const runRuntimePackage = await chooseStep({
    label: "Package current-platform STT runtime archives into dist/runtimes",
    skip: options.skipRuntimePackage
  });
  const runChecksums = await chooseStep({
    label: "Generate and verify dist/SHA256SUMS.txt",
    skip: options.skipChecksums,
    enabled: runDist || runRuntimePackage
  });

  await checkHostTools({ runDist, runRuntimePackage, runChecksums });

  const steps = buildSteps({ runDist, runRuntimePackage, runChecksums });
  printPlan(steps);

  if (options.dryRun) {
    console.log("Dry run only. No preparation commands were run.");
    return;
  }

  if (!(await confirm("Run the preparation steps now?", true))) {
    console.log("Release preparation canceled before running commands.");
    return;
  }

  for (const step of steps) {
    await runStep(step);
  }

  await summarizeArtifacts();
  await summarizeGitStatus(initialGitStatus);
  printManualPublishNotes(version);
}

function readOptions(args) {
  const parsed = {
    allowDirty: false,
    allowMissingReleaseNotes: false,
    dryRun: false,
    help: false,
    skipAudit: false,
    skipChecksums: false,
    skipDist: false,
    skipReleaseUrlCheck: false,
    skipRuntimePackage: false,
    skipTests: false,
    yes: false
  };

  for (const arg of args) {
    if (arg === "--allow-dirty") {
      parsed.allowDirty = true;
      continue;
    }
    if (arg === "--allow-missing-release-notes") {
      parsed.allowMissingReleaseNotes = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--skip-audit") {
      parsed.skipAudit = true;
      continue;
    }
    if (arg === "--skip-checksums") {
      parsed.skipChecksums = true;
      continue;
    }
    if (arg === "--skip-dist") {
      parsed.skipDist = true;
      continue;
    }
    if (arg === "--skip-release-url-check") {
      parsed.skipReleaseUrlCheck = true;
      continue;
    }
    if (arg === "--skip-runtime-package") {
      parsed.skipRuntimePackage = true;
      continue;
    }
    if (arg === "--skip-tests") {
      parsed.skipTests = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: bun run release:prepare -- [options]

Prepares Murmur release artifacts without committing, tagging, pushing, or creating
GitHub releases.

Default preparation:
  - validate apps/desktop/package.json version and docs/releases/<version>.md
  - warn on dirty git state
  - run lint, tests, bun audit, and runtime manifest checks
  - prepare and verify current-platform STT runtimes
  - build release app artifacts with bun run dist:release (requires signing and notarization credentials on macOS)
  - package current-platform runtime archives into dist/runtimes
  - generate and verify dist/SHA256SUMS.txt

Options:
  -y, --yes                         run non-interactively with defaults
  --allow-dirty                     allow a dirty git worktree in non-interactive mode
  --allow-missing-release-notes     allow missing docs/releases/<version>.md
  --dry-run                         print the selected plan without running commands
  --skip-audit                      skip bun audit --audit-level=moderate
  --skip-checksums                  skip checksum generation and verification
  --skip-dist                       skip bun run dist:release
  --skip-release-url-check          skip runtime release asset integrity checks
  --skip-runtime-package            skip dist/runtimes archive packaging
  --skip-tests                      skip bun run test
  -h, --help                        show this help

This script may write ignored generated output under apps/desktop/out/, dist/, .cache/,
vendor/runtimes/, and resources/bin/linux-fast-paste.`);
}

function printHeader(version) {
  console.log("Murmur release preparation");
  console.log("");
  console.log(`Package version: ${version}`);
  console.log("");
  console.log("This helper will not:");
  console.log("  - edit tracked source files");
  console.log("  - create release notes");
  console.log("  - commit, tag, or push");
  console.log("  - call gh release");
  console.log("");
  console.log("It may write ignored generated output:");
  console.log("  - apps/desktop/out/");
  console.log("  - dist/");
  console.log("  - .cache/bundled-runtimes/");
  console.log("  - vendor/runtimes/");
  console.log("  - resources/bin/linux-fast-paste");
  console.log("");
}

async function checkReleaseVersion(version) {
  if (!releaseTagPattern.test(version)) {
    throw new Error(`package.json version must be SemVer for release tags: ${version}`);
  }
}

async function checkReleaseNotes(path, version) {
  const file = await stat(path).catch(() => null);
  if (file?.isFile() && file.size > 0) {
    console.log(`Release notes: ${toDisplayPath(path)}`);
    return;
  }

  const message = `Missing release notes: docs/releases/${version}.md`;
  if (options.allowMissingReleaseNotes) {
    console.warn(`${message}. Continuing because --allow-missing-release-notes was passed.`);
    return;
  }
  if (options.yes || !(await confirm(`${message}. Continue without them?`, false))) {
    throw new Error(`${message}. Create that tracked file manually before pushing a release tag.`);
  }
}

async function checkGitStatus(statusText) {
  const status = statusText.trim();
  if (!status) {
    console.log("Git status: clean");
    return;
  }

  console.log("Git status: dirty");
  console.log(indent(status));
  if (options.allowDirty) {
    console.warn("Continuing because --allow-dirty was passed.");
    return;
  }
  if (options.yes || !(await confirm("Continue from a dirty worktree?", false))) {
    throw new Error("Release preparation stopped because the worktree is dirty.");
  }
}

async function chooseStep({ label, skip, enabled = true }) {
  if (!enabled || skip) return false;
  return confirm(label, true);
}

export function buildSteps({ runDist, runRuntimePackage, runChecksums }, platform = process.platform) {
  const steps = [
    commandStep("Typecheck", "bun", ["run", "lint"])
  ];

  if (!options.skipTests) {
    steps.push(commandStep("Test", "bun", ["run", "test"]));
  }

  if (!options.skipAudit) {
    steps.push(commandStep("Audit dependencies", "bun", ["audit", "--audit-level=moderate"]));
  }

  steps.push(commandStep("Check runtime catalog metadata", "bun", ["run", "runtimes:manifest-check"]));

  if (!options.skipReleaseUrlCheck) {
    steps.push(commandStep("Verify runtime release asset bytes", "bun", ["run", "runtimes:manifest-check:release"]));
  }

  steps.push(commandStep("Prepare current-platform STT runtimes", "bun", ["run", "runtimes:prepare"]));
  steps.push(commandStep("Verify current-platform STT runtimes", "bun", ["run", "runtimes:doctor"]));

  if (runDist) {
    steps.push(commandStep("Build current-platform release artifacts", "bun", ["run", "dist:release"]));
  }

  if (runRuntimePackage) {
    steps.push(commandStep("Package current-platform STT runtime archives", "bun", ["run", "runtimes:package"]));
  }

  if (runChecksums) {
    steps.push(commandStep("Generate SHA-256 checksums", "node", ["scripts/generate-linux-release-checksums.mjs"]));
    steps.push(checksumVerificationStep(platform));
  }

  return steps;
}

function commandStep(label, command, args, cwd = repoRoot) {
  return { args, command, cwd, label };
}

function printPlan(steps) {
  console.log("");
  console.log("Preparation steps:");
  steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.label}: ${formatCommand(step)}`);
  });
  console.log("");
}

export async function checkHostTools(
  { runDist, runRuntimePackage, runChecksums },
  platform = process.platform,
  commandExistsImpl = commandExists
) {
  for (const command of requiredHostTools({ runDist, runRuntimePackage, runChecksums }, platform)) {
    if (!(await commandExistsImpl(command))) throw new Error(`Required command not found on PATH: ${command}`);
  }
}

export function requiredHostTools({ runDist, runRuntimePackage, runChecksums }, platform = process.platform) {
  const required = ["git", "bun", "node"];
  if (runDist && platform === "darwin") required.push("codesign", "xcrun", "spctl");
  if (runRuntimePackage) required.push(platform === "darwin" ? "gtar" : "tar", "gzip");
  if (runChecksums) required.push(platform === "darwin" ? "shasum" : "sha256sum");
  if (runDist && platform === "linux") required.push("rpmbuild");
  return required;
}

export function checksumVerificationStep(platform = process.platform) {
  return platform === "darwin"
    ? commandStep("Verify SHA-256 checksums", "shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], join(repoRoot, "dist"))
    : commandStep("Verify SHA-256 checksums", "sha256sum", ["-c", "SHA256SUMS.txt"], join(repoRoot, "dist"));
}

async function commandExists(command) {
  const paths = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const path of paths) {
    const candidate = join(path, command);
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue searching PATH.
    }
  }
  return false;
}

async function runStep(step) {
  console.log("");
  console.log(`==> ${step.label}`);
  console.log(`$ ${formatCommand(step)}`);
  await run(step.command, step.args, step.cwd);
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${formatCommand({ command, args })} exited with code ${code}.`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    const errors = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveCapture(Buffer.concat(chunks).toString("utf8"));
      } else {
        reject(new Error(`${formatCommand({ command, args })} exited with code ${code}: ${Buffer.concat(errors).toString("utf8")}`));
      }
    });
  });
}

async function summarizeArtifacts() {
  const distDir = join(repoRoot, "dist");
  const artifacts = (await findReleaseArtifacts(distDir)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  console.log("");
  if (artifacts.length === 0) {
    console.log("No release artifacts found in dist/.");
    return;
  }

  console.log("Prepared artifacts:");
  for (const artifact of artifacts) {
    console.log(`  - ${artifact.relativePath} (${formatBytes(artifact.size)})`);
  }
}

async function findReleaseArtifacts(root) {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return [];

  const artifacts = [];
  await walk(root);
  return artifacts;

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = toPosixPath(relative(root, absolutePath));
      if (isReleaseArtifact(relativePath)) {
        artifacts.push({
          relativePath: toPosixPath(join("dist", relativePath)),
          size: (await stat(absolutePath)).size
        });
      }
    }
  }
}

function isReleaseArtifact(path) {
  if (/^[^/]+\.(AppImage|deb|rpm|dmg|zip)$/.test(path)) return true;
  if (/^latest-.*\.yml$/.test(path)) return true;
  if (path === "SHA256SUMS.txt") return true;
  return /^runtimes\/[^/]+\.tar\.gz$/.test(path);
}

async function summarizeGitStatus(initialGitStatus) {
  const finalGitStatus = await capture("git", ["status", "--short"]);
  console.log("");
  if (finalGitStatus === initialGitStatus) {
    console.log("Git status is unchanged. Generated release output is ignored by git.");
    return;
  }

  console.warn("Git status changed during preparation. Inspect before committing or tagging:");
  console.warn(indent(finalGitStatus.trim() || "(clean)"));
}

function printManualPublishNotes(version) {
  console.log("");
  console.log("Manual publish steps, not run by this helper:");
  console.log(`  git tag ${version}`);
  console.log(`  git push origin ${version}`);
  console.log("");
  console.log("The release workflow will create the draft GitHub release after the tag push.");
}

async function confirm(question, defaultValue) {
  if (options.yes) return defaultValue;
  if (!rl) {
    if (defaultValue) return true;
    throw new Error(`${question} Run interactively or pass an explicit allow/skip option.`);
  }

  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultValue;
  if (["y", "yes"].includes(answer)) return true;
  if (["n", "no"].includes(answer)) return false;
  console.log("Please answer yes or no.");
  return confirm(question, defaultValue);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function formatCommand(step) {
  return [step.command, ...step.args.map(quoteArg)].join(" ");
}

function quoteArg(arg) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function indent(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function toDisplayPath(path) {
  const display = relative(repoRoot, path);
  return display && !display.startsWith("..") ? toPosixPath(display) : path;
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
