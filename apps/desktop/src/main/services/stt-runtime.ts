import { spawn } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  getSttRuntimeSupportedAccelerators,
  getSttRuntimeVariantAsset,
  getSttRuntimeVariantKey,
  parseSttRuntimeVariantKey,
  sttRuntimeCatalog,
  sttRuntimeIds,
  sttRuntimeVariantLabel,
  sttRuntimeVariantRuntimeDir,
  supportedSttRuntimePlatformKeys,
  type SttRuntimeAsset,
  type SttRuntimeCatalogEntry
} from "../../shared/stt-runtime-catalog";
import {
  createInstalledTreeReceipt,
  downloadResponseToFile,
  ensureAvailableDiskSpace,
  inspectTarArchive,
  type InstalledTreeReceipt,
  verifyInstalledTreeReceipt,
  withDownloadDeadline
} from "./installation-integrity";
import type {
  SttRuntimeAccelerator,
  SttRuntimeAvailability,
  SttRuntimeId,
  SttRuntimeInstallState,
  SttRuntimeInstallStatus,
  SttRuntimeSource,
  SttRuntimeVariantKey
} from "../../shared/types";

type RuntimeSource = SttRuntimeSource;
type RuntimeCatalog = Record<SttRuntimeId, SttRuntimeCatalogEntry>;
type ProgressEmitter = (state: SttRuntimeInstallState) => void;
type RuntimeMutationHook = (state: SttRuntimeInstallState) => void | Promise<void>;
type DownloadableSttRuntimeAsset = SttRuntimeAsset & { url: string; sizeBytes: number; sha256: string; archiveFormat: "tar.gz" };
export type SttRuntimeActionTarget =
  | SttRuntimeVariantKey
  | {
      id: SttRuntimeId;
      accelerator: SttRuntimeAccelerator;
      variantKey?: SttRuntimeVariantKey;
    };
const defaultDownloadHeaderTimeoutMs = 15000;
const defaultDownloadBodyTimeoutMs = 30000;
const defaultDownloadTotalTimeoutMs = 30 * 60 * 1000;
const defaultProgressEmitIntervalMs = 500;
const progressEmitMinBytes = 1024 * 1024;
const maxArchiveExpansionRatio = 20;

interface RuntimeCandidate {
  binaryPath: string;
  rootDir: string;
  source: RuntimeSource;
  version?: string;
}

interface RuntimeReceipt {
  id: SttRuntimeId;
  platformKey: string;
  accelerator?: SttRuntimeAccelerator;
  variantKey?: SttRuntimeVariantKey;
  version: string;
  upstreamVersion?: string;
  archiveName: string;
  archiveSha256: string;
  installedAt: string;
  tree: InstalledTreeReceipt;
}

interface RuntimeOperation {
  controller: AbortController;
  promise: Promise<SttRuntimeInstallState>;
}

export interface ResolvedSttRuntime {
  id: SttRuntimeId;
  variantKey: SttRuntimeVariantKey;
  accelerator: SttRuntimeAccelerator;
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
  packaged?: boolean;
  downloadsEnabled?: boolean;
  downloadHeaderTimeoutMs?: number;
  downloadBodyTimeoutMs?: number;
  downloadTotalTimeoutMs?: number;
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
  private packaged: boolean;
  private downloadsEnabled: boolean;
  private downloadHeaderTimeoutMs: number;
  private downloadBodyTimeoutMs: number;
  private downloadTotalTimeoutMs: number;
  private progressEmitIntervalMs: number;
  private operations = new Map<SttRuntimeVariantKey, RuntimeOperation>();
  private activeStates = new Map<SttRuntimeVariantKey, SttRuntimeInstallState>();
  private lastErrors = new Map<SttRuntimeVariantKey, string>();

  constructor(options: SttRuntimeServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.env = options.env ?? process.env;
    this.resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    this.projectRoot = options.projectRoot ?? defaultProjectRoot();
    this.runtimeDir = options.runtimeDir;
    this.exists = options.exists ?? existsSync;
    this.fetchImpl = options.fetch ?? fetch;
    this.extractArchiveImpl = options.extractArchive ?? extractTarGz;
    this.catalog = options.catalog ?? sttRuntimeCatalog;
    this.emitProgress = options.emitProgress;
    this.onBeforeRuntimeMutation = options.onBeforeRuntimeMutation;
    this.packaged = options.packaged ?? false;
    this.downloadsEnabled = options.downloadsEnabled ?? true;
    this.downloadHeaderTimeoutMs = options.downloadHeaderTimeoutMs ?? defaultDownloadHeaderTimeoutMs;
    this.downloadBodyTimeoutMs = options.downloadBodyTimeoutMs ?? defaultDownloadBodyTimeoutMs;
    this.downloadTotalTimeoutMs = options.downloadTotalTimeoutMs ?? defaultDownloadTotalTimeoutMs;
    this.progressEmitIntervalMs = options.progressEmitIntervalMs ?? defaultProgressEmitIntervalMs;
    this.recoverPartialInstalls();
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

  getAvailability(id: SttRuntimeId, accelerator: SttRuntimeAccelerator = "cpu"): SttRuntimeAvailability {
    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const variantKey = this.variantKey(definition, platformKey, accelerator);
    const asset = getSttRuntimeVariantAsset(definition, platformKey, accelerator);
    const label = sttRuntimeVariantLabel(definition, accelerator);

    if (!this.supportedPlatformKeys().has(platformKey) || !asset) {
      return {
        id,
        variantKey,
        accelerator,
        label,
        status: "unsupported",
        platformKey,
        version: definition.version,
        abi: asset?.abi,
        message: !this.supportedPlatformKeys().has(platformKey)
          ? `${label} is not bundled for ${platformKey}. Supported platforms: ${Array.from(this.supportedPlatformKeys()).join(", ")}.`
          : `${label} is not configured for ${platformKey}.`
      };
    }

    const candidate = this.resolveCandidate(definition, platformKey, accelerator);
    if (!candidate) {
      const canDownloadRuntime = this.canDownloadRuntime(definition, platformKey, accelerator);
      return {
        id,
        variantKey,
        accelerator,
        label,
        status: "missing",
        platformKey,
        version: definition.version,
        abi: asset.abi,
        message: this.downloadsEnabled && canDownloadRuntime
          ? `${label} runtime binary was not found for ${platformKey}. Set ${this.envVar(definition, accelerator)}, install it from the setup flow, or install it under vendor/runtimes/${platformKey}/${this.runtimeDirName(definition, platformKey, accelerator)}.`
          : this.downloadsEnabled
            ? `${label} runtime binary was not found for ${platformKey}. Set ${this.envVar(definition, accelerator)} or run bun run runtimes:prepare to install it under vendor/runtimes/${platformKey}/${this.runtimeDirName(definition, platformKey, accelerator)}.`
            : this.missingBundledRuntimeMessage(definition, platformKey, accelerator)
      };
    }

    return {
      id,
      variantKey,
      accelerator,
      label,
      status: "available",
      platformKey,
      binaryPath: candidate.binaryPath,
      source: candidate.source,
      version: candidate.version ?? definition.version,
      abi: asset.abi,
      message: `${label} runtime is available.`
    };
  }

  getAutomaticAvailability(id: SttRuntimeId): SttRuntimeAvailability {
    for (const accelerator of this.automaticAcceleratorOrder(id)) {
      const availability = this.getAvailability(id, accelerator);
      if (availability.status === "available") return availability;
    }
    return this.getAvailability(id, "cpu");
  }

  getAvailabilities(): Record<SttRuntimeVariantKey, SttRuntimeAvailability> {
    const entries: Array<[string, SttRuntimeAvailability]> = [];
    for (const variant of this.runtimeVariants()) {
      const availability = this.getAvailability(variant.id, variant.accelerator);
      entries.push([availability.variantKey, availability]);
    }
    return Object.fromEntries(entries);
  }

  getInstallState(id: SttRuntimeId, accelerator: SttRuntimeAccelerator = "cpu"): SttRuntimeInstallState {
    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const variantKey = this.variantKey(definition, platformKey, accelerator);
    const active = this.activeStates.get(variantKey);
    if (active) return active;

    const asset = getSttRuntimeVariantAsset(definition, platformKey, accelerator);
    const supported = this.supportedPlatformKeys().has(platformKey) && Boolean(asset);
    const canDownloadRuntime = this.canDownloadRuntime(definition, platformKey, accelerator);

    if (!supported) {
      return this.state(id, accelerator, "unsupported", {
        message: `${sttRuntimeVariantLabel(definition, accelerator)} is not available for ${platformKey}.`,
        canDownload: false,
        canRepair: false
      });
    }

    const candidate = this.resolveCandidate(definition, platformKey, accelerator);
    if (candidate) {
      return this.state(id, accelerator, "ready", {
        installedVersion: candidate.version ?? definition.version,
        source: candidate.source,
        binaryPath: candidate.binaryPath,
        rootDir: candidate.rootDir,
        message: `${sttRuntimeVariantLabel(definition, accelerator)} runtime is ready.`,
        canDownload: candidate.source === "cache" && canDownloadRuntime,
        canRepair: candidate.source === "cache" && canDownloadRuntime
      });
    }

    const cacheProblem = this.cacheInstallProblem(definition, platformKey, accelerator);
    if (cacheProblem && this.downloadsEnabled && canDownloadRuntime) {
      return this.state(id, accelerator, "repairable", {
        error: cacheProblem,
        message: `${sttRuntimeVariantLabel(definition, accelerator)} runtime cache needs repair.`,
        canDownload: true,
        canRepair: true
      });
    }

    const error = this.lastErrors.get(variantKey);
    if (error) {
      return this.state(id, accelerator, "error", {
        error,
        message: `${sttRuntimeVariantLabel(definition, accelerator)} runtime install failed.`,
        canDownload: canDownloadRuntime,
        canRepair: canDownloadRuntime
      });
    }

    return this.state(id, accelerator, "not_installed", {
      message: this.downloadsEnabled
        ? `${sttRuntimeVariantLabel(definition, accelerator)} runtime is not installed. Run bun run runtimes:prepare or set ${this.envVar(definition, accelerator)} to a compatible binary.`
        : this.missingBundledRuntimeMessage(definition, platformKey, accelerator),
      canDownload: this.downloadsEnabled && canDownloadRuntime,
      canRepair: false
    });
  }

  getInstallStates(): Record<SttRuntimeVariantKey, SttRuntimeInstallState> {
    const entries: Array<[string, SttRuntimeInstallState]> = [];
    for (const variant of this.runtimeVariants()) {
      const state = this.getInstallState(variant.id, variant.accelerator);
      entries.push([state.variantKey, state]);
    }
    return Object.fromEntries(entries);
  }

  async downloadRuntime(target: SttRuntimeActionTarget): Promise<SttRuntimeInstallState> {
    const variant = this.resolveTarget(target);
    if (!this.downloadsEnabled) return this.getInstallState(variant.id, variant.accelerator);

    const existingOperation = this.operations.get(variant.variantKey);
    if (existingOperation) return existingOperation.promise;

    const definition = this.definition(variant.id);
    const platformKey = variant.platformKey;
    const asset = getSttRuntimeVariantAsset(definition, platformKey, variant.accelerator);
    if (!this.supportedPlatformKeys().has(platformKey) || !asset || !this.canDownloadRuntime(definition, platformKey, variant.accelerator)) {
      const unsupported = this.getInstallState(variant.id, variant.accelerator);
      this.emit(unsupported);
      return unsupported;
    }
    const downloadableAsset: DownloadableSttRuntimeAsset = {
      ...asset,
      url: asset.url!,
      sizeBytes: asset.sizeBytes!,
      sha256: asset.sha256!,
      archiveFormat: "tar.gz"
    };

    const controller = new AbortController();
    const promise = this.installRuntime(variant.id, variant.accelerator, definition, downloadableAsset, controller).finally(() => {
      this.operations.delete(variant.variantKey);
      this.activeStates.delete(variant.variantKey);
    });
    this.operations.set(variant.variantKey, { controller, promise });
    return promise;
  }

  async repairRuntime(target: SttRuntimeActionTarget): Promise<SttRuntimeInstallState> {
    return this.downloadRuntime(target);
  }

  async cancelRuntimeDownload(target: SttRuntimeActionTarget): Promise<SttRuntimeInstallState> {
    const variant = this.resolveTarget(target);
    const operation = this.operations.get(variant.variantKey);
    if (!operation) return this.getInstallState(variant.id, variant.accelerator);

    operation.controller.abort();
    try {
      await operation.promise;
    } catch {
      // The download path records cancellation state before resolving back to the caller.
    }
    return this.getInstallState(variant.id, variant.accelerator);
  }

  async dispose(): Promise<void> {
    const operations = Array.from(this.operations.values());
    for (const operation of operations) operation.controller.abort();
    await Promise.allSettled(operations.map((operation) => operation.promise));
  }

  requireRuntime(id: SttRuntimeId, accelerator: SttRuntimeAccelerator = "cpu"): ResolvedSttRuntime {
    const definition = this.definition(id);
    const availability = this.getAvailability(id, accelerator);
    if (availability.status !== "available" || !availability.binaryPath || !availability.source) {
      throw new Error(availability.message);
    }

    const candidate = this.resolveCandidate(definition, availability.platformKey, accelerator);
    if (!candidate) {
      throw new Error(availability.message);
    }

    const runtime: Omit<ResolvedSttRuntime, "env"> = {
      id,
      variantKey: availability.variantKey,
      accelerator,
      label: availability.label,
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

  requireAutomaticRuntime(id: SttRuntimeId): ResolvedSttRuntime {
    const attempted: string[] = [];
    for (const accelerator of this.automaticAcceleratorOrder(id)) {
      const availability = this.getAvailability(id, accelerator);
      attempted.push(`${availability.label}: ${availability.message}`);
      if (availability.status === "available") return this.requireRuntime(id, accelerator);
    }
    throw new Error(`No ${this.definition(id).label} runtime is available. ${attempted.join(" ")}`);
  }

  buildSpawnEnv(runtime: Omit<ResolvedSttRuntime, "env">): NodeJS.ProcessEnv {
    const env = { ...this.env };
    const dirs = this.runtimeSearchDirs(runtime);

    if (runtime.platformKey.startsWith("darwin-")) {
      env.DYLD_LIBRARY_PATH = prependPathList(dirs, env.DYLD_LIBRARY_PATH);
    } else {
      env.LD_LIBRARY_PATH = prependPathList(dirs, env.LD_LIBRARY_PATH);
    }

    return env;
  }

  private async installRuntime(
    id: SttRuntimeId,
    accelerator: SttRuntimeAccelerator,
    definition: SttRuntimeCatalogEntry,
    asset: DownloadableSttRuntimeAsset,
    controller: AbortController
  ): Promise<SttRuntimeInstallState> {
    const platformKey = this.getPlatformKey();
    const variantKey = this.variantKey(definition, platformKey, accelerator);
    const parentDir = this.cacheRuntimeParentDir(definition, platformKey, accelerator);
    const finalDir = this.cacheInstallRoot(definition, platformKey, accelerator);
    const archivePath = join(parentDir, `${asset.assetName}.part`);
    const stagingDir = join(parentDir, `${definition.version}.staging-${process.pid}-${Date.now()}`);
    const extractDir = join(stagingDir, "extract");
    let backupDir: string | undefined;
    let promotedFinal = false;

    mkdirSync(parentDir, { recursive: true });
    rmSync(archivePath, { force: true });
    rmSync(stagingDir, { recursive: true, force: true });
    this.lastErrors.delete(variantKey);

    this.emit(
      this.state(id, accelerator, "downloading", {
        progressBytes: 0,
        totalBytes: asset.sizeBytes,
        message: `Downloading ${sttRuntimeVariantLabel(definition, accelerator)} runtime.`,
        canDownload: false,
        canRepair: false
      })
    );

    try {
      const archiveSha256 = await this.downloadArchive(asset, archivePath, variantKey, controller);
      if (archiveSha256 !== asset.sha256) {
        rmSync(archivePath, { force: true });
        throw new Error(`SHA-256 mismatch for ${asset.assetName}. Expected ${asset.sha256}, got ${archiveSha256}.`);
      }

      this.emit(
        this.state(id, accelerator, "installing", {
          progressBytes: asset.sizeBytes,
          totalBytes: asset.sizeBytes,
          message: `Installing ${sttRuntimeVariantLabel(definition, accelerator)} runtime.`,
          canDownload: false,
          canRepair: false
        })
      );

      if (controller.signal.aborted) throw abortError();
      mkdirSync(extractDir, { recursive: true });
      const maxExtractedBytes = asset.sizeBytes * maxArchiveExpansionRatio;
      const extractedBytes = await inspectTarArchive(archivePath, "gz", maxExtractedBytes, controller.signal);
      ensureAvailableDiskSpace(stagingDir, extractedBytes);
      if (controller.signal.aborted) throw abortError();
      await this.extractArchiveImpl(archivePath, extractDir, controller.signal);
      if (controller.signal.aborted) throw abortError();
      const extractedRoot = singleChildDirectory(extractDir) ?? extractDir;
      chmodExecutables(extractedRoot, definition);
      const binaryProblem = validateRuntimeExecutable(extractedRoot, definition);
      if (binaryProblem) throw new Error(binaryProblem);
      writeReceipt(join(extractedRoot, "runtime.json"), {
        id,
        platformKey,
        accelerator,
        variantKey,
        version: definition.version,
        upstreamVersion: definition.upstreamVersion,
        archiveName: asset.assetName,
        archiveSha256: asset.sha256,
        installedAt: new Date().toISOString(),
        tree: createInstalledTreeReceipt(extractedRoot, maxExtractedBytes)
      });

      const installingState = this.state(id, accelerator, "installing", {
        progressBytes: asset.sizeBytes,
        totalBytes: asset.sizeBytes
      });
      await this.onBeforeRuntimeMutation?.(installingState);
      backupDir = replaceDirectory(extractedRoot, finalDir);
      promotedFinal = true;

      this.activeStates.delete(variantKey);
      const ready = this.getInstallState(id, accelerator);
      if (ready.status !== "ready") throw new Error(ready.error ?? ready.message);
      if (backupDir) rmSync(backupDir, { recursive: true, force: true });
      backupDir = undefined;
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });
      this.emit(ready);
      return ready;
    } catch (error) {
      if (backupDir) restoreDirectoryBackup(finalDir, backupDir);
      else if (promotedFinal) rmSync(finalDir, { recursive: true, force: true });
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });
      const errorText = isAbortError(error) ? "Runtime download was cancelled." : message(error);
      if (!isAbortError(error)) this.lastErrors.set(variantKey, errorText);
      this.activeStates.delete(variantKey);
      const state = this.getInstallState(id, accelerator);
      this.emit(
        state.status === "ready"
          ? state
          : {
              ...state,
              status: isAbortError(error) ? "not_installed" : state.status,
              error: isAbortError(error) ? undefined : errorText,
              message: isAbortError(error) ? `${sttRuntimeVariantLabel(definition, accelerator)} runtime download was cancelled.` : state.message
            }
      );
      return this.getInstallState(id, accelerator);
    }
  }

  private async downloadArchive(
    asset: DownloadableSttRuntimeAsset,
    archivePath: string,
    variantKey: SttRuntimeVariantKey,
    controller: AbortController
  ): Promise<string> {
    return withDownloadDeadline(controller.signal, this.downloadTotalTimeoutMs, async (deadlineSignal) => {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        asset.url,
        {
          headers: { "User-Agent": "murmur-runtime-manager" }
        },
        this.downloadHeaderTimeoutMs,
        deadlineSignal
      );
      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
      }

      let lastEmittedAt = 0;
      let lastProgressBytes = 0;
      const result = await downloadResponseToFile({
        response,
        filePath: archivePath,
        expectedBytes: asset.sizeBytes,
        idleTimeoutMs: this.downloadBodyTimeoutMs,
        signal: deadlineSignal,
        onProgress: (progressBytes) => {
          const active = this.activeStates.get(variantKey);
          const now = Date.now();
          const firstPositiveProgress = lastProgressBytes === 0 && progressBytes > 0;
          const shouldEmit =
            active &&
            (lastEmittedAt === 0 ||
              firstPositiveProgress ||
              progressBytes - lastProgressBytes >= progressEmitMinBytes ||
              now - lastEmittedAt >= this.progressEmitIntervalMs ||
              progressBytes >= asset.sizeBytes);
          if (active && shouldEmit) {
            lastEmittedAt = now;
            lastProgressBytes = progressBytes;
            this.emit({
              ...active,
              progressBytes,
              totalBytes: asset.sizeBytes,
              message: `Downloading ${active.label} runtime.`
            });
          }
        }
      });
      return result.sha256;
    });
  }

  private resolveCandidate(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): RuntimeCandidate | null {
    for (const candidate of this.candidates(definition, platformKey, accelerator)) {
      if (this.exists(candidate.binaryPath)) return candidate;
    }
    return null;
  }

  private candidates(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): RuntimeCandidate[] {
    const envPath = this.env[this.envVar(definition, accelerator)];
    const candidates: RuntimeCandidate[] = [];
    const runtimeDir = this.runtimeDirName(definition, platformKey, accelerator);

    if (envPath) {
      candidates.push({
        binaryPath: envPath,
        rootDir: inferRuntimeRoot(envPath),
        source: "env"
      });
    }

    if (this.resourcesPath) {
      candidates.push(
        ...this.runtimeDirCandidates(join(this.resourcesPath, "runtimes", platformKey, runtimeDir), definition, "resources")
      );
    }

    const cacheRoot = this.cacheInstallRoot(definition, platformKey, accelerator);
    if (this.isValidCacheInstall(definition, platformKey, accelerator, cacheRoot)) {
      candidates.push(...this.runtimeDirCandidates(cacheRoot, definition, "cache", definition.version));
    }

    candidates.push(...this.runtimeDirCandidates(join(this.projectRoot, "vendor", "runtimes", platformKey, runtimeDir), definition, "vendor"));

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

  private cacheInstallRoot(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): string {
    return join(this.cacheRuntimeParentDir(definition, platformKey, accelerator), definition.version);
  }

  private cacheRuntimeParentDir(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): string {
    return join(
      this.runtimeDir ?? join(this.projectRoot, "vendor", "runtime-cache"),
      platformKey,
      definition.id,
      accelerator
    );
  }

  private cacheInstallProblem(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator,
    root = this.cacheInstallRoot(definition, platformKey, accelerator)
  ): string | null {
    if (!this.exists(root)) return null;

    const receipt = readReceipt(join(root, "runtime.json"));
    if (!receipt) return "Runtime receipt is missing or corrupt.";
    if (receipt.id !== definition.id || receipt.version !== definition.version || receipt.platformKey !== platformKey) {
      return "Runtime receipt does not match the required runtime version.";
    }
    if (receipt.upstreamVersion && receipt.upstreamVersion !== definition.upstreamVersion) {
      return "Runtime receipt does not match the required upstream runtime version.";
    }
    const receiptAccelerator = receipt.accelerator ?? "cpu";
    if (receiptAccelerator !== accelerator) {
      return "Runtime receipt does not match the required accelerator.";
    }
    const asset = getSttRuntimeVariantAsset(definition, platformKey, accelerator);
    if (!asset?.sizeBytes || !receipt.tree) return "Runtime receipt is missing required file integrity metadata.";
    const treeProblem = verifyInstalledTreeReceipt(root, receipt.tree, asset.sizeBytes * maxArchiveExpansionRatio);
    if (treeProblem) return treeProblem;
    return validateRuntimeExecutable(root, definition);
  }

  private isValidCacheInstall(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator,
    root: string
  ): boolean {
    return this.cacheInstallProblem(definition, platformKey, accelerator, root) === null && this.exists(root);
  }

  private supportedPlatformKeys(): Set<string> {
    return new Set(supportedSttRuntimePlatformKeys);
  }

  private canDownloadRuntime(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): boolean {
    const asset = getSttRuntimeVariantAsset(definition, platformKey, accelerator);
    if (!asset) return false;
    const hasReleaseAsset =
      (asset.archiveFormat === undefined || asset.archiveFormat === "tar.gz") &&
      Boolean(asset.url) &&
      Boolean(asset.sha256 && /^[a-f0-9]{64}$/.test(asset.sha256)) &&
      Number.isFinite(asset.sizeBytes) &&
      (asset.sizeBytes ?? 0) > 0;
    if (!hasReleaseAsset) return false;
    if (!this.downloadsEnabled) return false;
    return !this.packaged || accelerator !== "cpu";
  }

  private missingBundledRuntimeMessage(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): string {
    const label = sttRuntimeVariantLabel(definition, accelerator);
    if (this.packaged && accelerator !== "cpu") {
      return `${label} runtime was not found for ${platformKey}. Accelerated runtimes can be installed only from Murmur release assets with pinned SHA-256 metadata.`;
    }
    return `${label} runtime was not found in bundled application resources for ${platformKey}. Reinstall Murmur or set ${this.envVar(definition, accelerator)} to a compatible binary.`;
  }

  private definition(id: SttRuntimeId): SttRuntimeCatalogEntry {
    return this.catalog[id];
  }

  private runtimeVariants(): Array<{
    id: SttRuntimeId;
    platformKey: string;
    accelerator: SttRuntimeAccelerator;
    variantKey: SttRuntimeVariantKey;
  }> {
    const platformKey = this.getPlatformKey();
    return sttRuntimeIds.flatMap((id) => {
      const definition = this.definition(id);
      return getSttRuntimeSupportedAccelerators(definition, platformKey).map((accelerator) => ({
        id,
        platformKey,
        accelerator,
        variantKey: this.variantKey(definition, platformKey, accelerator)
      }));
    });
  }

  private resolveTarget(target: SttRuntimeActionTarget): {
    id: SttRuntimeId;
    platformKey: string;
    accelerator: SttRuntimeAccelerator;
    variantKey: SttRuntimeVariantKey;
  } {
    const platformKey = this.getPlatformKey();
    if (typeof target === "string") {
      const parsed = parseSttRuntimeVariantKey(target);
      if (parsed) {
        return {
          id: parsed.id,
          platformKey: parsed.platformKey,
          accelerator: parsed.accelerator,
          variantKey: target
        };
      }
      throw new Error(`Invalid STT runtime variant key: ${target}`);
    }

    const parsedVariant = target.variantKey ? parseSttRuntimeVariantKey(target.variantKey) : null;
    const accelerator = parsedVariant?.accelerator ?? target.accelerator;
    return {
      id: parsedVariant?.id ?? target.id,
      platformKey: parsedVariant?.platformKey ?? platformKey,
      accelerator,
      variantKey: target.variantKey ?? this.variantKey(this.definition(target.id), platformKey, accelerator)
    };
  }

  private automaticAcceleratorOrder(id: SttRuntimeId): SttRuntimeAccelerator[] {
    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const supported = new Set(getSttRuntimeSupportedAccelerators(definition, platformKey));
    return (["cuda", "cpu"] as const).filter((accelerator) => supported.has(accelerator));
  }

  private envVar(definition: SttRuntimeCatalogEntry, accelerator: SttRuntimeAccelerator): string {
    return definition.acceleratorEnvVars?.[accelerator] ?? definition.envVar;
  }

  private runtimeDirName(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): string {
    return sttRuntimeVariantRuntimeDir(definition, platformKey, accelerator);
  }

  private variantKey(
    definition: SttRuntimeCatalogEntry,
    platformKey: string,
    accelerator: SttRuntimeAccelerator
  ): SttRuntimeVariantKey {
    return getSttRuntimeVariantKey(definition.id, platformKey, accelerator, definition.version);
  }

  private state(
    id: SttRuntimeId,
    accelerator: SttRuntimeAccelerator,
    status: SttRuntimeInstallStatus,
    patch: Partial<SttRuntimeInstallState> = {}
  ): SttRuntimeInstallState {
    const definition = this.definition(id);
    const platformKey = this.getPlatformKey();
    const asset = getSttRuntimeVariantAsset(definition, platformKey, accelerator);
    const variantKey = this.variantKey(definition, platformKey, accelerator);
    const state: SttRuntimeInstallState = {
      id,
      variantKey,
      accelerator,
      label: sttRuntimeVariantLabel(definition, accelerator),
      platformKey,
      requiredVersion: definition.version,
      abi: asset?.abi,
      status,
      progressBytes: 0,
      totalBytes: asset?.sizeBytes,
      message: "",
      canDownload: this.canDownloadRuntime(definition, platformKey, accelerator) && status !== "unsupported",
      canRepair: false,
      ...patch
    };
    return state;
  }

  private emit(state: SttRuntimeInstallState): void {
    if (state.status === "downloading" || state.status === "installing") {
      this.activeStates.set(state.variantKey, state);
    }
    this.emitProgress?.(state);
  }

  private recoverPartialInstalls(): void {
    const root = this.runtimeDir;
    if (!root || !existsSync(root)) return;
    cleanupPartialEntries(root);

    for (const variant of this.runtimeVariants()) {
      const definition = this.definition(variant.id);
      const finalDir = this.cacheInstallRoot(definition, variant.platformKey, variant.accelerator);
      const parentDir = dirname(finalDir);
      if (!existsSync(parentDir)) continue;
      const backupPrefix = `${basename(finalDir)}.previous-`;
      const backups = readdirSync(parentDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(backupPrefix))
        .map((entry) => join(parentDir, entry.name))
        .sort()
        .reverse();
      if (backups.length === 0) continue;

      if (this.isValidCacheInstall(definition, variant.platformKey, variant.accelerator, finalDir)) {
        for (const backup of backups) rmSync(backup, { recursive: true, force: true });
        continue;
      }

      const validBackup = backups.find((backup) =>
        this.isValidCacheInstall(definition, variant.platformKey, variant.accelerator, backup)
      );
      if (!validBackup) continue;
      rmSync(finalDir, { recursive: true, force: true });
      renameSync(validBackup, finalDir);
      for (const backup of backups) {
        if (backup !== validBackup) rmSync(backup, { recursive: true, force: true });
      }
    }
  }
}

function defaultProjectRoot(): string {
  const cwd = process.cwd();
  const monorepoRoot = resolve(cwd, "..", "..");
  return existsSync(join(monorepoRoot, "apps", "desktop", "package.json")) ? monorepoRoot : cwd;
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

function validateRuntimeExecutable(root: string, definition: SttRuntimeCatalogEntry): string | null {
  const canonicalRoot = realpathSync(root);
  let problem = "Runtime executable is missing.";
  for (const candidate of definition.executableCandidates) {
    const binaryPath = join(root, ...candidate.split("/"));
    if (!existsSync(binaryPath)) continue;
    const stats = lstatSync(binaryPath);
    if (!stats.isFile()) {
      problem = "Runtime executable is not a regular file.";
      continue;
    }
    const canonicalBinary = realpathSync(binaryPath);
    const relativePath = relative(canonicalRoot, canonicalBinary);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      problem = "Runtime executable resolves outside its installation root.";
      continue;
    }
    try {
      accessSync(binaryPath, constants.X_OK);
    } catch {
      problem = "Runtime executable is not executable.";
      continue;
    }
    if (statSync(binaryPath).size <= 0) {
      problem = "Runtime executable is empty.";
      continue;
    }
    return null;
  }
  return problem;
}

function writeReceipt(path: string, receipt: RuntimeReceipt): void {
  writeFileSync(path, JSON.stringify(receipt, null, 2));
}

function readReceipt(path: string): RuntimeReceipt | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeReceipt>;
    if (
      !value.id ||
      !value.platformKey ||
      !value.version ||
      !value.archiveName ||
      !value.archiveSha256 ||
      !value.installedAt ||
      !value.tree?.files ||
      !value.tree.symlinks
    ) {
      return null;
    }
    return value as RuntimeReceipt;
  } catch {
    return null;
  }
}

function replaceDirectory(sourceDir: string, targetDir: string): string | undefined {
  const backupDir = `${targetDir}.previous-${process.pid}-${Date.now()}`;
  const hadTarget = existsSync(targetDir);
  if (hadTarget) renameSync(targetDir, backupDir);
  try {
    mkdirSync(dirname(targetDir), { recursive: true });
    renameSync(sourceDir, targetDir);
    return hadTarget ? backupDir : undefined;
  } catch (error) {
    if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
    if (hadTarget && existsSync(backupDir)) renameSync(backupDir, targetDir);
    throw error;
  }
}

function restoreDirectoryBackup(targetDir: string, backupDir: string): void {
  rmSync(targetDir, { recursive: true, force: true });
  if (existsSync(backupDir)) renameSync(backupDir, targetDir);
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
      if (entry.name.includes(".staging-")) {
        rmSync(path, { recursive: true, force: true });
      } else if (!entry.name.includes(".previous-")) {
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
