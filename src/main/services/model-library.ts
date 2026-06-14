import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { canActivateModel } from "../../shared/model-activation";
import { modelCatalog } from "../../shared/model-catalog";
import type { ModelCatalogItem, ModelDownloadState, ModelKind, ModelLibrarySnapshot } from "../../shared/types";
import { StorageService } from "./storage";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const ollamaNotRunning = "Ollama is not running at http://127.0.0.1:11434.";

type ProgressEmitter = (state: ModelDownloadState) => void;

export class ModelLibraryService {
  private activeDownloads = new Set<string>();

  constructor(
    private userDataPath: string,
    private storage: StorageService,
    private emitProgress: ProgressEmitter
  ) {}

  async getLibrary(): Promise<ModelLibrarySnapshot> {
    await this.refreshOllamaDownloadStates();
    return this.snapshot();
  }

  async downloadModel(modelId: string): Promise<ModelLibrarySnapshot> {
    const item = this.findCatalogItem(modelId);
    if (!item || item.downloadStrategy === "none") return this.snapshot();
    if (this.activeDownloads.has(modelId)) return this.snapshot();

    this.activeDownloads.add(modelId);
    try {
      if (item.downloadStrategy === "direct_file") {
        await this.downloadDirectFile(item);
      } else if (item.downloadStrategy === "archive") {
        await this.downloadArchive(item);
      } else {
        await this.pullOllamaModel(item);
      }
    } finally {
      this.activeDownloads.delete(modelId);
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
    if ((item?.downloadStrategy === "direct_file" || item?.downloadStrategy === "archive") && existing?.localPath && existsSync(existing.localPath)) {
      rmSync(existing.localPath, { recursive: item.downloadStrategy === "archive", force: true });
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

  private async downloadDirectFile(item: ModelCatalogItem): Promise<void> {
    if (!item.downloadUrl || !item.filename) return;

    const targetPath = join(this.userDataPath, "models", "stt", item.filename);
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
      const response = await fetchWithTimeout(item.downloadUrl, {}, 15000);
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

  private async downloadArchive(item: ModelCatalogItem): Promise<void> {
    if (!item.downloadUrl || !item.filename || !item.extractDir) return;

    const modelRoot = join(this.userDataPath, "models", "stt");
    const targetPath = join(modelRoot, item.extractDir);
    const archivePath = join(modelRoot, item.filename);
    const partPath = `${archivePath}.part`;
    mkdirSync(modelRoot, { recursive: true });
    if (existsSync(partPath)) rmSync(partPath, { force: true });
    if (existsSync(archivePath)) rmSync(archivePath, { force: true });

    this.persistAndEmit({
      modelId: item.id,
      status: "downloading",
      progressBytes: 0,
      totalBytes: item.sizeBytes,
      localPath: targetPath,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    });

    try {
      const progressBytes = await this.downloadToFile(item, partPath, targetPath);
      renameSync(partPath, archivePath);
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      await extractTarBz2(archivePath, modelRoot);
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

  private async downloadToFile(item: ModelCatalogItem, partPath: string, targetPath: string): Promise<number> {
    if (!item.downloadUrl) return 0;

    const response = await fetchWithTimeout(item.downloadUrl, {}, 15000);
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

  private async pullOllamaModel(item: ModelCatalogItem): Promise<void> {
    const model = item.ollamaModel;
    if (!model) return;

    this.persistAndEmit({
      modelId: item.id,
      status: "downloading",
      progressBytes: 0,
      favorite: Boolean(this.getDownloadState(item.id)?.favorite)
    });

    try {
      const tagsReachable = await this.fetchOllamaTags();
      if (!tagsReachable) throw new Error(ollamaNotRunning);

      const response = await fetchWithTimeout(
        `${ollamaBaseUrl}/api/pull`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, stream: true })
        },
        15000
      );
      if (!response.ok) throw new Error(`Ollama pull failed with HTTP ${response.status}: ${await response.text()}`);
      if (!response.body) throw new Error("Ollama pull response did not include a stream.");

      await this.readOllamaPullStream(response, item);
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

  private async readOllamaPullStream(response: Response, item: ModelCatalogItem): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
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

  private async fetchOllamaTags(): Promise<{ models?: Array<{ name?: string; model?: string }> } | null> {
    try {
      const response = await fetchWithTimeout(`${ollamaBaseUrl}/api/tags`, {}, 2500);
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
    if (item.downloadStrategy === "none") return true;
    return this.getDownloadState(item.id)?.status === "downloaded";
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
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
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

function extractTarBz2(archivePath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xjf", archivePath, "-C", targetDir], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar extraction failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
