import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
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

  it("stages the requested linux x64 platform key", () => {
    const { vendorRoot, stagingRoot } = setupRuntimeFixtures();

    runStage(["--platform", "linux-x64"], vendorRoot, stagingRoot);

    expect(existsSync(join(stagingRoot, "linux-x64", "whisper.cpp", "whisper-server"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"))).toBe(true);
    expect(existsSync(join(stagingRoot, "linux-arm64"))).toBe(false);
  });
});

function setupRuntimeFixtures() {
  const root = tempRoot();
  const vendorRoot = join(root, "vendor", "runtimes");
  const stagingRoot = join(root, "stage", "runtimes");

  for (const platformKey of ["linux-x64"]) {
    touch(join(vendorRoot, platformKey, "whisper.cpp", "whisper-server"));
    touch(join(vendorRoot, platformKey, "sherpa-onnx", "bin", "sherpa-onnx-offline"));
  }

  return { vendorRoot, stagingRoot };
}

function runStage(args, vendorRoot, stagingRoot) {
  execFileSync("node", [join(repoRoot, "scripts", "stage-bundled-runtimes.mjs"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MURMUR_RUNTIME_VENDOR_ROOT: vendorRoot,
      MURMUR_RUNTIME_STAGING_ROOT: stagingRoot
    },
    stdio: "pipe"
  });
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
