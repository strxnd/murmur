import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import {
  canActivateModel,
  isLlmProviderUsable,
  isModelProviderUsable,
  llmProviderId,
  sttProviderId
} from "../../shared/model-activation";
import { modelCatalog } from "../../shared/model-catalog";
import type {
  LlmProviderConfig,
  ModelCatalogItem,
  ModelDownloadState,
  ModelKind,
  ModelLibrarySnapshot,
  ProviderRuntimeSnapshot,
  SttRuntimeId
} from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { joinUrl } from "./http";
import {
  createInstalledTreeReceipt,
  downloadResponseToFile,
  ensureAvailableDiskSpace,
  inspectTarArchive,
  type InstalledTreeReceipt,
  verifyInstalledTreeReceipt,
  withDownloadDeadline
} from "./installation-integrity";
import { llmProviderAuthHeaders } from "./provider-auth";
import { StorageService } from "./storage";
import { SttRuntimeService } from "./stt-runtime";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const ollamaNotRunning = "Ollama is not running at http://127.0.0.1:11434.";
const defaultDownloadHeaderTimeoutMs = 15000;
const defaultDownloadBodyTimeoutMs = 30000;
const defaultDownloadTotalTimeoutMs = 30 * 60 * 1000;
const defaultProgressEmitIntervalMs = 500;
const progressEmitMinBytes = 1024 * 1024;
const maxArchiveExpansionRatio = 20;
const modelReceiptName = ".murmur-model.json";

type ProgressEmitter = (state: ModelDownloadState) => void;

interface ModelDownloadOperation {
  controller: AbortController;
  promise: Promise<ModelLibrarySnapshot>;
}

interface DownloadProgressSnapshot {
  lastEmittedAt: number;
  lastProgressBytes: number;
}

interface DownloadToFileResult {
  progressBytes: number;
  totalBytes: number;
  sha256: string;
}

interface ModelArchiveReceipt {
  modelId: string;
  archiveSha256: string;
  installedAt: string;
  tree: InstalledTreeReceipt;
}

export interface ModelLibraryServiceOptions {
  downloadHeaderTimeoutMs?: number;
  downloadBodyTimeoutMs?: number;
  downloadTotalTimeoutMs?: number;
  progressEmitIntervalMs?: number;
  getProviderRuntime?: () => ProviderRuntimeSnapshot;
  beginModelMutation?: (modelPath: string, signal?: AbortSignal) => Promise<() => void>;
}

export class ModelLibraryService {
  private activeDownloads = new Map<string, ModelDownloadOperation>();
  private progressSnapshots = new Map<string, DownloadProgressSnapshot>();
  private downloadHeaderTimeoutMs: number;
  private downloadBodyTimeoutMs: number;
  private downloadTotalTimeoutMs: number;
  private progressEmitIntervalMs: number;
  private getProviderRuntime?: () => ProviderRuntimeSnapshot;
  private beginModelMutation?: (modelPath: string, signal?: AbortSignal) => Promise<() => void>;

  constructor(
    private paths: AppPaths,
    private storage: StorageService,
    private emitProgress: ProgressEmitter,
    private runtimeService = new SttRuntimeService(),
    options: ModelLibraryServiceOptions = {}
  ) {
    this.downloadHeaderTimeoutMs = options.downloadHeaderTimeoutMs ?? defaultDownloadHeaderTimeoutMs;
    this.downloadBodyTimeoutMs = options.downloadBodyTimeoutMs ?? defaultDownloadBodyTimeoutMs;
    this.downloadTotalTimeoutMs = options.downloadTotalTimeoutMs ?? defaultDownloadTotalTimeoutMs;
    this.progressEmitIntervalMs = options.progressEmitIntervalMs ?? defaultProgressEmitIntervalMs;
    this.getProviderRuntime = options.getProviderRuntime;
    this.beginModelMutation = options.beginModelMutation;
    this.cleanupPartialModelInstalls();
    this.refreshCachedModelDownloadStates();
  }

  async getLibrary(): Promise<ModelLibrarySnapshot> {
    this.refreshCachedModelDownloadStates();
    await this.refreshDiscoveredLocalModels();
    await this.refreshOllamaDownloadStates();
    return this.snapshot();
  }

  async downloadModel(modelId: string): Promise<ModelLibrarySnapshot> {
    const item = this.findCatalogItem(modelId);
    if (!item || item.downloadStrategy === "none") return this.snapshot();
    const existingOperation = this.activeDownloads.get(modelId);
    if (existingOperation) return existingOperation.promise;

    const controller = new AbortController();
    const promise = this.performModelDownload(item, controller.signal).finally(() => {
      this.activeDownloads.delete(modelId);
    });
    this.activeDownloads.set(modelId, { controller, promise });
    return promise;
  }

  async cancelModelDownload(modelId: string): Promise<ModelLibrarySnapshot> {
    const operation = this.activeDownloads.get(modelId);
    if (!operation) return this.snapshot();

    operation.controller.abort();
    try {
      await operation.promise;
    } catch {
      // The download path records cancellation state before resolving back to the caller.
    }
    return this.snapshot();
  }

  async dispose(): Promise<void> {
    const operations = Array.from(this.activeDownloads.values());
    for (const operation of operations) operation.controller.abort();
    await Promise.allSettled(operations.map((operation) => operation.promise));
  }

  private async performModelDownload(item: ModelCatalogItem, signal: AbortSignal): Promise<ModelLibrarySnapshot> {
    if (item.downloadStrategy === "direct_file") {
      await this.downloadDirectFile(item, signal);
    } else if (item.downloadStrategy === "archive") {
      await this.downloadArchive(item, signal);
    } else {
      await this.pullOllamaModel(item, signal);
    }

    this.enableProviderForActivation(item);
    if (this.isModelReady(item) && !this.hasUsableActiveModel(item.kind)) {
      this.storage.setActiveModel(item.kind, item.id);
    }

    return this.snapshot();
  }

  async activateModel(modelId: string): Promise<ModelLibrarySnapshot> {
    const item = this.findCatalogItem(modelId);
    if (!item) return this.snapshot();
    this.enableProviderForActivation(item);
    if (!this.isModelReady(item)) return this.snapshot();

    this.storage.setActiveModel(item.kind, item.id);
    return this.snapshot();
  }

  async deleteDownloadedModel(modelId: string): Promise<ModelLibrarySnapshot> {
    const item = this.findCatalogItem(modelId);
    const existing = this.getDownloadState(modelId);
    const expectedPath = item ? this.expectedLocalPath(item) : undefined;
    if ((item?.downloadStrategy === "direct_file" || item?.downloadStrategy === "archive") && expectedPath && existsSync(expectedPath)) {
      await this.withModelMutation(expectedPath, undefined, () => {
        rmSync(expectedPath, { recursive: item.downloadStrategy === "archive", force: true });
      });
    }
    if (item?.downloadStrategy === "ollama_pull" && item.ollamaModel) {
      try {
        await this.deleteOllamaModel(item.ollamaModel);
      } catch (error) {
        this.persistAndEmit({
          modelId,
          status: "error",
          progressBytes: existing?.progressBytes ?? 0,
          totalBytes: existing?.totalBytes,
          error: message(error).includes("fetch failed") ? ollamaNotRunning : message(error),
          favorite: Boolean(existing?.favorite)
        });
        return this.snapshot();
      }
    }

    const favorite = Boolean(existing?.favorite);
    if (favorite) {
      this.persistDownload({
        modelId,
        status: "not_downloaded",
        progressBytes: 0,
        favorite
      });
    } else {
      this.storage.deleteModelDownload(modelId);
    }
    if (item && this.storage.getState().modelLibrary.activeModelIds[item.kind] === modelId) {
      this.storage.setActiveModel(item.kind, undefined);
    }
    return this.snapshot();
  }

  async toggleFavorite(modelId: string): Promise<ModelLibrarySnapshot> {
    const existing = this.getDownloadState(modelId);
    this.persistDownload({
      modelId,
      status: existing?.status ?? "not_downloaded",
      progressBytes: existing?.progressBytes ?? 0,
      totalBytes: existing?.totalBytes,
      localPath: existing?.localPath,
      error: existing?.error,
      downloadedAt: existing?.downloadedAt,
      verification: existing?.verification,
      favorite: !existing?.favorite
    });
    return this.snapshot();
  }

  snapshot(): ModelLibrarySnapshot {
    const state = this.storage.getState();
    return {
      catalog: state.modelLibrary.catalog,
      downloads: state.modelLibrary.downloads,
      activeModelIds: state.modelLibrary.activeModelIds
    };
  }

  verifyModelPathForUse(modelPath: string): boolean {
    const item = this.storage
      .getState()
      .modelLibrary.catalog.find(
        (candidate) =>
          (candidate.downloadStrategy === "direct_file" || candidate.downloadStrategy === "archive") &&
          this.expectedLocalPath(candidate) === modelPath
      );
    if (!item) return existsSync(modelPath);

    const existing = this.getDownloadState(item.id);
    if (!existsSync(modelPath) || existing?.status !== "downloaded") return false;
    const validation = this.validateExistingModelArtifact(item, modelPath, existing);
    if (!validation.valid) {
      this.persistDownload({
        modelId: item.id,
        status: "error",
        progressBytes: 0,
        totalBytes: item.sizeBytes,
        localPath: modelPath,
        error: validation.error,
        favorite: Boolean(existing.favorite)
      });
      this.clearActiveModel(item);
      return false;
    }
    if (validation.verification && validation.verification !== existing.verification) {
      this.persistDownload({ ...existing, verification: validation.verification });
    }
    return true;
  }

  private async withModelMutation<T>(modelPath: string, signal: AbortSignal | undefined, operation: () => T | Promise<T>): Promise<T> {
    const finishMutation = await this.beginModelMutation?.(modelPath, signal);
    try {
      if (signal?.aborted) throw abortError();
      return await operation();
    } finally {
      finishMutation?.();
    }
  }

  private async downloadDirectFile(item: ModelCatalogItem, signal: AbortSignal): Promise<void> {
    if (!item.downloadUrl || !item.filename) return;

    const targetPath = join(this.paths.modelDir, item.filename);
    const partPath = `${targetPath}.part`;
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(partPath)) rmSync(partPath, { force: true });

    this.persistAndEmit({
      modelId: item.id,
      status: "downloading",
      progressBytes: 0,
      totalBytes: item.sizeBytes,
      localPath: targetPath,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    });

    try {
      const { progressBytes, totalBytes, sha256 } = await this.downloadToFile(item, partPath, targetPath, signal);

      if (signal.aborted) throw abortError();
      verifyModelSha256(item, sha256);
      await this.withModelMutation(targetPath, signal, () => {
        renameSync(partPath, targetPath);
      });
      this.persistAndEmit({
        modelId: item.id,
        status: "downloaded",
        progressBytes,
        totalBytes,
        localPath: targetPath,
        downloadedAt: new Date().toISOString(),
        verification: modelFileVerification(targetPath, sha256),
        favorite: Boolean(this.getDownloadState(item.id)?.favorite)
      });
    } catch (error) {
      if (existsSync(partPath)) rmSync(partPath, { force: true });
      if (signal.aborted) {
        this.persistAndEmit(this.cancelledDownloadState(item, item.sizeBytes));
      } else {
        this.persistAndEmit({
          modelId: item.id,
          status: "error",
          progressBytes: this.getDownloadState(item.id)?.progressBytes ?? 0,
          totalBytes: item.sizeBytes,
          localPath: targetPath,
          error: message(error),
          favorite: Boolean(this.getDownloadState(item.id)?.favorite)
        });
      }
    }
  }

  private async downloadArchive(item: ModelCatalogItem, signal: AbortSignal): Promise<void> {
    if (!item.downloadUrl || !item.filename || !item.extractDir || !item.sizeBytes || !item.sha256) return;

    const modelRoot = this.paths.modelDir;
    const targetPath = join(modelRoot, item.extractDir);
    const archivePath = join(modelRoot, `${item.filename}.part`);
    const stagingDir = join(modelRoot, `${item.extractDir}.staging-${process.pid}-${Date.now()}`);
    const extractRoot = join(stagingDir, "extract");
    const stagedModelPath = join(extractRoot, item.extractDir);
    const maxExtractedBytes = item.sizeBytes * maxArchiveExpansionRatio;
    let backupDir: string | undefined;
    let promotedFinal = false;
    mkdirSync(modelRoot, { recursive: true });
    rmSync(archivePath, { force: true });
    rmSync(stagingDir, { recursive: true, force: true });

    this.persistAndEmit({
      modelId: item.id,
      status: "downloading",
      progressBytes: 0,
      totalBytes: item.sizeBytes,
      localPath: targetPath,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    });

    try {
      const { progressBytes, sha256 } = await this.downloadToFile(item, archivePath, targetPath, signal);
      if (signal.aborted) throw abortError();
      verifyModelSha256(item, sha256);
      const extractedBytes = await inspectTarArchive(archivePath, "bz2", maxExtractedBytes, signal);
      ensureAvailableDiskSpace(modelRoot, extractedBytes);
      if (signal.aborted) throw abortError();
      mkdirSync(extractRoot, { recursive: true });
      await extractTarBz2(archivePath, extractRoot, signal);
      if (signal.aborted) throw abortError();
      if (!existsSync(stagedModelPath)) {
        throw new Error(`Archive did not extract expected model directory: ${item.extractDir}`);
      }
      validateSherpaModelDirectory(stagedModelPath);
      const receipt: ModelArchiveReceipt = {
        modelId: item.id,
        archiveSha256: item.sha256,
        installedAt: new Date().toISOString(),
        tree: createInstalledTreeReceipt(stagedModelPath, maxExtractedBytes)
      };
      writeFileSync(join(stagedModelPath, modelReceiptName), JSON.stringify(receipt, null, 2), { mode: 0o600 });
      await this.withModelMutation(targetPath, signal, () => {
        backupDir = replaceModelDirectory(stagedModelPath, targetPath);
        promotedFinal = true;
        const promoted = this.validateExistingModelArtifact(item, targetPath, {
          modelId: item.id,
          status: "downloaded",
          progressBytes,
          totalBytes: item.sizeBytes,
          localPath: targetPath,
          downloadedAt: receipt.installedAt,
          favorite: false
        });
        if (!promoted.valid) throw new Error(promoted.error);
        if (backupDir) rmSync(backupDir, { recursive: true, force: true });
        backupDir = undefined;
      });
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });

      this.persistAndEmit({
        modelId: item.id,
        status: "downloaded",
        progressBytes,
        totalBytes: item.sizeBytes,
        localPath: targetPath,
        downloadedAt: new Date().toISOString(),
        favorite: Boolean(this.getDownloadState(item.id)?.favorite)
      });
    } catch (error) {
      if (backupDir) restoreModelBackup(targetPath, backupDir);
      else if (promotedFinal) rmSync(targetPath, { recursive: true, force: true });
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });
      if (signal.aborted) {
        this.persistAndEmit(this.cancelledDownloadState(item, item.sizeBytes));
      } else {
        this.persistAndEmit({
          modelId: item.id,
          status: "error",
          progressBytes: this.getDownloadState(item.id)?.progressBytes ?? 0,
          totalBytes: item.sizeBytes,
          localPath: targetPath,
          error: message(error),
          favorite: Boolean(this.getDownloadState(item.id)?.favorite)
        });
      }
    }
  }

  private async downloadToFile(
    item: ModelCatalogItem,
    partPath: string,
    targetPath: string,
    signal: AbortSignal
  ): Promise<DownloadToFileResult> {
    if (!item.downloadUrl || !item.sizeBytes) throw new Error(`Model ${item.id} is missing pinned download metadata.`);

    return withDownloadDeadline(signal, this.downloadTotalTimeoutMs, async (deadlineSignal) => {
      const response = await fetchWithTimeout(item.downloadUrl!, {}, this.downloadHeaderTimeoutMs, deadlineSignal);
      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
      }
      const result = await downloadResponseToFile({
        response,
        filePath: partPath,
        expectedBytes: item.sizeBytes!,
        idleTimeoutMs: this.downloadBodyTimeoutMs,
        signal: deadlineSignal,
        onProgress: (progressBytes) => {
          this.maybePersistAndEmitProgress({
            modelId: item.id,
            status: "downloading",
            progressBytes,
            totalBytes: item.sizeBytes,
            localPath: targetPath,
            favorite: Boolean(this.getDownloadState(item.id)?.favorite)
          });
        }
      });
      return { progressBytes: result.bytes, totalBytes: item.sizeBytes!, sha256: result.sha256 };
    });
  }

  private async pullOllamaModel(item: ModelCatalogItem, signal: AbortSignal): Promise<void> {
    const model = item.ollamaModel;
    if (!model) return;

    this.persistAndEmit({
      modelId: item.id,
      status: "downloading",
      progressBytes: 0,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    });

    try {
      const tagsReachable = await this.fetchOllamaTags(signal);
      if (!tagsReachable) throw new Error(ollamaNotRunning);

      const response = await fetchWithTimeout(
        `${ollamaBaseUrl}/api/pull`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, stream: true })
        },
        this.downloadHeaderTimeoutMs,
        signal
      );
      if (!response.ok) throw new Error(`Ollama pull failed with HTTP ${response.status}: ${await response.text()}`);
      if (!response.body) throw new Error("Ollama pull response did not include a stream.");

      await this.readOllamaPullStream(response, item, signal);
      const downloaded = await this.isOllamaModelDownloaded(model);
      if (!downloaded) {
        throw new Error(`Ollama pull finished, but ${model} was not listed by /api/tags.`);
      }
      this.persistAndEmit({
        modelId: item.id,
        status: "downloaded",
        progressBytes: this.getDownloadState(item.id)?.progressBytes ?? 0,
        totalBytes: this.getDownloadState(item.id)?.totalBytes,
        downloadedAt: new Date().toISOString(),
        favorite: Boolean(this.getDownloadState(item.id)?.favorite)
      });
    } catch (error) {
      if (signal.aborted) {
        this.persistAndEmit(this.cancelledDownloadState(item));
        return;
      }
      const errorMessage = message(error).includes("fetch failed") ? ollamaNotRunning : message(error);
      this.persistAndEmit({
        modelId: item.id,
        status: "error",
        progressBytes: this.getDownloadState(item.id)?.progressBytes ?? 0,
        totalBytes: this.getDownloadState(item.id)?.totalBytes,
        error: errorMessage,
        favorite: Boolean(this.getDownloadState(item.id)?.favorite)
      });
    }
  }

  private async readOllamaPullStream(response: Response, item: ModelCatalogItem, signal: AbortSignal): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await readStreamChunk(reader, this.downloadBodyTimeoutMs, signal);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as { status?: string; completed?: number; total?: number; error?: string };
        if (event.error) throw new Error(event.error);
        this.maybePersistAndEmitProgress({
          modelId: item.id,
          status: event.status === "success" ? "downloaded" : "downloading",
          progressBytes: event.completed ?? this.getDownloadState(item.id)?.progressBytes ?? 0,
          totalBytes: event.total ?? this.getDownloadState(item.id)?.totalBytes,
          favorite: Boolean(this.getDownloadState(item.id)?.favorite)
        });
      }
    }
  }

  private cleanupPartialModelInstalls(): void {
    mkdirSync(this.paths.modelDir, { recursive: true });
    for (const entry of readdirSync(this.paths.modelDir, { withFileTypes: true })) {
      const path = join(this.paths.modelDir, entry.name);
      if ((entry.isFile() && entry.name.endsWith(".part")) || (entry.isDirectory() && entry.name.includes(".staging-"))) {
        rmSync(path, { recursive: entry.isDirectory(), force: true });
      }
    }
    for (const item of modelCatalog.filter((candidate) => candidate.downloadStrategy === "archive" && candidate.extractDir)) {
      const finalDir = join(this.paths.modelDir, item.extractDir!);
      const backupPrefix = `${item.extractDir}.previous-`;
      const backups = readdirSync(this.paths.modelDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(backupPrefix))
        .map((entry) => join(this.paths.modelDir, entry.name))
        .sort()
        .reverse();
      if (backups.length === 0) continue;
      const existing = this.getDownloadState(item.id);
      if (existsSync(finalDir) && this.validateExistingModelArtifact(item, finalDir, existing).valid) {
        for (const backup of backups) rmSync(backup, { recursive: true, force: true });
        continue;
      }
      const validBackup = backups.find((backup) => this.validateExistingModelArtifact(item, backup, existing).valid);
      if (!validBackup) continue;
      rmSync(finalDir, { recursive: true, force: true });
      renameSync(validBackup, finalDir);
      for (const backup of backups) {
        if (backup !== validBackup) rmSync(backup, { recursive: true, force: true });
      }
    }
    for (const download of this.storage.getState().modelLibrary.downloads) {
      if (download.status !== "downloading") continue;
      this.persistDownload({
        modelId: download.modelId,
        status: "error",
        progressBytes: 0,
        totalBytes: download.totalBytes,
        localPath: download.localPath,
        error: "A previous model installation was interrupted. Retry the download.",
        favorite: Boolean(download.favorite)
      });
    }
  }

  private clearActiveModel(item: ModelCatalogItem): void {
    if (this.storage.getState().modelLibrary.activeModelIds[item.kind] === item.id) {
      this.storage.setActiveModel(item.kind, undefined);
    }
  }

  private async refreshOllamaDownloadStates(): Promise<void> {
    const tags = await this.fetchOllamaTags();
    if (!tags) return;

    const downloadedModels = new Set(
      tags.models
        ?.flatMap((model) => [model.model, model.name])
        .filter((value): value is string => typeof value === "string") ?? []
    );

    for (const item of modelCatalog.filter((candidate) => candidate.downloadStrategy === "ollama_pull" && candidate.ollamaModel)) {
      const existing = this.getDownloadState(item.id);
      if (modelNameSetHas(downloadedModels, item.ollamaModel!)) {
        this.persistDownload({
          modelId: item.id,
          status: "downloaded",
          progressBytes: existing?.progressBytes ?? 0,
          totalBytes: existing?.totalBytes,
          downloadedAt: existing?.downloadedAt ?? new Date().toISOString(),
          favorite: Boolean(existing?.favorite)
        });
      }
    }
  }

  private refreshCachedModelDownloadStates(): void {
    for (const item of modelCatalog.filter((candidate) => candidate.downloadStrategy === "direct_file" || candidate.downloadStrategy === "archive")) {
      const expectedPath = this.expectedLocalPath(item);
      if (!expectedPath) continue;

      const existing = this.getDownloadState(item.id);
      if (!existsSync(expectedPath)) {
        if (existing?.status === "downloaded") {
          this.persistDownload({
            modelId: item.id,
            status: "not_downloaded",
            progressBytes: 0,
            totalBytes: existing.totalBytes ?? item.sizeBytes,
            favorite: Boolean(existing.favorite)
          });
          this.clearActiveModel(item);
        }
        continue;
      }

      const validation = this.validateExistingModelArtifact(item, expectedPath, existing);
      if (!validation.valid) {
        this.persistDownload({
          modelId: item.id,
          status: "error",
          progressBytes: 0,
          totalBytes: item.sizeBytes,
          localPath: expectedPath,
          error: validation.error,
          favorite: Boolean(existing?.favorite)
        });
        this.clearActiveModel(item);
        continue;
      }

      this.persistDownload({
        modelId: item.id,
        status: "downloaded",
        progressBytes: item.sizeBytes ?? existing?.progressBytes ?? 0,
        totalBytes: item.sizeBytes ?? existing?.totalBytes,
        localPath: expectedPath,
        downloadedAt: existing?.downloadedAt ?? new Date().toISOString(),
        verification: validation.verification,
        favorite: Boolean(existing?.favorite)
      });
    }
  }

  private validateExistingModelArtifact(
    item: ModelCatalogItem,
    expectedPath: string,
    existing: ModelDownloadState | undefined
  ): { valid: true; verification?: ModelDownloadState["verification"] } | { valid: false; error: string } {
    if (item.downloadStrategy === "direct_file" && item.sha256) {
      try {
        const stats = statSync(expectedPath);
        if (!stats.isFile()) return { valid: false, error: `Cached model is not a regular file: ${item.filename ?? item.id}.` };
        if (
          existing?.verification?.sha256 === item.sha256 &&
          existing.verification.sizeBytes === stats.size &&
          existing.verification.mtimeMs === stats.mtimeMs
        ) {
          return { valid: true, verification: existing.verification };
        }
        const actualSha256 = sha256FileSync(expectedPath);
        if (actualSha256 !== item.sha256) {
          return { valid: false, error: `Cached model failed SHA-256 verification for ${item.filename ?? item.id}.` };
        }
        return { valid: true, verification: modelFileVerification(expectedPath, actualSha256) };
      } catch (error) {
        return { valid: false, error: `Cached model could not be verified: ${message(error)}` };
      }
    }

    if (item.downloadStrategy === "archive" && item.sizeBytes && item.sha256) {
      try {
        validateSherpaModelDirectory(expectedPath);
        const maxBytes = item.sizeBytes * maxArchiveExpansionRatio;
        let receipt = readModelArchiveReceipt(expectedPath);
        if (!receipt && existing?.status === "downloaded") {
          receipt = {
            modelId: item.id,
            archiveSha256: item.sha256,
            installedAt: existing.downloadedAt ?? new Date().toISOString(),
            tree: createInstalledTreeReceipt(expectedPath, maxBytes)
          };
          writeFileSync(join(expectedPath, modelReceiptName), JSON.stringify(receipt, null, 2), { mode: 0o600 });
        }
        if (!receipt || receipt.modelId !== item.id || receipt.archiveSha256 !== item.sha256) {
          return { valid: false, error: `Cached model is missing a valid installation receipt for ${item.id}.` };
        }
        const treeProblem = verifyInstalledTreeReceipt(expectedPath, receipt.tree, maxBytes);
        return treeProblem ? { valid: false, error: treeProblem } : { valid: true };
      } catch (error) {
        return { valid: false, error: `Cached model could not be verified: ${message(error)}` };
      }
    }

    return { valid: false, error: `Model ${item.id} is missing integrity metadata.` };
  }

  private async refreshDiscoveredLocalModels(): Promise<void> {
    const state = this.storage.getState();
    const providers = state.llmProviders.filter(isDynamicLlmProvider);
    let catalog = pruneDynamicProviderModels(state.modelLibrary.catalog, providers);

    for (const storedProvider of providers) {
      const provider = this.storage.resolveLlmProviderSecret(storedProvider);
      if (provider.type === "custom_openai_compatible") {
        catalog = mergeManualOpenAiCompatibleModels(
          catalog,
          provider as LlmProviderConfig & { type: "custom_openai_compatible" },
          new Date().toISOString()
        );
        continue;
      }
      if (!isDiscoverableLlmProvider(provider)) continue;

      if (!provider.enabled) {
        catalog = updateDiscoveredProviderAvailability(catalog, provider, false, `${provider.name} is disabled.`);
        continue;
      }

      const result = await this.discoverLlmProviderModels(provider);
      if (result.ok) {
        catalog = mergeDiscoveredProviderModels(catalog, provider, result.models, new Date().toISOString());
      } else {
        catalog = updateDiscoveredProviderAvailability(catalog, provider, false, result.message);
      }
    }

    if (!sameValue(catalog, state.modelLibrary.catalog)) {
      this.storage.setModelLibrary({
        ...this.storage.getState().modelLibrary,
        catalog
      });
    }
  }

  private async discoverLlmProviderModels(
    provider: LlmProviderConfig
  ): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
    if (provider.type === "ollama") return this.discoverOllamaModels(provider);
    return this.discoverLmStudioModels(provider);
  }

  private async discoverOllamaModels(provider: LlmProviderConfig): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
    const baseUrl = provider.baseUrl || ollamaBaseUrl;
    try {
      const response = await fetchWithTimeout(joinUrl(baseUrl, "/api/tags"), {}, 2500);
      if (!response.ok) return { ok: false, message: `${provider.name} responded with HTTP ${response.status}.` };
      return { ok: true, models: modelNamesFromPayload(await response.json()) };
    } catch (error) {
      return { ok: false, message: localProviderUnavailableMessage(provider, baseUrl, error) };
    }
  }

  private async discoverLmStudioModels(
    provider: LlmProviderConfig
  ): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
    const baseUrl = provider.baseUrl || "http://127.0.0.1:1234/v1";
    const headers = llmProviderAuthHeaders(provider);
    const nativeUrl = joinUrl(lmStudioNativeBaseUrl(baseUrl), "/api/v0/models");
    const native = await fetchModelNames(nativeUrl, headers);
    if (native.ok && native.models.length > 0) return { ok: true, models: native.models };
    const nativeError = native.ok ? undefined : native.error;

    const compatibleUrl = joinUrl(baseUrl, "/models");
    const compatible = await fetchModelNames(compatibleUrl, headers);
    if (compatible.ok) return { ok: true, models: compatible.models };
    const compatibleError = compatible.ok ? undefined : compatible.error;
    if (native.ok) return { ok: true, models: [] };

    return {
      ok: false,
      message: localProviderUnavailableMessage(provider, baseUrl, compatibleError ?? nativeError)
    };
  }

  private async deleteOllamaModel(model: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${ollamaBaseUrl}/api/delete`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model })
      },
      15000
    );
    if (!response.ok) {
      throw new Error(`Ollama delete failed with HTTP ${response.status}: ${await response.text()}`);
    }
  }

  private async isOllamaModelDownloaded(model: string): Promise<boolean> {
    const tags = await this.fetchOllamaTags();
    if (!tags) return false;
    const names = new Set(tags.models?.flatMap((entry) => [entry.model, entry.name]).filter(Boolean) as string[]);
    return modelNameSetHas(names, model);
  }

  private async fetchOllamaTags(signal?: AbortSignal): Promise<{ models?: Array<{ name?: string; model?: string }> } | null> {
    try {
      const response = await fetchWithTimeout(`${ollamaBaseUrl}/api/tags`, {}, 2500, signal);
      if (!response.ok) return null;
      return (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
    } catch {
      return null;
    }
  }

  private findCatalogItem(modelId: string): ModelCatalogItem | undefined {
    return this.storage.getState().modelLibrary.catalog.find((item) => item.id === modelId);
  }

  private getDownloadState(modelId: string): ModelDownloadState | undefined {
    return this.storage.getState().modelLibrary.downloads.find((download) => download.modelId === modelId);
  }

  private hasUsableActiveModel(kind: ModelKind): boolean {
    const activeModelId = this.storage.getState().modelLibrary.activeModelIds[kind];
    const item = activeModelId ? this.findCatalogItem(activeModelId) : undefined;
    return Boolean(item && item.kind === kind && this.isModelReady(item));
  }

  private enableProviderForActivation(item: ModelCatalogItem): void {
    const state = this.storage.getState();
    if (item.kind === "voice") {
      const providerId = sttProviderId(item);
      const provider = state.transcriptionProviders.find((candidate) => candidate.id === providerId);
      if (!provider || provider.enabled || (item.isCloud && !provider.hasStoredSecret && !provider.apiKey)) return;
      this.storage.setTranscriptionProviders(
        state.transcriptionProviders.map((candidate) =>
          candidate.id === providerId
            ? { ...candidate, enabled: true, apiKeyIntent: candidate.hasSecretRecord ? "keep" : "remove" }
            : candidate
        )
      );
      return;
    }

    const providerId = item.defaultProviderConfig?.providerId ?? item.discovery?.providerId ?? llmProviderId(item);
    const provider = state.llmProviders.find((candidate) => candidate.id === providerId);
    if (!provider || provider.enabled || (item.isCloud && provider.type !== "codex" && !provider.hasStoredSecret && !provider.apiKey)) return;
    this.storage.setLlmProviders(
      state.llmProviders.map((candidate) =>
        candidate.id === providerId
          ? { ...candidate, enabled: true, apiKeyIntent: candidate.hasSecretRecord ? "keep" : "remove" }
          : candidate
      )
    );
  }

  private isModelReady(item: ModelCatalogItem): boolean {
    if (!canActivateModel(item)) return false;
    const state = this.storage.getState();
    if (!isModelProviderUsable(item, { ...state, providerRuntime: this.getProviderRuntime?.() })) return false;
    if (item.discovery && !item.discovery.reachable) return false;
    if (!this.isRequiredRuntimeAvailable(item)) return false;
    if (item.downloadStrategy === "none") return true;
    if (item.downloadStrategy === "direct_file" || item.downloadStrategy === "archive") {
      const expectedPath = this.expectedLocalPath(item);
      return expectedPath ? this.verifyModelPathForUse(expectedPath) : false;
    }
    return this.getDownloadState(item.id)?.status === "downloaded";
  }

  private expectedLocalPath(item: ModelCatalogItem): string | undefined {
    if (item.downloadStrategy === "direct_file" && item.filename) return join(this.paths.modelDir, item.filename);
    if (item.downloadStrategy === "archive" && item.extractDir) return join(this.paths.modelDir, item.extractDir);
    return undefined;
  }

  private isRequiredRuntimeAvailable(item: ModelCatalogItem): boolean {
    const runtimeId = sttRuntimeIdForModel(item);
    return runtimeId
      ? this.runtimeService.getAutomaticAvailability(runtimeId).status === "available"
      : true;
  }

  private persistAndEmit(state: ModelDownloadState): void {
    this.persistDownload(state);
    this.emitProgress(state);
    if (state.status !== "downloading") this.progressSnapshots.delete(state.modelId);
  }

  private maybePersistAndEmitProgress(state: ModelDownloadState): void {
    const previous = this.progressSnapshots.get(state.modelId);
    const now = Date.now();
    const byteDelta = previous ? state.progressBytes - previous.lastProgressBytes : state.progressBytes;
    const timeDelta = previous ? now - previous.lastEmittedAt : Number.POSITIVE_INFINITY;
    const firstPositiveProgress = previous?.lastProgressBytes === 0 && state.progressBytes > 0;
    const reachedEnd = state.totalBytes !== undefined && state.progressBytes >= state.totalBytes;

    if (!previous || firstPositiveProgress || byteDelta >= progressEmitMinBytes || timeDelta >= this.progressEmitIntervalMs || reachedEnd) {
      this.progressSnapshots.set(state.modelId, {
        lastEmittedAt: now,
        lastProgressBytes: state.progressBytes
      });
      this.persistAndEmit(state);
    }
  }

  private persistDownload(state: ModelDownloadState): void {
    this.storage.upsertModelDownload({
      ...state,
      favorite: Boolean(state.favorite)
    });
  }

  private cancelledDownloadState(item: ModelCatalogItem, totalBytes = item.sizeBytes): ModelDownloadState {
    return {
      modelId: item.id,
      status: "not_downloaded",
      progressBytes: 0,
      totalBytes,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    };
  }
}

function sttRuntimeIdForModel(item: ModelCatalogItem): SttRuntimeId | null {
  if (item.kind !== "voice") return null;
  const type = item.defaultProviderConfig?.sttProviderType;
  if (type === "whisper_cpp") return "whisper.cpp";
  if (type === "sherpa_onnx") return "sherpa-onnx";
  return null;
}

function isDiscoverableLlmProvider(provider: LlmProviderConfig): provider is LlmProviderConfig & { type: "ollama" | "lmstudio" } {
  return provider.type === "ollama" || provider.type === "lmstudio";
}

function isDynamicLlmProvider(
  provider: LlmProviderConfig
): provider is LlmProviderConfig & { type: "ollama" | "lmstudio" | "custom_openai_compatible" } {
  return isDiscoverableLlmProvider(provider) || provider.type === "custom_openai_compatible";
}

function mergeDiscoveredProviderModels(
  catalog: ModelCatalogItem[],
  provider: LlmProviderConfig & { type: "ollama" | "lmstudio" },
  models: string[],
  now: string
): ModelCatalogItem[] {
  const uniqueModels = uniqueModelNames(models);
  const discoveredById = new Map(uniqueModels.map((model) => [dynamicModelId(provider, model), discoveredModelItem(provider, model, now)]));
  const seenIds = new Set<string>();
  const merged = catalog.map((item) => {
    if (!isDiscoveredFromProvider(item, provider)) return item;

    const replacement = discoveredById.get(item.id);
    if (replacement) {
      seenIds.add(item.id);
      return replacement;
    }

    return {
      ...item,
      discovery: {
        ...item.discovery!,
        reachable: false,
        message: `${item.name} was not reported by ${provider.name} on the latest refresh.`
      }
    };
  });

  for (const [id, item] of discoveredById) {
    if (!seenIds.has(id) && !merged.some((candidate) => candidate.id === id)) {
      merged.push(item);
    }
  }

  return merged;
}

function mergeManualOpenAiCompatibleModels(
  catalog: ModelCatalogItem[],
  provider: LlmProviderConfig & { type: "custom_openai_compatible" },
  now: string
): ModelCatalogItem[] {
  const uniqueModels = uniqueModelNames(provider.models ?? []);
  const manualById = new Map(uniqueModels.map((model) => [dynamicModelId(provider, model), manualOpenAiCompatibleModelItem(provider, model, now)]));
  const seenIds = new Set<string>();
  const merged = catalog.flatMap((item) => {
    if (!isManualFromProvider(item, provider)) return [item];

    const replacement = manualById.get(item.id);
    if (!replacement) return [];

    seenIds.add(item.id);
    return [replacement];
  });

  for (const [id, item] of manualById) {
    if (!seenIds.has(id) && !merged.some((candidate) => candidate.id === id)) {
      merged.push(item);
    }
  }

  return merged;
}

function pruneDynamicProviderModels(catalog: ModelCatalogItem[], providers: LlmProviderConfig[]): ModelCatalogItem[] {
  const providerModelProviders = new Map(providers.map((provider) => [provider.id, providerModelProvider(provider)]));
  return catalog.filter(
    (item) => !isDynamicProviderModel(item) || providerModelProviders.get(item.discovery!.providerId) === item.provider
  );
}

function updateDiscoveredProviderAvailability(
  catalog: ModelCatalogItem[],
  provider: LlmProviderConfig & { type: "ollama" | "lmstudio" },
  reachable: boolean,
  message: string
): ModelCatalogItem[] {
  return catalog.map((item) => {
    if (!isDiscoveredFromProvider(item, provider)) return item;
    return {
      ...item,
      discovery: {
        ...item.discovery!,
        reachable,
        message
      }
    };
  });
}

function isDynamicProviderModel(item: ModelCatalogItem): boolean {
  return Boolean(item.discovery?.providerId);
}

function isDiscoveredFromProvider(
  item: ModelCatalogItem,
  provider: Pick<LlmProviderConfig, "id" | "type">
): boolean {
  return item.discovery?.providerId === provider.id && item.provider === providerModelProvider(provider) && item.discovery.origin === "discovered";
}

function isManualFromProvider(
  item: ModelCatalogItem,
  provider: Pick<LlmProviderConfig, "id" | "type">
): boolean {
  return item.discovery?.providerId === provider.id && item.provider === providerModelProvider(provider) && item.discovery.origin === "manual";
}

function providerModelProvider(provider: Pick<LlmProviderConfig, "type">): ModelCatalogItem["provider"] {
  if (provider.type === "custom_openai_compatible") return "openai_compatible";
  if (provider.type === "ollama" || provider.type === "lmstudio") return provider.type;
  return "openai_compatible";
}

function discoveredModelItem(
  provider: LlmProviderConfig & { type: "ollama" | "lmstudio" },
  model: string,
  now: string
): ModelCatalogItem {
  return {
    id: dynamicModelId(provider, model),
    name: model,
    kind: "language",
    provider: provider.type,
    description: `${provider.name} local language model discovered from the running provider.`,
    isCloud: false,
    isOffline: true,
    downloadStrategy: "none",
    discovery: {
      origin: "discovered",
      providerId: provider.id,
      lastSeenAt: now,
      reachable: true,
      message: `Available from ${provider.name}.`
    },
    defaultProviderConfig: {
      providerId: provider.id,
      llmProviderType: provider.type,
      baseUrl: provider.baseUrl,
      model
    }
  };
}

function manualOpenAiCompatibleModelItem(
  provider: LlmProviderConfig & { type: "custom_openai_compatible" },
  model: string,
  now: string
): ModelCatalogItem {
  const reachable = isLlmProviderUsable(provider);
  return {
    id: dynamicModelId(provider, model),
    name: model,
    kind: "language",
    provider: "openai_compatible",
    description: `${provider.name} OpenAI-compatible language model.`,
    isCloud: provider.isCloud,
    isOffline: !provider.isCloud,
    downloadStrategy: "none",
    discovery: {
      origin: "manual",
      providerId: provider.id,
      lastSeenAt: now,
      reachable,
      message: reachable ? `Configured on ${provider.name}.` : `${provider.name} is disabled or missing required connection settings.`
    },
    defaultProviderConfig: {
      providerId: provider.id,
      llmProviderType: "custom_openai_compatible",
      baseUrl: provider.baseUrl,
      model
    }
  };
}

function dynamicModelId(provider: Pick<LlmProviderConfig, "id">, model: string): string {
  return `${provider.id}:${model}`;
}

async function fetchModelNames(
  url: string,
  headers: HeadersInit = {}
): Promise<{ ok: true; models: string[] } | { ok: false; error: unknown }> {
  try {
    const response = await fetchWithTimeout(url, { headers }, 2500);
    if (!response.ok) return { ok: false, error: new Error(`HTTP ${response.status}`) };
    return { ok: true, models: modelNamesFromPayload(await response.json()) };
  } catch (error) {
    return { ok: false, error };
  }
}

function modelNamesFromPayload(payload: unknown): string[] {
  const candidates = modelListCandidates(payload);
  return uniqueModelNames(candidates.map(modelNameFromEntry).filter((value): value is string => Boolean(value)));
}

function modelListCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { data?: unknown; models?: unknown };
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  return [];
}

function modelNameFromEntry(entry: unknown): string | undefined {
  if (typeof entry === "string") return nonEmpty(entry);
  if (!entry || typeof entry !== "object") return undefined;

  const record = entry as { id?: unknown; model?: unknown; name?: unknown; type?: unknown };
  if (typeof record.type === "string" && record.type.length > 0 && record.type !== "llm") return undefined;
  return nonEmpty(record.id) ?? nonEmpty(record.model) ?? nonEmpty(record.name);
}

function uniqueModelNames(models: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function lmStudioNativeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/v1\/?$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  }
}

function localProviderUnavailableMessage(provider: Pick<LlmProviderConfig, "name">, baseUrl: string, error: unknown): string {
  const errorText = message(error);
  if (!errorText || errorText.includes("fetch failed") || errorText.includes("aborted")) {
    return `${provider.name} is not reachable at ${baseUrl}.`;
  }
  return `${provider.name} is not reachable at ${baseUrl}: ${errorText}`;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
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
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error(`Request timed out while waiting for response headers after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function modelNameSetHas(names: Set<string>, model: string): boolean {
  return names.has(model) || Array.from(names).some((name) => name === `${model}:latest` || name.startsWith(`${model}:`));
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

function verifyModelSha256(item: ModelCatalogItem, actualSha256: string): void {
  if (!item.sha256) return;
  if (actualSha256 !== item.sha256) {
    throw new Error(`SHA-256 mismatch for ${item.filename ?? item.id}. Expected ${item.sha256}, got ${actualSha256}.`);
  }
}

function modelFileVerification(path: string, sha256: string): NonNullable<ModelDownloadState["verification"]> {
  const stats = statSync(path);
  return { sizeBytes: stats.size, mtimeMs: stats.mtimeMs, sha256 };
}

function validateSherpaModelDirectory(path: string): void {
  const requiredTokens = join(path, "tokens.txt");
  if (!isRegularFile(requiredTokens)) throw new Error("Archive model is missing a regular tokens.txt file.");
  const ctc = ["model.int8.onnx", "model.onnx"].some((name) => isRegularFile(join(path, name)));
  const transducer = ["encoder", "decoder", "joiner"].every((prefix) =>
    [`${prefix}.int8.onnx`, `${prefix}.onnx`].some((name) => isRegularFile(join(path, name)))
  );
  if (!ctc && !transducer) throw new Error("Archive model is missing a supported set of regular ONNX model files.");
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readModelArchiveReceipt(root: string): ModelArchiveReceipt | null {
  try {
    const value = JSON.parse(readFileSync(join(root, modelReceiptName), "utf8")) as Partial<ModelArchiveReceipt>;
    if (!value.modelId || !value.archiveSha256 || !value.installedAt || !value.tree?.files || !value.tree.symlinks) return null;
    return value as ModelArchiveReceipt;
  } catch {
    return null;
  }
}

function replaceModelDirectory(sourceDir: string, targetDir: string): string | undefined {
  const backupDir = `${targetDir}.previous-${process.pid}-${Date.now()}`;
  const hadTarget = existsSync(targetDir);
  if (hadTarget) renameSync(targetDir, backupDir);
  try {
    renameSync(sourceDir, targetDir);
    return hadTarget ? backupDir : undefined;
  } catch (error) {
    rmSync(targetDir, { recursive: true, force: true });
    if (hadTarget && existsSync(backupDir)) renameSync(backupDir, targetDir);
    throw error;
  }
}

function restoreModelBackup(targetDir: string, backupDir: string): void {
  rmSync(targetDir, { recursive: true, force: true });
  if (existsSync(backupDir)) renameSync(backupDir, targetDir);
}

function sha256FileSync(path: string): string {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

function extractTarBz2(archivePath: string, targetDir: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xjf", archivePath, "-C", targetDir], { stdio: ["ignore", "ignore", "pipe"] });
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
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`tar extraction failed with exit code ${code}: ${stderr.trim()}`));
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
