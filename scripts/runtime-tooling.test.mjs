import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkReleaseAsset } from "./check-runtime-manifest.mjs";
import {
  archiveCommandForPlatform,
  createRuntimeArchive,
  readPlatformArg as readPackagePlatformArg,
  verifyPackagedAsset
} from "./package-runtimes.mjs";
import {
  checkoutPinnedGitSource,
  readPlatformArg as readPreparePlatformArg
} from "./prepare-runtimes.mjs";
import { checksumVerificationStep, requiredHostTools } from "./prepare-release.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestCheckPath = join(scriptDir, "check-runtime-manifest.mjs");
let tempDirs = [];
let servers = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  servers = [];
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("runtime source provenance", () => {
  it("checks out the pinned commit and tree even when the descriptive tag moves", async () => {
    const root = tempRoot();
    const repository = join(root, "upstream");
    mkdirSync(repository);
    git(repository, ["init", "--quiet"]);
    git(repository, ["config", "user.name", "Runtime Test"]);
    git(repository, ["config", "user.email", "runtime-test@example.com"]);
    writeFileSync(join(repository, "source.txt"), "pinned\n");
    git(repository, ["add", "source.txt"]);
    git(repository, ["commit", "--quiet", "-m", "pinned source"]);
    const commit = git(repository, ["rev-parse", "HEAD"]);
    const tree = git(repository, ["rev-parse", "HEAD^{tree}"]);

    writeFileSync(join(repository, "source.txt"), "moved tag\n");
    git(repository, ["commit", "--quiet", "-am", "move tag target"]);
    git(repository, ["tag", "v1.8.6"]);

    const checkout = join(root, "checkout");
    await checkoutPinnedGitSource({ repository, gitTag: "v1.8.6", commit, tree }, checkout);

    expect(git(checkout, ["rev-parse", "HEAD"])).toBe(commit);
    expect(readFileSync(join(checkout, "source.txt"), "utf8")).toBe("pinned\n");
  });

  it("rejects source bytes whose Git tree differs from the pin", async () => {
    const root = tempRoot();
    const repository = join(root, "upstream");
    mkdirSync(repository);
    git(repository, ["init", "--quiet"]);
    git(repository, ["config", "user.name", "Runtime Test"]);
    git(repository, ["config", "user.email", "runtime-test@example.com"]);
    writeFileSync(join(repository, "source.txt"), "source\n");
    git(repository, ["add", "source.txt"]);
    git(repository, ["commit", "--quiet", "-m", "source"]);
    const commit = git(repository, ["rev-parse", "HEAD"]);

    await expect(checkoutPinnedGitSource({
      repository,
      commit,
      tree: "0000000000000000000000000000000000000000"
    }, join(root, "checkout"))).rejects.toThrow("tree mismatch");
  });
});

describe("coordinated runtime manifests", () => {
  it("accepts the checked-in source manifest and app catalog", () => {
    expect(() => runManifestCheck()).not.toThrow();
  });

  it("fails when source preparation metadata diverges from the app catalog", () => {
    const manifest = JSON.parse(readFileSync(join(scriptDir, "runtime-manifest.json"), "utf8"));
    manifest.runtimes["whisper.cpp"].bundles["linux-x64"].cuda.assetName = "wrong-runtime.tar.gz";
    const path = join(tempRoot(), "runtime-manifest.json");
    writeFileSync(path, JSON.stringify(manifest));

    expect(() => runManifestCheck(path)).toThrow(/asset identity differs/);
  });
});

describe("runtime asset byte integrity", () => {
  it("streams release bytes and verifies exact size and SHA-256", async () => {
    const payload = Buffer.from("pinned runtime bytes");
    const url = await serve(payload);
    const asset = {
      url,
      sizeBytes: payload.byteLength,
      sha256: createHash("sha256").update(payload).digest("hex")
    };

    await expect(checkReleaseAsset(asset, "fixture", { timeoutMs: 5000 })).resolves.toBe(true);
  });

  it("rejects reachable release bytes that do not match the pin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = Buffer.from("wrong");
    const url = await serve(payload);
    const asset = {
      url,
      sizeBytes: payload.byteLength,
      sha256: createHash("sha256").update("right").digest("hex")
    };

    await expect(checkReleaseAsset(asset, "fixture", { timeoutMs: 5000 })).resolves.toBe(false);
  });

  it("rejects packaged archives whose generated metadata differs from the catalog", () => {
    expect(() => verifyPackagedAsset(
      { sizeBytes: 10, sha256: "a".repeat(64) },
      { sizeBytes: 11, sha256: "b".repeat(64) },
      "fixture"
    )).toThrow("packaged size mismatch");
  });
});

describe("host-correct runtime and release tooling", () => {
  it("invokes GNU tar explicitly on macOS with deterministic archive flags", async () => {
    const calls = [];
    await createRuntimeArchive("/runtime", "/output.tar.gz", "darwin", async (command, args) => {
      calls.push({ command, args });
    });

    expect(archiveCommandForPlatform("darwin")).toBe("gtar");
    expect(archiveCommandForPlatform("linux")).toBe("tar");
    expect(calls).toEqual([{
      command: "gtar",
      args: [
        "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
        "-I", "gzip -n", "-cf", "/output.tar.gz", "-C", "/runtime", "."
      ]
    }]);
  });

  it("honors an explicit platform and rejects duplicate platform options", () => {
    expect(readPreparePlatformArg(["--platform", "darwin-x64"])).toBe("darwin-x64");
    expect(readPackagePlatformArg(["--platform", "darwin-x64"])).toBe("darwin-x64");
    expect(() => readPreparePlatformArg(["--platform", "current", "--platform", "darwin-x64"])).toThrow("only be specified once");

    const packageJson = JSON.parse(readFileSync(join(repoRoot, "apps", "desktop", "package.json"), "utf8"));
    expect(packageJson.scripts["runtimes:prepare"]).not.toContain("--platform current");
    expect(packageJson.scripts["runtimes:package"]).not.toContain("--platform current");
  });

  it("offers only supported accelerator workflow choices", () => {
    const workflow = readFileSync(join(repoRoot, ".github", "workflows", "runtime-assets.yml"), "utf8");
    expect(workflow).not.toContain("apple");
    expect(workflow).toMatch(/accelerator:\n(?:.|\n)*?type: choice\n(?:.|\n)*?- cpu\n(?:.|\n)*?- cuda\n(?:.|\n)*?- all/);
    expect(workflow).toContain("brew install gnu-tar");
  });

  it("requires packaging tools for the current host artifacts only", () => {
    expect(requiredHostTools({ runDist: true, runRuntimePackage: true, runChecksums: true }, "darwin")).toEqual([
      "git", "bun", "node", "gtar", "gzip", "shasum"
    ]);
    expect(requiredHostTools({ runDist: true, runRuntimePackage: true, runChecksums: true }, "linux")).toEqual([
      "git", "bun", "node", "tar", "gzip", "sha256sum", "rpmbuild"
    ]);
    expect(checksumVerificationStep("darwin")).toMatchObject({ command: "shasum", args: ["-a", "256", "-c", "SHA256SUMS.txt"] });
  });
});

function runManifestCheck(manifestPath) {
  execFileSync(process.execPath, [manifestCheckPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(manifestPath ? { MURMUR_RUNTIME_MANIFEST_PATH: manifestPath } : {})
    },
    stdio: "pipe"
  });
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function serve(payload) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Length": payload.byteLength, "Content-Type": "application/octet-stream" });
    response.end(payload);
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}/runtime.tar.gz`;
}

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "murmur-runtime-tooling-"));
  tempDirs.push(dir);
  return dir;
}
