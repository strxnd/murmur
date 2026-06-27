import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { canActivateModel, isModelProviderUsable } from "../../shared/model-activation";
import { modelCatalog } from "../../shared/model-catalog";
import type {
  LlmProviderConfig,
  ModelCatalogItem,
  ModelDownloadState,
  ModelKind,
  ModelLibrarySnapshot,
  SttRuntimeId
} from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { joinUrl } from "./http";
import { llmProviderAuthHeaders } from "./provider-auth";
import { StorageService } from "./storage";
import { SttRuntimeService } from "./stt-runtime";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const ollamaNotRunning = "Ollama is not running at http://127.0.0.1:11434.";
const defaultDownloadHeaderTimeoutMs = 15000;
const defaultDownloadBodyTimeoutMs = 30000;
const defaultProgressEmitIntervalMs = 500;
const progressEmitMinBytes = 1024 * 1024;

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
  totalBytes?: number;
  sha256: string;
}

export interface ModelLibraryServiceOptions {
  downloadHeaderTimeoutMs?: number;
  downloadBodyTimeoutMs?: number;
  progressEmitIntervalMs?: number;
}

export class ModelLibraryService {
  private activeDownloads = new Map<string, ModelDownloadOperation>();
  private progressSnapshots = new Map<string, DownloadProgressSnapshot>();
  private downloadHeaderTimeoutMs: number;
  private downloadBodyTimeoutMs: number;
  private progressEmitIntervalMs: number;

  constructor(
    private paths: AppPaths,
    private storage: StorageService,
    private emitProgress: ProgressEmitter,
    private runtimeService = new SttRuntimeService(),
    options: ModelLibraryServiceOptions = {}
  ) {
    this.downloadHeaderTimeoutMs = options.downloadHeaderTimeoutMs ?? defaultDownloadHeaderTimeoutMs;
    this.downloadBodyTimeoutMs = options.downloadBodyTimeoutMs ?? defaultDownloadBodyTimeoutMs;
    this.progressEmitIntervalMs = options.progressEmitIntervalMs ?? defaultProgressEmitIntervalMs;
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

  private async performModelDownload(item: ModelCatalogItem, signal: AbortSignal): Promise<ModelLibrarySnapshot> {
    if (item.downloadStrategy === "direct_file") {
      await this.downloadDirectFile(item, signal);
    } else if (item.downloadStrategy === "archive") {
      await this.downloadArchive(item, signal);
    } else {
      await this.pullOllamaModel(item, signal);
    }

    if (this.isModelReady(item) && !this.hasUsableActiveModel(item.kind)) {
      this.storage.setActiveModel(item.kind, item.id);
    }

    return this.snapshot();
  }

  async activateModel(modelId: string): Promise<ModelLibrarySnapshot> {
    const item = this.findCatalogItem(modelId);
    if (!item || !this.isModelReady(item)) return this.snapshot();

    this.storage.setActiveModel(item.kind, item.id);
    return this.snapshot();
  }

  async deleteDownloadedModel(modelId: string): Promise<ModelLibrarySnapshot> {
    const item = this.findCatalogItem(modelId);
    const existing = this.getDownloadState(modelId);
    const expectedPath = item ? this.expectedLocalPath(item) : undefined;
    if ((item?.downloadStrategy === "direct_file" || item?.downloadStrategy === "archive") && expectedPath && existsSync(expectedPath)) {
      rmSync(expectedPath, { recursive: item.downloadStrategy === "archive", force: true });
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
      renameSync(partPath, targetPath);
      this.persistAndEmit({
        modelId: item.id,
        status: "downloaded",
        progressBytes,
        totalBytes,
        localPath: targetPath,
        downloadedAt: new Date().toISOString(),
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
    if (!item.downloadUrl || !item.filename || !item.extractDir) return;

    const modelRoot = this.paths.modelDir;
    const targetPath = join(modelRoot, item.extractDir);
    const archivePath = join(modelRoot, item.filename);
    const partPath = `${archivePath}.part`;
    mkdirSync(modelRoot, { recursive: true });
    if (existsSync(partPath)) rmSync(partPath, { force: true });
    if (existsSync(archivePath)) rmSync(archivePath, { force: true });
    let extractionStarted = false;

    this.persistAndEmit({
      modelId: item.id,
      status: "downloading",
      progressBytes: 0,
      totalBytes: item.sizeBytes,
      localPath: targetPath,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    });

    try {
      const { progressBytes, sha256 } = await this.downloadToFile(item, partPath, targetPath, signal);
      if (signal.aborted) throw abortError();
      verifyModelSha256(item, sha256);
      renameSync(partPath, archivePath);
      await assertSafeTarBz2Archive(archivePath, signal);
      if (signal.aborted) throw abortError();
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      extractionStarted = true;
      await extractTarBz2(archivePath, modelRoot, signal);
      if (signal.aborted) throw abortError();
      rmSync(archivePath, { force: true });

      if (!existsSync(targetPath)) {
        throw new Error(`Archive did not extract expected model directory: ${targetPath}`);
      }

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
      if (existsSync(partPath)) rmSync(partPath, { force: true });
      if (existsSync(archivePath)) rmSync(archivePath, { force: true });
      if (extractionStarted && existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
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
    if (!item.downloadUrl) return { progressBytes: 0, sha256: createHash("sha256").digest("hex") };

    const response = await fetchWithTimeout(item.downloadUrl, {}, this.downloadHeaderTimeoutMs, signal);
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const totalBytes = Number(response.headers.get("content-length")) || item.sizeBytes;
    const writer = createWriteStream(partPath);
    const hash = createHash("sha256");
    let progressBytes = 0;
    let streamDone = false;

    if (!response.body) throw new Error("Download response did not include a stream.");
    const reader = response.body.getReader();
    try {
      while (true) {
        if (signal.aborted) throw abortError();
        const { done, value } = await readStreamChunk(reader, this.downloadBodyTimeoutMs, signal);
        if (done) {
          streamDone = true;
          break;
        }
        if (!value) continue;
        progressBytes += value.byteLength;
        hash.update(value);
        await writeChunk(writer, value);
        this.maybePersistAndEmitProgress({
          modelId: item.id,
          status: "downloading",
          progressBytes,
          totalBytes,
          localPath: targetPath,
          favorite: Boolean(this.getDownloadState(item.id)?.favorite)
        });
      }
    } finally {
      if (!streamDone) await reader.cancel().catch(() => undefined);
      await closeWriter(writer);
    }

    return { progressBytes, totalBytes, sha256: hash.digest("hex") };
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
      const exists = existsSync(expectedPath);

      if (exists && existing?.status !== "downloaded") {
        if (!this.isExistingModelArtifactValid(item, expectedPath)) {
          this.persistDownload({
            modelId: item.id,
            status: "error",
            progressBytes: 0,
            totalBytes: item.sizeBytes,
            localPath: expectedPath,
            error: `Cached model failed SHA-256 verification for ${item.filename ?? item.id}.`,
            favorite: Boolean(existing?.favorite)
          });
          if (this.storage.getState().modelLibrary.activeModelIds[item.kind] === item.id) {
            this.storage.setActiveModel(item.kind, undefined);
          }
          continue;
        }
        this.persistDownload({
          modelId: item.id,
          status: "downloaded",
          progressBytes: existing?.progressBytes ?? item.sizeBytes ?? 0,
          totalBytes: existing?.totalBytes ?? item.sizeBytes,
          localPath: expectedPath,
          downloadedAt: existing?.downloadedAt ?? new Date().toISOString(),
          favorite: Boolean(existing?.favorite)
        });
      } else if (!exists && existing?.status === "downloaded") {
        this.persistDownload({
          modelId: item.id,
          status: "not_downloaded",
          progressBytes: 0,
          totalBytes: existing.totalBytes ?? item.sizeBytes,
          favorite: Boolean(existing.favorite)
        });
        if (this.storage.getState().modelLibrary.activeModelIds[item.kind] === item.id) {
          this.storage.setActiveModel(item.kind, undefined);
        }
      } else if (exists && existing && existing.localPath !== expectedPath) {
        this.persistDownload({
          ...existing,
          localPath: expectedPath,
          favorite: Boolean(existing.favorite)
        });
      }
    }
  }

  private isExistingModelArtifactValid(item: ModelCatalogItem, expectedPath: string): boolean {
    if (item.downloadStrategy !== "direct_file" || !item.sha256) return true;
    try {
      return sha256FileSync(expectedPath) === item.sha256;
    } catch {
      return false;
    }
  }

  private async refreshDiscoveredLocalModels(): Promise<void> {
    const state = this.storage.getState();
    const providers = state.llmProviders.filter(isBuiltInDiscoverableLlmProvider);
    let catalog = state.modelLibrary.catalog;

    for (const storedProvider of providers) {
      const provider = this.storage.resolveLlmProviderSecret(storedProvider) as LlmProviderConfig & { type: "ollama" | "lmstudio" };
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

  private isModelReady(item: ModelCatalogItem): boolean {
    if (!canActivateModel(item)) return false;
    const state = this.storage.getState();
    if (!isModelProviderUsable(item, state)) return false;
    if (item.discovery && !item.discovery.reachable) return false;
    if (!this.isRequiredRuntimeAvailable(item)) return false;
    if (item.downloadStrategy === "none") return true;
    if (item.downloadStrategy === "direct_file" || item.downloadStrategy === "archive") {
      const expectedPath = this.expectedLocalPath(item);
      return Boolean(expectedPath && existsSync(expectedPath) && this.getDownloadState(item.id)?.status === "downloaded");
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
    return runtimeId ? this.runtimeService.getAvailability(runtimeId).status === "available" : true;
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

function isBuiltInDiscoverableLlmProvider(provider: LlmProviderConfig): provider is LlmProviderConfig & { type: "ollama" | "lmstudio" } {
  return provider.id === provider.type && isDiscoverableLlmProvider(provider);
}

function mergeDiscoveredProviderModels(
  catalog: ModelCatalogItem[],
  provider: LlmProviderConfig & { type: "ollama" | "lmstudio" },
  models: string[],
  now: string
): ModelCatalogItem[] {
  const uniqueModels = uniqueModelNames(models);
  const discoveredById = new Map(uniqueModels.map((model) => [discoveredModelId(provider.type, model), discoveredModelItem(provider, model, now)]));
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

function updateDiscoveredProviderAvailability(
  catalog: ModelCatalogItem[],
  provider: LlmProviderConfig,
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

function isDiscoveredFromProvider(item: ModelCatalogItem, provider: Pick<LlmProviderConfig, "id" | "type">): boolean {
  return item.discovery?.providerId === provider.id && item.provider === provider.type;
}

function discoveredModelItem(
  provider: LlmProviderConfig & { type: "ollama" | "lmstudio" },
  model: string,
  now: string
): ModelCatalogItem {
  return {
    id: discoveredModelId(provider.type, model),
    name: model,
    kind: "language",
    provider: provider.type,
    description: `${provider.name} local language model discovered from the running provider.`,
    isCloud: false,
    isOffline: true,
    tags: ["llm", "local", provider.type, "discovered"],
    downloadStrategy: "none",
    discovery: {
      providerId: provider.id,
      lastSeenAt: now,
      reachable: true,
      message: `Available from ${provider.name}.`
    },
    defaultProviderConfig: {
      llmProviderType: provider.type,
      model
    }
  };
}

function discoveredModelId(provider: "ollama" | "lmstudio", model: string): string {
  return `${provider}:${model}`;
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

function writeChunk(writer: NodeJS.WritableStream, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.write(Buffer.from(value), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
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

function closeWriter(writer: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function verifyModelSha256(item: ModelCatalogItem, actualSha256: string): void {
  if (!item.sha256) return;
  if (actualSha256 !== item.sha256) {
    throw new Error(`SHA-256 mismatch for ${item.filename ?? item.id}. Expected ${item.sha256}, got ${actualSha256}.`);
  }
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

function assertSafeTarBz2Archive(archivePath: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-tjf", archivePath], { stdio: ["ignore", "pipe", "pipe"] });
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
