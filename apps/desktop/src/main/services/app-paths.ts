import { chmodSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const ownerOnlyDirectoryMode = 0o700;
export const ownerOnlyFileMode = 0o600;

export interface AppPaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  tempDir: string;
  sttTempDir: string;
  audioDir: string;
  modelDir: string;
  runtimeDir: string;
  configPath: string;
  providerSecretsPath: string;
  historyDbPath: string;
  historyJsonPath: string;
}

interface PathProvider {
  getPath(name: "home" | "temp"): string;
}

interface AppPathRuntime {
  platform?: NodeJS.Platform;
  uid?: number;
}

export function resolveAppPaths(
  app: PathProvider,
  env: NodeJS.ProcessEnv = process.env,
  runtime: AppPathRuntime = {}
): AppPaths {
  const homeDir = app.getPath("home");
  const configBase = absoluteEnvPath(env.XDG_CONFIG_HOME) ?? join(homeDir, ".config");
  const dataBase = absoluteEnvPath(env.XDG_DATA_HOME) ?? join(homeDir, ".local", "share");
  const cacheBase = absoluteEnvPath(env.XDG_CACHE_HOME) ?? join(homeDir, ".cache");

  const configDir = join(configBase, "murmur");
  const dataDir = join(dataBase, "murmur");
  const cacheDir = join(cacheBase, "murmur");
  const tempDir = resolveTempDir(app.getPath("temp"), runtime.platform ?? process.platform, runtime.uid ?? process.getuid?.());
  const sttTempDir = join(tempDir, "stt");
  const audioDir = join(dataDir, "audio");
  const modelDir = join(cacheDir, "models", "stt");
  const runtimeDir = join(cacheDir, "runtimes", "stt");

  for (const dir of [configDir, dataDir, cacheDir, tempDir, sttTempDir, audioDir, modelDir, runtimeDir]) {
    ensureOwnerOnlyDirectory(dir);
  }

  return {
    configDir,
    dataDir,
    cacheDir,
    tempDir,
    sttTempDir,
    audioDir,
    modelDir,
    runtimeDir,
    configPath: join(configDir, "murmur-config.json"),
    providerSecretsPath: join(configDir, "murmur-provider-secrets.json"),
    historyDbPath: join(dataDir, "murmur-history.sqlite"),
    historyJsonPath: join(dataDir, "murmur-history.json")
  };
}

export function ensureOwnerOnlyDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: ownerOnlyDirectoryMode });
  chmodSync(path, ownerOnlyDirectoryMode);
}

export function ensureOwnerOnlyFile(path: string): void {
  chmodSync(path, ownerOnlyFileMode);
}

function resolveTempDir(tempBase: string, platform: NodeJS.Platform, uid: number | undefined): string {
  if (platform !== "linux") return join(tempBase, "murmur");
  if (uid === undefined) throw new Error("Unable to resolve the current Linux user ID for Murmur's temporary directory.");
  return join(tempBase, `murmur-${uid}`);
}

function absoluteEnvPath(value: string | undefined): string | undefined {
  return value && isAbsolute(value) ? value : undefined;
}
