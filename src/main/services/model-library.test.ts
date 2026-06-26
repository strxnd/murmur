import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modelCatalog } from "../../shared/model-catalog";
import { buildProviderSetupDraft } from "../../shared/model-provider-setup";
import type { SttRuntimeAvailability, SttRuntimeId } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
import { ModelLibraryService } from "./model-library";
import { StorageService } from "./storage";
import type { SttRuntimeService } from "./stt-runtime";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("ModelLibraryService", () => {
  it("does not activate a downloaded voice model when its runtime is missing", async () => {
    const { service, storage, paths } = setup("missing");
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    storage.upsertModelDownload(downloaded("whisper-tiny-en", paths));

    const snapshot = await service.activateModel("whisper-tiny-en");

    expect(snapshot.activeModelIds.voice).toBeUndefined();
  });

  it("activates a downloaded voice model when its runtime is available", async () => {
    const { service, storage, paths } = setup("available");
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    storage.upsertModelDownload(downloaded("whisper-tiny-en", paths));

    const snapshot = await service.activateModel("whisper-tiny-en");

    expect(snapshot.activeModelIds.voice).toBe("whisper-tiny-en");
  });

  it("does not activate an API voice model without credentials", async () => {
    const { service } = setup("available");

    const snapshot = await service.activateModel("openai-gpt-4o-transcribe");

    expect(snapshot.activeModelIds.voice).toBeUndefined();
  });

  it("activates an API voice model when cloud credentials are usable", async () => {
    const { service, storage } = setup("available");
    setSttApiKey(storage, "sk-test");

    const snapshot = await service.activateModel("openai-gpt-4o-transcribe");

    expect(snapshot.activeModelIds.voice).toBe("openai-gpt-4o-transcribe");
  });

  it("does not activate an API language model without credentials", async () => {
    const { service } = setup("available");

    const snapshot = await service.activateModel("openai-gpt-5-5");

    expect(snapshot.activeModelIds.language).toBeUndefined();
  });

  it("activates an API language model when cloud credentials are usable", async () => {
    const { service, storage } = setup("available");
    setLlmApiKey(storage, "sk-test");

    const snapshot = await service.activateModel("openai-gpt-5-5");

    expect(snapshot.activeModelIds.language).toBe("openai-gpt-5-5");
  });

  it("activates an API model after model-led provider setup state is saved", async () => {
    const { service, storage } = setup("available");
    const item = modelCatalog.find((candidate) => candidate.id === "openai-gpt-5-5");
    if (!item) throw new Error("Missing openai-gpt-5-5 catalog item.");

    const draft = buildProviderSetupDraft({
      item,
      apiKey: "sk-test",
      transcriptionProviders: storage.getState().transcriptionProviders,
      llmProviders: storage.getState().llmProviders
    });
    if (!draft) throw new Error("Expected provider setup draft.");
    storage.setTranscriptionProviders(draft.transcriptionProviders);
    storage.setLlmProviders(draft.llmProviders);

    const snapshot = await service.activateModel(item.id);

    expect(snapshot.activeModelIds.language).toBe(item.id);
    expect(storage.getState().transcriptionProviders.find((provider) => provider.id === "openai-stt")?.apiKey).toBe("sk-test");
    expect(storage.getState().llmProviders.find((provider) => provider.id === "openai-llm")?.apiKey).toBe("sk-test");
  });

  it("delete clears the active model", async () => {
    const { service, storage, paths } = setup("available");
    const modelPath = join(paths.modelDir, "ggml-tiny.en.bin");
    touch(modelPath);
    storage.upsertModelDownload(downloaded("whisper-tiny-en", paths));
    await service.activateModel("whisper-tiny-en");

    const snapshot = await service.deleteDownloadedModel("whisper-tiny-en");

    expect(snapshot.activeModelIds.voice).toBeUndefined();
    expect(existsSync(modelPath)).toBe(false);
  });

  it("downloads direct files to the cache model dir", async () => {
    const { service, paths } = setup("available");
    const server = await modelServer("model-bytes");
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalUrl = item.downloadUrl;
    item.downloadUrl = server.url;

    try {
      const snapshot = await service.downloadModel("whisper-tiny-en");
      const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");
      const expectedPath = join(paths.modelDir, "ggml-tiny.en.bin");

      expect(download?.status).toBe("downloaded");
      expect(download?.localPath).toBe(expectedPath);
      expect(readFileSync(expectedPath, "utf8")).toBe("model-bytes");
    } finally {
      item.downloadUrl = originalUrl;
      await closeServer(server.server);
    }
  });

  it("cancels direct file downloads and removes partial files", async () => {
    const paths = testPaths();
    const storage = new StorageService(paths);
    const server = await slowModelServer(["partial-", "model-", "bytes"], 250);
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalUrl = item.downloadUrl;
    item.downloadUrl = server.url;
    let progressResolved = false;
    let resolveProgress: () => void = () => undefined;
    const progress = new Promise<void>((resolve) => {
      resolveProgress = resolve;
    });
    const service = new ModelLibraryService(
      paths,
      storage,
      (download) => {
        if (!progressResolved && download.modelId === "whisper-tiny-en" && download.status === "downloading" && download.progressBytes > 0) {
          progressResolved = true;
          resolveProgress();
        }
      },
      fakeRuntimeService("available")
    );

    try {
      const downloadPromise = service.downloadModel("whisper-tiny-en");
      await progress;
      const cancelSnapshot = await service.cancelModelDownload("whisper-tiny-en");
      const finalSnapshot = await downloadPromise;
      const download = finalSnapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");
      const cancelledDownload = cancelSnapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");
      const expectedPath = join(paths.modelDir, "ggml-tiny.en.bin");

      expect(cancelledDownload?.status).toBe("not_downloaded");
      expect(download?.status).toBe("not_downloaded");
      expect(download?.progressBytes).toBe(0);
      expect(download?.error).toBeUndefined();
      expect(existsSync(expectedPath)).toBe(false);
      expect(existsSync(`${expectedPath}.part`)).toBe(false);
    } finally {
      item.downloadUrl = originalUrl;
      await closeServer(server.server);
    }
  });

  it("marks existing cached files as downloaded", async () => {
    const paths = testPaths();
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    const storage = new StorageService(paths);
    const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService("available"));

    const snapshot = service.snapshot();
    const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");

    expect(download?.status).toBe("downloaded");
    expect(download?.localPath).toBe(join(paths.modelDir, "ggml-tiny.en.bin"));
  });

  it("clears invalid downloaded state when cached files are missing", () => {
    const paths = testPaths();
    const storage = new StorageService(paths);
    storage.upsertModelDownload(downloaded("whisper-tiny-en", paths));
    storage.setActiveModel("voice", "whisper-tiny-en");

    const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService("available"));
    const snapshot = service.snapshot();
    const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");

    expect(download?.status).toBe("not_downloaded");
    expect(download?.localPath).toBeUndefined();
    expect(snapshot.activeModelIds.voice).toBeUndefined();
  });
});

function setup(status: SttRuntimeAvailability["status"]) {
  const paths = testPaths();
  const storage = new StorageService(paths);
  const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService(status));
  return { service, storage, paths };
}

function downloaded(modelId: string, paths: AppPaths) {
  return {
    modelId,
    status: "downloaded" as const,
    progressBytes: 1,
    localPath: join(paths.modelDir, "ggml-tiny.en.bin"),
    downloadedAt: new Date().toISOString(),
    favorite: false
  };
}

function setSttApiKey(storage: StorageService, apiKey: string): void {
  storage.setTranscriptionProviders(
    storage.getState().transcriptionProviders.map((provider) =>
      provider.id === "openai-stt" ? { ...provider, apiKey } : provider
    )
  );
}

function setLlmApiKey(storage: StorageService, apiKey: string): void {
  storage.setLlmProviders(
    storage.getState().llmProviders.map((provider) => (provider.id === "openai-llm" ? { ...provider, apiKey } : provider))
  );
}

function fakeRuntimeService(status: SttRuntimeAvailability["status"]): SttRuntimeService {
  return {
    getAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return {
        id,
        label: id,
        status,
        platformKey: "linux-x64",
        message: `${id} ${status}`
      };
    }
  } as unknown as SttRuntimeService;
}

function testPaths(): AppPaths {
  const root = tempRoot();
  return resolveAppPaths(fakeApp(root), {
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache")
  });
}

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

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
}

function modelServer(body: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": Buffer.byteLength(body)
      });
      response.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start test server.");
      resolve({ server, url: `http://127.0.0.1:${address.port}/model.bin` });
    });
  });
}

function slowModelServer(chunks: string[], delayMs: number): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      let timer: NodeJS.Timeout | null = null;
      let index = 0;
      const body = chunks.join("");
      const writeNext = (): void => {
        if (index >= chunks.length) {
          response.end();
          return;
        }
        response.write(chunks[index]);
        index += 1;
        timer = setTimeout(writeNext, delayMs);
      };
      request.on("close", () => {
        if (timer) clearTimeout(timer);
      });
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": Buffer.byteLength(body)
      });
      writeNext();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start test server.");
      resolve({ server, url: `http://127.0.0.1:${address.port}/model.bin` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
