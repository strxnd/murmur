import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "./app-paths";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("resolveAppPaths", () => {
  it("uses absolute XDG env vars", () => {
    const root = tempRoot();
    const paths = resolveAppPaths(fakeApp(root), {
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      XDG_DATA_HOME: join(root, "xdg-data"),
      XDG_CACHE_HOME: join(root, "xdg-cache")
    }, { platform: "linux", uid: 1000 });

    expect(paths.configDir).toBe(join(root, "xdg-config", "murmur"));
    expect(paths.dataDir).toBe(join(root, "xdg-data", "murmur"));
    expect(paths.cacheDir).toBe(join(root, "xdg-cache", "murmur"));
    expect(paths.tempDir).toBe(join(root, "tmp", "murmur-1000"));
    expect(paths.runtimeDir).toBe(join(root, "xdg-cache", "murmur", "runtimes", "stt"));
    expect(existsSync(paths.configDir)).toBe(true);
    expect(existsSync(paths.modelDir)).toBe(true);
    expect(existsSync(paths.runtimeDir)).toBe(true);
  });

  it("ignores relative XDG env vars", () => {
    const root = tempRoot();
    const paths = resolveAppPaths(fakeApp(root), {
      XDG_CONFIG_HOME: "relative-config",
      XDG_DATA_HOME: "relative-data",
      XDG_CACHE_HOME: "relative-cache"
    }, { platform: "linux", uid: 1000 });

    expect(paths.configDir).toBe(join(root, "home", ".config", "murmur"));
    expect(paths.dataDir).toBe(join(root, "home", ".local", "share", "murmur"));
    expect(paths.cacheDir).toBe(join(root, "home", ".cache", "murmur"));
  });

  it("falls back to home-based XDG paths", () => {
    const root = tempRoot();
    const paths = resolveAppPaths(fakeApp(root), {}, { platform: "linux", uid: 1000 });

    expect(paths.configPath).toBe(join(root, "home", ".config", "murmur", "murmur-config.json"));
    expect(paths.providerSecretsPath).toBe(join(root, "home", ".config", "murmur", "murmur-provider-secrets.json"));
    expect(paths.historyDbPath).toBe(join(root, "home", ".local", "share", "murmur", "murmur-history.sqlite"));
    expect(paths.historyJsonPath).toBe(join(root, "home", ".local", "share", "murmur", "murmur-history.json"));
    expect(paths.audioDir).toBe(join(root, "home", ".local", "share", "murmur", "audio"));
    expect(paths.modelDir).toBe(join(root, "home", ".cache", "murmur", "models", "stt"));
    expect(paths.runtimeDir).toBe(join(root, "home", ".cache", "murmur", "runtimes", "stt"));
  });

  it("isolates Linux temporary directories by user ID", () => {
    const root = tempRoot();
    const firstUserPaths = resolveAppPaths(fakeApp(root), {}, { platform: "linux", uid: 1000 });
    const secondUserPaths = resolveAppPaths(fakeApp(root), {}, { platform: "linux", uid: 1001 });

    expect(firstUserPaths.tempDir).toBe(join(root, "tmp", "murmur-1000"));
    expect(secondUserPaths.tempDir).toBe(join(root, "tmp", "murmur-1001"));
    expect(firstUserPaths.tempDir).not.toBe(secondUserPaths.tempDir);
    expect(existsSync(firstUserPaths.tempDir)).toBe(true);
    expect(existsSync(secondUserPaths.tempDir)).toBe(true);
  });
});

function fakeApp(root: string) {
  return {
    getPath(name: "home" | "temp"): string {
      return name === "home" ? join(root, "home") : join(root, "tmp");
    }
  };
}

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
  tempDirs.push(dir);
  return dir;
}
