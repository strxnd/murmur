import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateMacosReleaseSigningEnvironment } from "./validate-macos-release-signing.mjs";
import { verifyPackagedMacosApp } from "./verify-macos-release.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopDir = join(repoRoot, "apps", "desktop");
const require = createRequire(import.meta.url);
const packageJson = require(join(desktopDir, "package.json"));
const devConfig = require(join(desktopDir, "electron-builder.dev.cjs"));
const releaseConfig = require(join(desktopDir, "electron-builder.release.cjs"));

describe("macOS development helper integration", () => {
  it("builds the macOS helper before development and production renderer builds", () => {
    expect(packageJson.scripts.predev).toBe("bun run macos-helper:build");
    expect(packageJson.scripts.prebuild).toBe("bun run macos-helper:build");
  });
});

describe("macOS packaging profiles", () => {
  it("keeps unsigned artifacts confined to explicit development commands", () => {
    expect(packageJson.scripts.pack).toContain("electron-builder.dev.cjs");
    expect(packageJson.scripts.dist).toContain("electron-builder.dev.cjs");
    expect(packageJson.scripts.dist).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
    expect(devConfig.mac).toMatchObject({
      identity: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
      notarize: false
    });
  });

  it("requires hardened signing and notarization for release packaging", () => {
    expect(packageJson.scripts["dist:release"]).toContain("validate-macos-release-signing.mjs");
    expect(packageJson.scripts["dist:release"]).toContain("electron-builder.release.cjs");
    expect(packageJson.scripts["dist:release"]).toContain("verify-macos-release.mjs");
    expect(releaseConfig.mac).toMatchObject({
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: true
    });
    expect(releaseConfig.mac.identity).not.toBeNull();
    expect(releaseConfig.mac.entitlements).toMatch(/entitlements\.mac\.plist$/);
    expect(releaseConfig.mac.entitlementsInherit).toBe(releaseConfig.mac.entitlements);
  });

  it("fails closed when macOS release credentials are incomplete", () => {
    const complete = {
      CSC_LINK: "certificate",
      CSC_KEY_PASSWORD: "password",
      APPLE_ID: "release@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "TEAMID"
    };
    expect(validateMacosReleaseSigningEnvironment(complete, "darwin")).toEqual([]);
    expect(validateMacosReleaseSigningEnvironment({ ...complete, APPLE_TEAM_ID: "" }, "darwin")).toEqual([
      "APPLE_TEAM_ID"
    ]);
    expect(validateMacosReleaseSigningEnvironment({}, "linux")).toEqual([]);
  });

  it("verifies the signature, stapled ticket, and Gatekeeper acceptance after packaging", () => {
    const calls = [];
    verifyPackagedMacosApp("/tmp/Murmur.app", (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: "", stderr: "" };
    });
    expect(calls).toEqual([
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", "/tmp/Murmur.app"]],
      ["xcrun", ["stapler", "validate", "/tmp/Murmur.app"]],
      ["spctl", ["--assess", "--type", "execute", "--verbose=2", "/tmp/Murmur.app"]]
    ]);
  });

  it("uses the signed release command in the tag workflow", () => {
    const workflow = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
    expect(workflow).toContain("run: bun run dist:release");
    expect(workflow).toContain("CSC_LINK: ${{ secrets.MACOS_CSC_LINK }}");
  });
});
