import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const stagingMarkerName = ".murmur-runtime-staging";
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

  it("preserves an unrelated caller-controlled path", () => {
    const root = tempRoot();
    const vendorRoot = join(root, "missing-vendor");
    const stagingRoot = join(root, "important-data");
    const sentinel = join(stagingRoot, "keep.txt");
    touch(sentinel);

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow();

    expect(existsSync(sentinel)).toBe(true);
  });

  it("validates every runtime source before deleting an existing staging tree", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();
    const sentinel = join(stagingRoot, "keep.txt");
    touch(sentinel);
    rmSync(join(vendorRoot, "linux-x64", "sherpa-onnx"), { recursive: true, force: true });

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow();

    expect(existsSync(sentinel)).toBe(true);
  });

  it("rejects overlapping vendor and staging roots without deleting either", () => {
    const root = tempRoot();
    const vendorRoot = join(root, "vendor");
    const stagingRoot = join(vendorRoot, "runtimes");
    const sentinel = join(stagingRoot, "keep.txt");
    touch(join(vendorRoot, "linux-x64", "whisper.cpp", "whisper-server"));
    touch(join(vendorRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));
    touch(sentinel);
    writeStagingMarker(dirname(stagingRoot));

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow();

    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(join(vendorRoot, "linux-x64", "whisper.cpp", "whisper-server"))).toBe(true);
  });

  it("rejects a symbolic-link staging root without deleting its target", () => {
    const { vendorRoot } = setupRuntimeFixtures();
    const root = tempRoot();
    const stagingParent = join(root, "stage");
    const stagingRoot = join(stagingParent, "runtimes");
    const target = join(root, "important-data");
    const sentinel = join(target, "keep.txt");
    touch(sentinel);
    mkdirSync(stagingParent, { recursive: true });
    writeStagingMarker(stagingParent);
    symlinkSync(target, stagingRoot, "dir");

    expect(() => runStage(["--platform=linux-x64"], vendorRoot, stagingRoot)).toThrow();

    expect(existsSync(sentinel)).toBe(true);
  });
});

function setupRuntimeFixtures() {
  const root = tempRoot();
  const vendorRoot = join(root, "vendor", "runtimes");
  const stagingRoot = join(root, "stage", "runtimes");

  touch(join(vendorRoot, "linux-x64", "whisper.cpp", "whisper-server"));
  touch(join(vendorRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));
  writeStagingMarker(dirname(stagingRoot));

  return { vendorRoot, stagingRoot };
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

function writeStagingMarker(parent) {
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, stagingMarkerName), stagingMarkerContents);
}

function touch(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
}

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "murmur-stage-test-"));
  tempDirs.push(dir);
  return dir;
}
