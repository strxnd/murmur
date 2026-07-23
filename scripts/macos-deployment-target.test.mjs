import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  cmakeMacOSCompatibilityArgs,
  inspectMacOSDeploymentTargets,
  macosDeploymentTarget,
  parseMacOSDeploymentTargets,
  swiftTargetForArch
} from "./macos-deployment-target.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tempDirs = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("macOS 13 deployment target", () => {
  it("uses one target for the app bundle, Swift, CMake, and runtime manifest", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "apps", "desktop", "package.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(repoRoot, "scripts", "runtime-manifest.json"), "utf8"));

    expect(macosDeploymentTarget).toBe("13.0");
    expect(packageJson.build.mac.minimumSystemVersion).toBe(macosDeploymentTarget);
    expect(packageJson.build.extraResources.find((resource) => resource.to === "runtimes").filter).toContain(
      "!.murmur-runtime-staging"
    );
    expect(swiftTargetForArch("arm64")).toBe("arm64-apple-macosx13.0");
    expect(swiftTargetForArch("x64")).toBe("x86_64-apple-macosx13.0");
    expect(cmakeMacOSCompatibilityArgs("darwin-arm64")).toEqual([
      "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0",
      "-DGGML_BLAS=OFF"
    ]);
    expect(cmakeMacOSCompatibilityArgs("linux-x64")).toEqual([]);
    expect(manifest.runtimes["sherpa-onnx"].assets["darwin-arm64"].cpu.name).toContain("-static-no-tts");
    expect(manifest.runtimes["sherpa-onnx"].assets["darwin-x64"].cpu.name).toContain("-static-no-tts");
  });

  it("parses modern and legacy Mach-O minimum versions", () => {
    expect(
      parseMacOSDeploymentTargets(`
Load command 8
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 13.0
      sdk 15.5
Load command 9
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 12.3
      sdk 13.1
`)
    ).toEqual(["13.0", "12.3"]);
  });

  it("inspects every Mach-O file and rejects any target above macOS 13", async () => {
    const root = tempRoot();
    const helper = machO(join(root, "Murmur.app", "Contents", "MacOS", "Murmur"));
    const runtime = machO(join(root, "Murmur.app", "Contents", "Resources", "runtimes", "libbad.dylib"));
    const inspected = [];

    await expect(
      inspectMacOSDeploymentTargets([root], {
        runCommand: async (path) => {
          inspected.push(path);
          return `Load command 1\n      cmd LC_BUILD_VERSION\n    minos ${path === runtime ? "15.5" : "13.0"}\n`;
        }
      })
    ).rejects.toThrow(/libbad\.dylib requires 15\.5/);
    expect(inspected.sort()).toEqual([helper, runtime].sort());
  });

  it("accepts universal Mach-O slices when every slice supports macOS 13", async () => {
    const binary = machO(join(tempRoot(), "universal-helper"), "cafebabe");

    await expect(
      inspectMacOSDeploymentTargets([binary], {
        runCommand: async () => `
Load command 1
      cmd LC_BUILD_VERSION
    minos 12.0
Load command 1
      cmd LC_BUILD_VERSION
    minos 13.0
`
      })
    ).resolves.toEqual([{ file: binary, versions: ["12.0", "13.0"] }]);
  });
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "murmur-macos-target-"));
  tempDirs.push(root);
  return root;
}

function machO(path, magic = "cffaedfe") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(magic, "hex"));
  return path;
}
