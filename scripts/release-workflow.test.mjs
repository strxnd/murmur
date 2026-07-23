import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { listReleaseArtifacts } from "./list-release-artifacts.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const workflowPath = join(repoRoot, ".github", "workflows", "release.yml");
const artifactScriptPath = join(scriptDir, "list-release-artifacts.mjs");
let tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("release workflow safety", () => {
  it("pins third-party actions, uses read-only defaults, and disables checkout credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    const checkoutReferences = actionReferences.filter((reference) => reference.startsWith("actions/checkout@"));

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
    expect(workflow).toMatch(/^permissions:\n  contents: read$/m);
    expect(workflow.match(/^\s+contents: write$/gm)).toHaveLength(1);
    expect(workflow).toMatch(
      /draft-release:\n(?:.|\n)*?runs-on: ubuntu-24\.04\n    permissions:\n      contents: write\n    steps:/
    );
    expect(checkoutReferences).toHaveLength(3);
    expect(workflow.match(/^\s+persist-credentials: false$/gm)).toHaveLength(checkoutReferences.length);
  });

  it("passes only existing release files when updater metadata is absent", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain('node scripts/list-release-artifacts.mjs dist > "$artifacts_file"');
    expect(workflow).toContain('mapfile -d \'\' artifacts < "$artifacts_file"');

    const distDir = createDist({
      "Murmur-0.1.0.AppImage": "appimage",
      "Murmur-0.1.0.dmg": "dmg",
      "SHA256SUMS.txt": "checksums",
      "debug.log": "not a release artifact"
    });

    const output = execFileSync(process.execPath, [artifactScriptPath, distDir]);
    const artifacts = output.toString().split("\0").filter(Boolean);

    expect(artifacts).toEqual([
      join(distDir, "Murmur-0.1.0.AppImage"),
      join(distDir, "Murmur-0.1.0.dmg"),
      join(distDir, "SHA256SUMS.txt")
    ]);
    expect(artifacts.every((artifact) => existsSync(artifact))).toBe(true);
    expect(artifacts.some((artifact) => artifact.includes("latest-*.yml"))).toBe(false);
  });

  it("includes updater metadata only when the file exists", () => {
    const distDir = createDist({
      "Murmur-0.1.0.zip": "zip",
      "latest-mac.yml": "metadata",
      "SHA256SUMS.txt": "checksums"
    });

    expect(listReleaseArtifacts(distDir)).toEqual([
      join(distDir, "Murmur-0.1.0.zip"),
      join(distDir, "latest-mac.yml"),
      join(distDir, "SHA256SUMS.txt")
    ]);
  });

  it("fails before publishing an incomplete release set", () => {
    const noPackagesDir = createDist({ "SHA256SUMS.txt": "checksums" });
    const noChecksumsDir = createDist({ "Murmur-0.1.0.deb": "deb" });

    expect(() => listReleaseArtifacts(noPackagesDir)).toThrow("No release packages found");
    expect(() => listReleaseArtifacts(noChecksumsDir)).toThrow("Missing");
  });
});

function createDist(files) {
  const distDir = mkdtempSync(join(tmpdir(), "murmur-release-"));
  tempDirs.push(distDir);
  for (const [fileName, contents] of Object.entries(files)) {
    writeFileSync(join(distDir, fileName), contents);
  }
  return distDir;
}
