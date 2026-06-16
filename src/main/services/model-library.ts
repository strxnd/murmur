import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { canActivateModel } from "../../shared/model-activation";
import { modelCatalog } from "../../shared/model-catalog";
import type { ModelCatalogItem, ModelDownloadState, ModelKind, ModelLibrarySnapshot, SttRuntimeId } from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { StorageService } from "./storage";
import { SttRuntimeService } from "./stt-runtime";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const ollamaNotRunning = "Ollama is not running at http://127.0.0.1:11434.";

type ProgressEmitter = (state: ModelDownloadState) => void;

interface ModelDownloadOperation {
  controller: AbortController;
  promise: Promise<ModelLibrarySnapshot>;
}

export class ModelLibraryService {
  private activeDownloads = new Map<string, ModelDownloadOperation>();

  constructor(
    private paths: AppPaths,
    private storage: StorageService,
    private emitProgress: ProgressEmitter,
    private runtimeService = new SttRuntimeService()
  ) {
    this.refreshCachedModelDownloadStates();
  }

  async getLibrary(): Promise<ModelLibrarySnapshot> {
    this.refreshCachedModelDownloadStates();
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
      catalog: modelCatalog,
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
      const response = await fetchWithTimeout(item.downloadUrl, {}, 15000, signal);
      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
      }

      const totalBytes = Number(response.headers.get("content-length")) || item.sizeBytes;
      const writer = createWriteStream(partPath);
      let progressBytes = 0;

      if (!response.body) throw new Error("Download response did not include a stream.");
      const reader = response.body.getReader();
      try {
        while (true) {
          if (signal.aborted) throw abortError();
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          progressBytes += value.byteLength;
          await writeChunk(writer, value);
          this.persistAndEmit({
            modelId: item.id,
            status: "downloading",
            progressBytes,
            totalBytes,
            localPath: targetPath,
            favorite: Boolean(this.getDownloadState(item.id)?.favorite)
          });
        }
      } finally {
        await closeWriter(writer);
      }

      if (signal.aborted) throw abortError();
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
      const progressBytes = await this.downloadToFile(item, partPath, targetPath, signal);
      if (signal.aborted) throw abortError();
      renameSync(partPath, archivePath);
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

  private async downloadToFile(item: ModelCatalogItem, partPath: string, targetPath: string, signal: AbortSignal): Promise<number> {
    if (!item.downloadUrl) return 0;

    const response = await fetchWithTimeout(item.downloadUrl, {}, 15000, signal);
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const totalBytes = Number(response.headers.get("content-length")) || item.sizeBytes;
    const writer = createWriteStream(partPath);
    let progressBytes = 0;

    if (!response.body) throw new Error("Download response did not include a stream.");
    const reader = response.body.getReader();
    try {
      while (true) {
        if (signal.aborted) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        progressBytes += value.byteLength;
        await writeChunk(writer, value);
        this.persistAndEmit({
          modelId: item.id,
          status: "downloading",
          progressBytes,
          totalBytes,
          localPath: targetPath,
          favorite: Boolean(this.getDownloadState(item.id)?.favorite)
        });
      }
    } finally {
      await closeWriter(writer);
    }

    return progressBytes;
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
        15000,
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
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as { status?: string; completed?: number; total?: number; error?: string };
        if (event.error) throw new Error(event.error);
        this.persistAndEmit({
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
    return modelCatalog.find((item) => item.id === modelId);
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw abortError();
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    // Keep the abort bridge alive after headers so cancelling also aborts response body reads.
    clearTimeout(timeout);
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

function closeWriter(writer: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
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
