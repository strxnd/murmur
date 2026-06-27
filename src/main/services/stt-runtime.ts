import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  sttRuntimeCatalog,
  sttRuntimeIds,
  supportedSttRuntimePlatformKeys,
  type SttRuntimeAsset,
  type SttRuntimeCatalogEntry
} from "../../shared/stt-runtime-catalog";
import type {
  SttRuntimeAvailability,
  SttRuntimeId,
  SttRuntimeInstallState,
  SttRuntimeInstallStatus,
  SttRuntimeSource
} from "../../shared/types";

type RuntimeSource = SttRuntimeSource;
type RuntimeCatalog = Record<SttRuntimeId, SttRuntimeCatalogEntry>;
type ProgressEmitter = (state: SttRuntimeInstallState) => void;
type RuntimeMutationHook = (id: SttRuntimeId) => void | Promise<void>;
type DownloadableSttRuntimeAsset = SttRuntimeAsset & { url: string };
const defaultDownloadHeaderTimeoutMs = 15000;
const defaultDownloadBodyTimeoutMs = 30000;
const defaultProgressEmitIntervalMs = 500;
const progressEmitMinBytes = 1024 * 1024;

interface RuntimeCandidate {
  binaryPath: string;
  rootDir: string;
  source: RuntimeSource;
  version?: string;
}

interface RuntimeReceipt {
  id: SttRuntimeId;
  platformKey: string;
  version: string;
  archiveName: string;
  archiveSha256: string;
  installedAt: string;
}

interface RuntimeOperation {
  controller: AbortController;
  promise: Promise<SttRuntimeInstallState>;
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
  runtimeDir?: string;
  exists?: (path: string) => boolean;
  fetch?: typeof fetch;
  extractArchive?: (archivePath: string, targetDir: string, signal?: AbortSignal) => Promise<void>;
  catalog?: RuntimeCatalog;
  emitProgress?: ProgressEmitter;
  onBeforeRuntimeMutation?: RuntimeMutationHook;
  downloadsEnabled?: boolean;
  downloadHeaderTimeoutMs?: number;
  downloadBodyTimeoutMs?: number;
  progressEmitIntervalMs?: number;
}

export { sttRuntimeIds };

export class SttRuntimeService {
  private platform: string;
  private arch: string;
  private env: NodeJS.ProcessEnv;
  private resourcesPath?: string;
  private projectRoot: string;
  private runtimeDir?: string;
  private exists: (path: string) => boolean;
  private fetchImpl: typeof fetch;
  private extractArchiveImpl: (archivePath: string, targetDir: string, signal?: AbortSignal) => Promise<void>;
  private catalog: RuntimeCatalog;
  private emitProgress?: ProgressEmitter;
  private onBeforeRuntimeMutation?: RuntimeMutationHook;
  private downloadsEnabled: boolean;
  private downloadHeaderTimeoutMs: number;
  private downloadBodyTimeoutMs: number;
  private progressEmitIntervalMs: number;
  private operations = new Map<SttRuntimeId, RuntimeOperation>();
  private activeStates = new Map<SttRuntimeId, SttRuntimeInstallState>();
  private lastErrors = new Map<SttRuntimeId, string>();

  constructor(options: SttRuntimeServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.env = options.env ?? process.env;
    this.resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.runtimeDir = options.runtimeDir;
    this.exists = options.exists ?? existsSync;
    this.fetchImpl = options.fetch ?? fetch;
    this.extractArchiveImpl = options.extractArchive ?? extractTarGz;
    this.catalog = options.catalog ?? sttRuntimeCatalog;
    this.emitProgress = options.emitProgress;
    this.onBeforeRuntimeMutation = options.onBeforeRuntimeMutation;
    this.downloadsEnabled = options.downloadsEnabled ?? true;
    this.downloadHeaderTimeoutMs = options.downloadHeaderTimeoutMs ?? defaultDownloadHeaderTimeoutMs;
    this.downloadBodyTimeoutMs = options.downloadBodyTimeoutMs ?? defaultDownloadBodyTimeoutMs;
    this.progressEmitIntervalMs = options.progressEmitIntervalMs ?? defaultProgressEmitIntervalMs;
    this.cleanupPartialInstalls();
  }

  setProgressEmitter(emitProgress: ProgressEmitter | undefined): void {
    this.emitProgress = emitProgress;
  }

  setBeforeRuntimeMutationHook(onBeforeRuntimeMutation: RuntimeMutationHook | undefined): void {
    this.onBeforeRuntimeMutation = onBeforeRuntimeMutation;
  }

  getPlatformKey(): string {
    return `${this.platform}-${this.arch}`;
  }

  isSupportedPlatform(): boolean {
    return this.supportedPlatformKeys().has(this.getPlatformKey());
  }

  getAvailability(id: SttRuntimeId): SttRuntimeAvailability {
    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();

    if (!this.supportedPlatformKeys().has(platformKey)) {
      return {
        id,
        label: definition.label,
        status: "unsupported",
        platformKey,
        version: definition.version,
        message: `${definition.label} is not bundled for ${platformKey}. Supported platforms: ${Array.from(this.supportedPlatformKeys()).join(", ")}.`
      };
    }

    const candidate = this.resolveCandidate(definition, platformKey);
    if (!candidate) {
      const canDownloadRuntime = this.canDownloadRuntime(definition, platformKey);
      return {
        id,
        label: definition.label,
        status: "missing",
        platformKey,
        version: definition.version,
        message: this.downloadsEnabled && canDownloadRuntime
          ? `${definition.label} runtime binary was not found for ${platformKey}. Set ${definition.envVar}, install it from the setup flow, or install it under vendor/runtimes/${platformKey}/${definition.runtimeDir}.`
          : this.downloadsEnabled
            ? `${definition.label} runtime binary was not found for ${platformKey}. Set ${definition.envVar} or run mise run runtimes:prepare to install it under vendor/runtimes/${platformKey}/${definition.runtimeDir}.`
          : this.missingBundledRuntimeMessage(definition, platformKey)
      };
    }

    return {
      id,
      label: definition.label,
      status: "available",
      platformKey,
      binaryPath: candidate.binaryPath,
      source: candidate.source,
      version: candidate.version ?? definition.version,
      message: `${definition.label} runtime is available.`
    };
  }

  getAvailabilities(): Record<SttRuntimeId, SttRuntimeAvailability> {
    return Object.fromEntries(sttRuntimeIds.map((id) => [id, this.getAvailability(id)])) as Record<SttRuntimeId, SttRuntimeAvailability>;
  }

  getInstallState(id: SttRuntimeId): SttRuntimeInstallState {
    const active = this.activeStates.get(id);
    if (active) return active;

    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const asset = definition.platforms[platformKey];
    const supported = this.supportedPlatformKeys().has(platformKey) && Boolean(asset);
    const canDownloadRuntime = this.canDownloadRuntime(definition, platformKey);

    if (!supported) {
      return this.state(id, "unsupported", {
        message: `${definition.label} is not available for ${platformKey}.`,
        canDownload: false,
        canRepair: false
      });
    }

    const candidate = this.resolveCandidate(definition, platformKey);
    if (candidate) {
      return this.state(id, "ready", {
        installedVersion: candidate.version ?? definition.version,
        source: candidate.source,
        binaryPath: candidate.binaryPath,
        rootDir: candidate.rootDir,
        message: `${definition.label} runtime is ready.`,
        canDownload: candidate.source === "cache" && canDownloadRuntime,
        canRepair: candidate.source === "cache" && canDownloadRuntime
      });
    }

    const cacheProblem = this.cacheInstallProblem(definition, platformKey);
    if (cacheProblem && this.downloadsEnabled && canDownloadRuntime) {
      return this.state(id, "repairable", {
        error: cacheProblem,
        message: `${definition.label} runtime cache needs repair.`,
        canDownload: true,
        canRepair: true
      });
    }

    const error = this.lastErrors.get(id);
    if (error) {
      return this.state(id, "error", {
        error,
        message: `${definition.label} runtime install failed.`,
        canDownload: canDownloadRuntime,
        canRepair: canDownloadRuntime
      });
    }

    return this.state(id, "not_installed", {
      message: this.downloadsEnabled
        ? `${definition.label} runtime is not installed. Run mise run runtimes:prepare or set ${definition.envVar} to a compatible binary.`
        : this.missingBundledRuntimeMessage(definition, platformKey),
      canDownload: this.downloadsEnabled && canDownloadRuntime,
      canRepair: false
    });
  }

  getInstallStates(): Record<SttRuntimeId, SttRuntimeInstallState> {
    return Object.fromEntries(sttRuntimeIds.map((id) => [id, this.getInstallState(id)])) as Record<SttRuntimeId, SttRuntimeInstallState>;
  }

  async downloadRuntime(id: SttRuntimeId): Promise<SttRuntimeInstallState> {
    if (!this.downloadsEnabled) return this.getInstallState(id);

    const existingOperation = this.operations.get(id);
    if (existingOperation) return existingOperation.promise;

    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const asset = definition.platforms[platformKey];
    const url = asset?.url;
    if (!this.supportedPlatformKeys().has(platformKey) || !asset || !url) {
      const unsupported = this.getInstallState(id);
      this.emit(unsupported);
      return unsupported;
    }
    const downloadableAsset: DownloadableSttRuntimeAsset = { ...asset, url };

    const controller = new AbortController();
    const promise = this.installRuntime(id, definition, downloadableAsset, controller).finally(() => {
      this.operations.delete(id);
      this.activeStates.delete(id);
    });
    this.operations.set(id, { controller, promise });
    return promise;
  }

  async repairRuntime(id: SttRuntimeId): Promise<SttRuntimeInstallState> {
    return this.downloadRuntime(id);
  }

  async cancelRuntimeDownload(id: SttRuntimeId): Promise<SttRuntimeInstallState> {
    const operation = this.operations.get(id);
    if (!operation) return this.getInstallState(id);

    operation.controller.abort();
    try {
      await operation.promise;
    } catch {
      // The download path records cancellation state before resolving back to the caller.
    }
    return this.getInstallState(id);
  }

  requireRuntime(id: SttRuntimeId): ResolvedSttRuntime {
    const definition = this.definition(id);
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
      version: candidate.version ?? definition.version
    };

    return {
      ...runtime,
      env: this.buildSpawnEnv(runtime)
    };
  }

  buildSpawnEnv(runtime: Omit<ResolvedSttRuntime, "env">): NodeJS.ProcessEnv {
    const env = { ...this.env };
    const dirs = this.runtimeSearchDirs(runtime);

    env.LD_LIBRARY_PATH = prependPathList(dirs, env.LD_LIBRARY_PATH);

    return env;
  }

  private async installRuntime(
    id: SttRuntimeId,
    definition: SttRuntimeCatalogEntry,
    asset: DownloadableSttRuntimeAsset,
    controller: AbortController
  ): Promise<SttRuntimeInstallState> {
    const platformKey = this.getPlatformKey();
    const parentDir = this.cacheRuntimeParentDir(definition, platformKey);
    const finalDir = this.cacheInstallRoot(definition, platformKey);
    const archivePath = join(parentDir, `${asset.assetName}.part`);
    const stagingDir = join(parentDir, `${definition.version}.staging-${process.pid}-${Date.now()}`);
    const extractDir = join(stagingDir, "extract");

    mkdirSync(parentDir, { recursive: true });
    rmSync(archivePath, { force: true });
    rmSync(stagingDir, { recursive: true, force: true });
    this.lastErrors.delete(id);

    this.emit(
      this.state(id, "downloading", {
        progressBytes: 0,
        totalBytes: asset.sizeBytes,
        message: `Downloading ${definition.label} runtime.`,
        canDownload: false,
        canRepair: false
      })
    );

    try {
      const archiveSha256 = await this.downloadArchive(asset, archivePath, id, controller);
      if (archiveSha256 !== asset.sha256) {
        rmSync(archivePath, { force: true });
        throw new Error(`SHA-256 mismatch for ${asset.assetName}. Expected ${asset.sha256}, got ${archiveSha256}.`);
      }

      this.emit(
        this.state(id, "installing", {
          progressBytes: asset.sizeBytes,
          totalBytes: asset.sizeBytes,
          message: `Installing ${definition.label} runtime.`,
          canDownload: false,
          canRepair: false
        })
      );

      if (controller.signal.aborted) throw abortError();
      mkdirSync(extractDir, { recursive: true });
      await assertSafeTarGzArchive(archivePath, controller.signal);
      if (controller.signal.aborted) throw abortError();
      await this.extractArchiveImpl(archivePath, extractDir, controller.signal);
      if (controller.signal.aborted) throw abortError();
      const extractedRoot = singleChildDirectory(extractDir) ?? extractDir;
      const binary = findExecutable(extractedRoot, definition);
      if (!binary) {
        throw new Error(`${definition.label} archive did not contain a supported executable.`);
      }
      chmodExecutables(extractedRoot, definition);
      writeReceipt(join(extractedRoot, "runtime.json"), {
        id,
        platformKey,
        version: definition.version,
        archiveName: asset.assetName,
        archiveSha256: asset.sha256,
        installedAt: new Date().toISOString()
      });

      await this.onBeforeRuntimeMutation?.(id);
      replaceDirectory(extractedRoot, finalDir);
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });

      this.activeStates.delete(id);
      const ready = this.getInstallState(id);
      this.emit(ready);
      return ready;
    } catch (error) {
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });
      const errorText = isAbortError(error) ? "Runtime download was cancelled." : message(error);
      if (!isAbortError(error)) this.lastErrors.set(id, errorText);
      this.activeStates.delete(id);
      const state = this.getInstallState(id);
      this.emit(
        state.status === "ready"
          ? state
          : {
              ...state,
              status: isAbortError(error) ? "not_installed" : state.status,
              error: isAbortError(error) ? undefined : errorText,
              message: isAbortError(error) ? `${definition.label} runtime download was cancelled.` : state.message
            }
      );
      return this.getInstallState(id);
    }
  }

  private async downloadArchive(
    asset: DownloadableSttRuntimeAsset,
    archivePath: string,
    id: SttRuntimeId,
    controller: AbortController
  ): Promise<string> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      asset.url,
      {
        headers: { "User-Agent": "murmur-runtime-manager" }
      },
      this.downloadHeaderTimeoutMs,
      controller.signal
    );
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const totalBytes = Number(response.headers.get("content-length")) || asset.sizeBytes;
    const writer = createWriteStream(archivePath);
    const hash = createHash("sha256");
    let progressBytes = 0;
    let streamDone = false;
    let lastEmittedAt = 0;
    let lastProgressBytes = 0;
    const reader = response.body.getReader();

    try {
      while (true) {
        if (controller.signal.aborted) throw abortError();
        const { done, value } = await readStreamChunk(reader, this.downloadBodyTimeoutMs, controller.signal);
        if (done) {
          streamDone = true;
          break;
        }
        if (!value) continue;
        progressBytes += value.byteLength;
        hash.update(value);
        await writeChunk(writer, value);
        const active = this.activeStates.get(id);
        const now = Date.now();
        const firstPositiveProgress = lastProgressBytes === 0 && progressBytes > 0;
        const shouldEmit =
          active &&
          (lastEmittedAt === 0 ||
            firstPositiveProgress ||
            progressBytes - lastProgressBytes >= progressEmitMinBytes ||
            now - lastEmittedAt >= this.progressEmitIntervalMs ||
            progressBytes >= totalBytes);
        if (active && shouldEmit) {
          lastEmittedAt = now;
          lastProgressBytes = progressBytes;
          this.emit({
            ...active,
            progressBytes,
            totalBytes,
            message: `Downloading ${active.label} runtime.`
          });
        }
      }
    } finally {
      if (!streamDone) await reader.cancel().catch(() => undefined);
      await closeWriter(writer);
    }

    return hash.digest("hex");
  }

  private resolveCandidate(definition: SttRuntimeCatalogEntry, platformKey: string): RuntimeCandidate | null {
    for (const candidate of this.candidates(definition, platformKey)) {
      if (this.exists(candidate.binaryPath)) return candidate;
    }
    return null;
  }

  private candidates(definition: SttRuntimeCatalogEntry, platformKey: string): RuntimeCandidate[] {
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

    const cacheRoot = this.cacheInstallRoot(definition, platformKey);
    if (this.isValidCacheInstall(definition, platformKey, cacheRoot)) {
      candidates.push(...this.runtimeDirCandidates(cacheRoot, definition, "cache", definition.version));
    }

    candidates.push(
      ...this.runtimeDirCandidates(join(this.projectRoot, "vendor", "runtimes", platformKey, definition.runtimeDir), definition, "vendor"),
      ...this.runtimeDirCandidates(join(this.projectRoot, "vendor", "runtimes", definition.runtimeDir), definition, "legacy_vendor")
    );

    return candidates;
  }

  private runtimeDirCandidates(
    rootDir: string,
    definition: SttRuntimeCatalogEntry,
    source: RuntimeSource,
    version?: string
  ): RuntimeCandidate[] {
    return definition.executableCandidates.map((candidate) => ({
      binaryPath: join(rootDir, ...candidate.split("/")),
      rootDir,
      source,
      version
    }));
  }

  private runtimeSearchDirs(runtime: Omit<ResolvedSttRuntime, "env">): string[] {
    const definition = this.definition(runtime.id);
    const binaryDir = dirname(runtime.binaryPath);
    const configuredDirs = definition.libraryDirs.map((dir) => join(runtime.rootDir, dir));
    const dirs = [...configuredDirs, runtime.rootDir, binaryDir, join(binaryDir, "lib")];

    const existingDirs = unique(dirs).filter((dir) => this.exists(dir));
    return existingDirs.length ? existingDirs : [binaryDir];
  }

  private cacheInstallRoot(definition: SttRuntimeCatalogEntry, platformKey: string): string {
    return join(this.cacheRuntimeParentDir(definition, platformKey), definition.version);
  }

  private cacheRuntimeParentDir(definition: SttRuntimeCatalogEntry, platformKey: string): string {
    return join(this.runtimeDir ?? join(this.projectRoot, "vendor", "runtime-cache"), platformKey, definition.id);
  }

  private cacheInstallProblem(definition: SttRuntimeCatalogEntry, platformKey: string): string | null {
    const root = this.cacheInstallRoot(definition, platformKey);
    if (!this.exists(root)) return null;

    const receipt = readReceipt(join(root, "runtime.json"));
    if (!receipt) return "Runtime receipt is missing or corrupt.";
    if (receipt.id !== definition.id || receipt.version !== definition.version || receipt.platformKey !== platformKey) {
      return "Runtime receipt does not match the required runtime version.";
    }
    if (!findExecutable(root, definition)) return "Runtime executable is missing.";
    return null;
  }

  private isValidCacheInstall(definition: SttRuntimeCatalogEntry, platformKey: string, root: string): boolean {
    return this.cacheInstallProblem(definition, platformKey) === null && this.exists(root);
  }

  private supportedPlatformKeys(): Set<string> {
    return new Set(supportedSttRuntimePlatformKeys);
  }

  private canDownloadRuntime(definition: SttRuntimeCatalogEntry, platformKey: string): boolean {
    return Boolean(definition.platforms[platformKey]?.url);
  }

  private missingBundledRuntimeMessage(definition: SttRuntimeCatalogEntry, platformKey: string): string {
    return `${definition.label} runtime was not found in bundled application resources for ${platformKey}. Reinstall Murmur or set ${definition.envVar} to a compatible binary.`;
  }

  private definition(id: SttRuntimeId): SttRuntimeCatalogEntry {
    return this.catalog[id];
  }

  private state(
    id: SttRuntimeId,
    status: SttRuntimeInstallStatus,
    patch: Partial<SttRuntimeInstallState> = {}
  ): SttRuntimeInstallState {
    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const asset = definition.platforms[platformKey];
    const state: SttRuntimeInstallState = {
      id,
      label: definition.label,
      platformKey,
      requiredVersion: definition.version,
      status,
      progressBytes: 0,
      totalBytes: asset?.sizeBytes,
      message: "",
      canDownload: Boolean(asset?.url) && status !== "unsupported",
      canRepair: false,
      ...patch
    };
    return this.downloadsEnabled ? state : { ...state, canDownload: false, canRepair: false };
  }

  private emit(state: SttRuntimeInstallState): void {
    if (state.status === "downloading" || state.status === "installing") {
      this.activeStates.set(state.id, state);
    }
    this.emitProgress?.(state);
  }

  private cleanupPartialInstalls(): void {
    const root = this.runtimeDir;
    if (!root || !existsSync(root)) return;
    cleanupPartialEntries(root);
  }
}

function inferRuntimeRoot(binaryPath: string): string {
  const binaryDir = dirname(binaryPath);
  return basename(binaryDir) === "bin" ? dirname(binaryDir) : binaryDir;
}

function prependPathList(dirs: string[], existing: string | undefined): string {
  return [...dirs, ...(existing ? existing.split(":").filter(Boolean) : [])].join(":");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function findExecutable(root: string, definition: SttRuntimeCatalogEntry): string | null {
  for (const candidate of definition.executableCandidates) {
    const binaryPath = join(root, ...candidate.split("/"));
    if (existsSync(binaryPath)) return binaryPath;
  }
  return null;
}

function writeReceipt(path: string, receipt: RuntimeReceipt): void {
  writeFileSync(path, JSON.stringify(receipt, null, 2));
}

function readReceipt(path: string): RuntimeReceipt | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeReceipt>;
    if (!value.id || !value.platformKey || !value.version || !value.archiveName || !value.archiveSha256 || !value.installedAt) {
      return null;
    }
    return value as RuntimeReceipt;
  } catch {
    return null;
  }
}

function replaceDirectory(sourceDir: string, targetDir: string): void {
  const backupDir = `${targetDir}.previous-${process.pid}-${Date.now()}`;
  if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
  if (existsSync(targetDir)) renameSync(targetDir, backupDir);
  try {
    mkdirSync(dirname(targetDir), { recursive: true });
    renameSync(sourceDir, targetDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
    if (existsSync(backupDir)) renameSync(backupDir, targetDir);
    throw error;
  }
}

function chmodExecutables(root: string, definition: SttRuntimeCatalogEntry): void {
  for (const candidate of definition.executableCandidates) {
    const binaryPath = join(root, ...candidate.split("/"));
    if (!existsSync(binaryPath)) continue;
    try {
      chmodSync(binaryPath, 0o755);
    } catch {
      // chmod failures should surface later when the runtime is executed.
    }
  }
}

function singleChildDirectory(dir: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
  if (entries.length !== 1 || !entries[0].isDirectory()) return null;
  return join(dir, entries[0].name);
}

function cleanupPartialEntries(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.includes(".staging-") || entry.name.includes(".previous-")) {
        rmSync(path, { recursive: true, force: true });
      } else {
        cleanupPartialEntries(path);
      }
    } else if (entry.isFile() && entry.name.endsWith(".part")) {
      rmSync(path, { force: true });
    }
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw abortError();
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error(`Request timed out while waiting for response headers after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => reject(abortError()));
    timeout = setTimeout(() => {
      finish(() => reject(new Error(`Download stalled while reading the response body for ${timeoutMs}ms.`)));
    }, timeoutMs);

    signal?.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function writeChunk(writer: NodeJS.WritableStream, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.write(Buffer.from(value), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function assertSafeTarGzArchive(archivePath: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-tzf", archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
        return;
      }
      const unsafeEntry = stdout
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .find(isUnsafeArchiveEntry);
      if (unsafeEntry) {
        reject(new Error(`Archive contains an unsafe path: ${unsafeEntry}`));
      } else {
        resolve();
      }
    };
    const abort = (): void => {
      child.kill();
      finish(abortError());
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(isAbortError(error) ? abortError() : error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`tar archive listing failed with exit code ${code}: ${stderr.trim()}`));
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function isUnsafeArchiveEntry(entry: string): boolean {
  const normalized = entry.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.includes("\0")) return true;
  return normalized.split("/").some((part) => part === "..");
}

function closeWriter(writer: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function extractTarGz(archivePath: string, targetDir: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(targetDir, { recursive: true });
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const child = spawn("tar", ["-xzf", archivePath, "-C", targetDir], { stdio: ["ignore", "ignore", "pipe"], signal });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = (): void => {
      child.kill();
      finish(abortError());
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(isAbortError(error) ? abortError() : error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`tar extraction failed with exit code ${code}: ${stderr.trim()}`));
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
