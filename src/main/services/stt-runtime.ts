import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SttRuntimeAvailability, SttRuntimeId } from "../../shared/types";

type RuntimeSource = NonNullable<SttRuntimeAvailability["source"]>;

interface RuntimeDefinition {
  id: SttRuntimeId;
  label: string;
  runtimeDir: string;
  envVar: string;
  version: string;
  executableCandidates: string[];
}

interface RuntimeCandidate {
  binaryPath: string;
  rootDir: string;
  source: RuntimeSource;
}

export interface ResolvedSttRuntime {
  id: SttRuntimeId;
  label: string;
  platformKey: string;
  binaryPath: string;
  rootDir: string;
  cwd: string;
  source: RuntimeSource;
  version: string;
  env: NodeJS.ProcessEnv;
}

export interface SttRuntimeServiceOptions {
  platform?: string;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  projectRoot?: string;
  exists?: (path: string) => boolean;
}

const supportedPlatformKeys = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]);

const runtimeDefinitions: Record<SttRuntimeId, RuntimeDefinition> = {
  "whisper.cpp": {
    id: "whisper.cpp",
    label: "whisper.cpp",
    runtimeDir: "whisper.cpp",
    envVar: "MURMUR_WHISPER_CPP_SERVER",
    version: "v1.8.6",
    executableCandidates: ["whisper-server", "whisper-server.exe"]
  },
  "sherpa-onnx": {
    id: "sherpa-onnx",
    label: "Sherpa ONNX",
    runtimeDir: "sherpa-onnx",
    envVar: "MURMUR_SHERPA_ONNX_OFFLINE",
    version: "v1.13.2",
    executableCandidates: [
      "sherpa-onnx-offline",
      "sherpa-onnx-offline.exe",
      join("bin", "sherpa-onnx-offline"),
      join("bin", "sherpa-onnx-offline.exe")
    ]
  }
};

export const sttRuntimeIds: SttRuntimeId[] = ["whisper.cpp", "sherpa-onnx"];

export class SttRuntimeService {
  private platform: string;
  private arch: string;
  private env: NodeJS.ProcessEnv;
  private resourcesPath?: string;
  private projectRoot: string;
  private exists: (path: string) => boolean;

  constructor(options: SttRuntimeServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.env = options.env ?? process.env;
    this.resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.exists = options.exists ?? existsSync;
  }

  getPlatformKey(): string {
    return `${this.platform}-${this.arch}`;
  }

  isSupportedPlatform(): boolean {
    return supportedPlatformKeys.has(this.getPlatformKey());
  }

  getAvailability(id: SttRuntimeId): SttRuntimeAvailability {
    const definition = runtimeDefinitions[id];
    const platformKey = this.getPlatformKey();

    if (!supportedPlatformKeys.has(platformKey)) {
      return {
        id,
        label: definition.label,
        status: "unsupported",
        platformKey,
        version: definition.version,
        message: `${definition.label} is not bundled for ${platformKey}. Supported platforms: ${Array.from(supportedPlatformKeys).join(", ")}.`
      };
    }

    const candidate = this.resolveCandidate(definition, platformKey);
    if (!candidate) {
      return {
        id,
        label: definition.label,
        status: "missing",
        platformKey,
        version: definition.version,
        message: `${definition.label} runtime binary was not found for ${platformKey}. Set ${definition.envVar} or install it under vendor/runtimes/${platformKey}/${definition.runtimeDir}.`
      };
    }

    return {
      id,
      label: definition.label,
      status: "available",
      platformKey,
      binaryPath: candidate.binaryPath,
      source: candidate.source,
      version: definition.version,
      message: `${definition.label} runtime is available from ${candidate.source} at ${candidate.binaryPath}.`
    };
  }

  getAvailabilities(): Record<SttRuntimeId, SttRuntimeAvailability> {
    return {
      "whisper.cpp": this.getAvailability("whisper.cpp"),
      "sherpa-onnx": this.getAvailability("sherpa-onnx")
    };
  }

  requireRuntime(id: SttRuntimeId): ResolvedSttRuntime {
    const definition = runtimeDefinitions[id];
    const availability = this.getAvailability(id);
    if (availability.status !== "available" || !availability.binaryPath || !availability.source) {
      throw new Error(availability.message);
    }

    const candidate = this.resolveCandidate(definition, availability.platformKey);
    if (!candidate) {
      throw new Error(availability.message);
    }

    const runtime: Omit<ResolvedSttRuntime, "env"> = {
      id,
      label: definition.label,
      platformKey: availability.platformKey,
      binaryPath: candidate.binaryPath,
      rootDir: candidate.rootDir,
      cwd: dirname(candidate.binaryPath),
      source: candidate.source,
      version: definition.version
    };

    return {
      ...runtime,
      env: this.buildSpawnEnv(runtime)
    };
  }

  buildSpawnEnv(runtime: Omit<ResolvedSttRuntime, "env">): NodeJS.ProcessEnv {
    const env = { ...this.env };
    const dirs = this.runtimeSearchDirs(runtime);

    if (this.platform === "linux") {
      env.LD_LIBRARY_PATH = prependPathList(dirs, env.LD_LIBRARY_PATH, this.platform);
    } else if (this.platform === "darwin") {
      env.DYLD_LIBRARY_PATH = prependPathList(dirs, env.DYLD_LIBRARY_PATH, this.platform);
    } else if (this.platform === "win32") {
      env.PATH = prependPathList(dirs, env.PATH, this.platform);
    }

    return env;
  }

  private resolveCandidate(definition: RuntimeDefinition, platformKey: string): RuntimeCandidate | null {
    for (const candidate of this.candidates(definition, platformKey)) {
      if (this.exists(candidate.binaryPath)) return candidate;
    }
    return null;
  }

  private candidates(definition: RuntimeDefinition, platformKey: string): RuntimeCandidate[] {
    const envPath = this.env[definition.envVar];
    const candidates: RuntimeCandidate[] = [];

    if (envPath) {
      candidates.push({
        binaryPath: envPath,
        rootDir: inferRuntimeRoot(envPath),
        source: "env"
      });
    }

    if (this.resourcesPath) {
      candidates.push(
        ...this.runtimeDirCandidates(join(this.resourcesPath, "runtimes", platformKey, definition.runtimeDir), definition, "resources")
      );
    }

    candidates.push(
      ...this.runtimeDirCandidates(join(this.projectRoot, "vendor", "runtimes", platformKey, definition.runtimeDir), definition, "vendor"),
      ...this.runtimeDirCandidates(join(this.projectRoot, "vendor", "runtimes", definition.runtimeDir), definition, "legacy_vendor")
    );

    return candidates;
  }

  private runtimeDirCandidates(rootDir: string, definition: RuntimeDefinition, source: RuntimeSource): RuntimeCandidate[] {
    return definition.executableCandidates.map((candidate) => ({
      binaryPath: join(rootDir, candidate),
      rootDir,
      source
    }));
  }

  private runtimeSearchDirs(runtime: Omit<ResolvedSttRuntime, "env">): string[] {
    const binaryDir = dirname(runtime.binaryPath);
    const dirs =
      this.platform === "win32"
        ? [binaryDir, runtime.rootDir, join(runtime.rootDir, "bin"), join(runtime.rootDir, "lib")]
        : [join(runtime.rootDir, "lib"), join(binaryDir, "lib"), runtime.rootDir, binaryDir, join(runtime.rootDir, "bin")];

    const existingDirs = unique(dirs).filter((dir) => this.exists(dir));
    return existingDirs.length ? existingDirs : [binaryDir];
  }
}

function inferRuntimeRoot(binaryPath: string): string {
  const binaryDir = dirname(binaryPath);
  return basename(binaryDir) === "bin" ? dirname(binaryDir) : binaryDir;
}

function prependPathList(dirs: string[], existing: string | undefined, platform: string): string {
  const separator = platform === "win32" ? ";" : ":";
  return [...dirs, ...(existing ? existing.split(separator).filter(Boolean) : [])].join(separator);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
