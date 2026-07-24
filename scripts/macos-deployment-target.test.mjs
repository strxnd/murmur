import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import macosDeployment from "./macos-deployment-target.cjs";

const {
  MACOS_DEPLOYMENT_TARGET,
  cmakeDeploymentTargetArgs,
  parseMacosDeploymentTargets,
  swiftTargetTriple,
  verifyMacosDeploymentTargets
} = macosDeployment;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("macOS deployment target inputs", () => {
  it("uses the bundle minimum for Swift and CMake native builds", () => {
    const require = createRequire(import.meta.url);
    const buildConfig = require(join(repoRoot, "apps", "desktop", "electron-builder.base.cjs"));

    expect(MACOS_DEPLOYMENT_TARGET).toBe("13.0");
    expect(buildConfig.mac.minimumSystemVersion).toBe(MACOS_DEPLOYMENT_TARGET);
    expect(swiftTargetTriple("arm64")).toBe("arm64-apple-macosx13.0");
    expect(swiftTargetTriple("x64")).toBe("x86_64-apple-macosx13.0");
    expect(cmakeDeploymentTargetArgs("darwin-arm64")).toEqual(["-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0"]);
    expect(cmakeDeploymentTargetArgs("linux-x64")).toEqual([]);
  });

  it("reads deployment targets from modern and legacy Mach-O load commands", () => {
    expect(parseMacosDeploymentTargets(`
Mach header
      cmd LC_BUILD_VERSION
 platform MACOS
    minos 13.0
      sdk 15.4
   ntools 1
     tool LD
  version 1115.7
Load command 10
      cmd LC_VERSION_MIN_MACOSX
  version 12.3
      sdk 13.1
`)).toEqual(["13.0", "12.3"]);
  });
});

describe("packaged Mach-O deployment target verification", () => {
  it("rejects any embedded binary that requires a newer macOS release", () => {
    const root = tempRoot();
    const helper = machOFile(root, "Murmur.app/Contents/Resources/bin/murmur-macos-helper");
    const runtime = machOFile(root, "Murmur.app/Contents/Resources/runtimes/whisper-server");

    expect(() => verifyMacosDeploymentTargets(root, {
      inspect: (filePath) => filePath === helper ? ["13.0"] : ["14.0"]
    })).toThrow(`runtimes/whisper-server requires macOS 14.0`);
    expect(runtime).toContain("whisper-server");
  });

  it("accepts universal binaries only when every architecture supports macOS 13", () => {
    const root = tempRoot();
    machOFile(root, "Murmur.app/Contents/Frameworks/Universal.dylib", "cafebabe");

    expect(() => verifyMacosDeploymentTargets(root, {
      inspect: () => ["12.0", "13.0"]
    })).not.toThrow();
    expect(() => verifyMacosDeploymentTargets(root, {
      inspect: () => ["13.0", "13.1"]
    })).toThrow("requires macOS 13.1");
  });

  it("fails closed when a Mach-O deployment target cannot be inspected", () => {
    const root = tempRoot();
    machOFile(root, "Murmur.app/Contents/Resources/libonnxruntime.dylib");

    expect(() => verifyMacosDeploymentTargets(root, {
      inspect: () => {
        throw new Error("No macOS deployment target metadata found");
      }
    })).toThrow("could not be verified");
  });
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "murmur-macos-target-"));
  tempDirs.push(root);
  return root;
}

function machOFile(root, relativePath, magic = "cffaedfe") {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.concat([Buffer.from(magic, "hex"), Buffer.from("test")]));
  return filePath;
}
