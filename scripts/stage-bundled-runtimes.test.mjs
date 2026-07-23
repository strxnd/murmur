import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const stagingMarkerContents = "murmur-runtime-staging-v1\n";
let tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("stage-bundled-runtimes", () => {
  it("rejects the unpublished linux arm64 target from explicit platform and arch", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();

    expect(() => runStage(["--platform", "linux", "--arch", "arm64"], vendorRoot, stagingRoot)).toThrow();

    expect(existsSync(join(stagingRoot, "linux-x64"))).toBe(false);
    expect(existsSync(join(stagingRoot, "linux-arm64"))).toBe(false);
  });

  it("stages an explicit platform and architecture target", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();

    runStage(["--platform", "linux", "--arch", "amd64"], vendorRoot, stagingRoot);

    expect(existsSync(join(stagingRoot, ".murmur-runtime-staging"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-x64", "whisper.cpp", "whisper-server"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-arm64"))).toBe(false);
  });

  it("stages the requested linux x64 platform key", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();

    runStage(["--platform=linux-x64"], vendorRoot, stagingRoot);

    expect(existsSync(join(stagingRoot, "linux-x64", "whisper.cpp", "whisper-server"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-arm64"))).toBe(false);
  });

  it("accepts stable runtime target environment variables", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();

    runStage([], vendorRoot, stagingRoot, {
      MURMUR_RUNTIME_PLATFORM: "linux",
      MURMUR_RUNTIME_ARCH: "x64"
    });

    expect(existsSync(join(stagingRoot, "linux-x64", "whisper.cpp", "whisper-server"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"))).toBe(true);
  });

  it("prefers explicit target arguments over environment variables", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();

    runStage(["--platform", "linux", "--arch", "x64"], vendorRoot, stagingRoot, {
      MURMUR_RUNTIME_PLATFORM: "darwin",
      MURMUR_RUNTIME_ARCH: "arm64"
    });

    expect(existsSync(join(stagingRoot, "linux-x64", "whisper.cpp", "whisper-server"))).toBe(true);
    expect(existsSync(join(stagingRoot, "darwin-arm64"))).toBe(false);
  });

  it("preserves an existing unmarked staging directory", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();
    const sentinel = join(stagingRoot, "important.txt");
    touch(sentinel, "keep me");

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow(/unmarked runtime staging leaf/i);
    expect(readFileSync(sentinel, "utf8")).toBe("keep me");
  });

  it("validates every runtime source before deleting a marked staging directory", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();
    const sentinel = markExistingStagingRoot(stagingRoot);
    rmSync(join(vendorRoot, "linux-x64", "sherpa-onnx"), { recursive: true, force: true });

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow(/Missing sherpa-onnx/);
    expect(readFileSync(sentinel, "utf8")).toBe("keep me");
  });

  it("rejects overlapping source and destination trees before deletion", () => {
    const root = tempRoot();
    const stagingParent = join(root, "approved");
    const stagingRoot = join(stagingParent, "runtimes");
    const vendorRoot = join(stagingRoot, "vendor", "runtimes");
    markStagingParent(stagingParent);
    const sentinel = markExistingStagingRoot(stagingRoot);
    createRuntimeSources(vendorRoot);

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow(/must be disjoint/i);
    expect(readFileSync(sentinel, "utf8")).toBe("keep me");
  });

  it("rejects staging paths whose existing components contain a symbolic link", () => {
    const root = tempRoot();
    const realParent = join(root, "real-parent");
    const linkedParent = join(root, "linked-parent");
    const vendorRoot = join(root, "vendor", "runtimes");
    mkdirSync(realParent, { recursive: true });
    symlinkSync(realParent, linkedParent, "dir");
    markStagingParent(realParent);
    createRuntimeSources(vendorRoot);

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, join(linkedParent, "runtimes"))).toThrow(/symbolic links/i);
    expect(existsSync(join(realParent, "runtimes"))).toBe(false);
  });

  it("rejects a custom staging parent without explicit approval", () => {
    const root = tempRoot();
    const vendorRoot = join(root, "vendor", "runtimes");
    const stagingRoot = join(root, "unapproved", "runtimes");
    createRuntimeSources(vendorRoot);

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow(/unmarked runtime staging parent/i);
    expect(existsSync(stagingRoot)).toBe(false);
  });
});

function setupRuntimeFixtures() {
  const root = tempRoot();
  const vendorRoot = join(root, "vendor", "runtimes");
  const stagingParent = join(root, "stage");
  const stagingRoot = join(stagingParent, "runtimes");
  markStagingParent(stagingParent);
  createRuntimeSources(vendorRoot);
  return { vendorRoot, stagingRoot };
}

function createRuntimeSources(vendorRoot) {
  touch(join(vendorRoot, "linux-x64", "whisper.cpp", "whisper-server"));
  touch(join(vendorRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));
}

function markStagingParent(stagingParent) {
  touch(join(stagingParent, ".murmur-runtime-staging-parent"), stagingMarkerContents);
}

function markExistingStagingRoot(stagingRoot) {
  touch(join(stagingRoot, ".murmur-runtime-staging"), stagingMarkerContents);
  const sentinel = join(stagingRoot, "important.txt");
  touch(sentinel, "keep me");
  return sentinel;
}

function runStage(args, vendorRoot, stagingRoot, env = {}) {
  execFileSync("node", [join(repoRoot, "scripts", "stage-bundled-runtimes.mjs"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      MURMUR_RUNTIME_VENDOR_ROOT: vendorRoot,
      MURMUR_RUNTIME_STAGING_ROOT: stagingRoot
    },
    stdio: "pipe"
  });
}

function touch(path, contents = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "murmur-stage-test-"));
  tempDirs.push(dir);
  return dir;
}
