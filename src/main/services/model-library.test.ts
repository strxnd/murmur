import { createServer, type IncomingMessage, type Server } from "node:http";
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
    const sttProvider = storage.getState().transcriptionProviders.find((provider) => provider.id === "openai-stt");
    const llmProvider = storage.getState().llmProviders.find((provider) => provider.id === "openai-llm");
    expect(sttProvider?.apiKey).toBeUndefined();
    expect(llmProvider?.apiKey).toBeUndefined();
    expect(sttProvider?.apiKeySecretId).toBeTruthy();
    expect(llmProvider?.apiKeySecretId).toBeTruthy();
    expect(sttProvider ? storage.resolveTranscriptionProviderSecret(sttProvider).apiKey : undefined).toBe("sk-test");
    expect(llmProvider ? storage.resolveLlmProviderSecret(llmProvider).apiKey : undefined).toBe("sk-test");
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

  it("discovers Ollama models and remembers them when the provider is unavailable", async () => {
    const paths = testPaths();
    const storage = new StorageService(paths);
    const server = await jsonRouteServer({
      "/api/tags": { models: [{ model: "llama3.1:8b" }, { name: "mistral:latest" }] }
    });
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "ollama" ? { ...provider, baseUrl: server.url, enabled: true } : provider
      )
    );
    const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService("available"));

    const onlineSnapshot = await service.getLibrary();
    const discovered = onlineSnapshot.catalog.find((item) => item.id === "ollama:llama3.1:8b");

    expect(discovered).toMatchObject({
      kind: "language",
      provider: "ollama",
      discovery: { providerId: "ollama", reachable: true },
      defaultProviderConfig: { llmProviderType: "ollama", model: "llama3.1:8b" }
    });

    await closeServer(server.server);
    const offlineSnapshot = await service.getLibrary();
    const remembered = offlineSnapshot.catalog.find((item) => item.id === "ollama:llama3.1:8b");

    expect(remembered?.discovery?.reachable).toBe(false);
    expect(remembered?.discovery?.message).toContain("Ollama is not reachable");
  });

  it("discovers LM Studio models from the native model API", async () => {
    const { service, storage } = setup("available");
    const server = await jsonRouteServer({
      "/api/v0/models": { data: [{ id: "local/native-model", type: "llm" }, { id: "local/embed", type: "embedding" }] }
    });
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "lmstudio" ? { ...provider, baseUrl: `${server.url}/v1`, enabled: true } : provider
      )
    );

    try {
      const snapshot = await service.getLibrary();

      expect(snapshot.catalog.find((item) => item.id === "lmstudio:local/native-model")).toMatchObject({
        provider: "lmstudio",
        discovery: { providerId: "lmstudio", reachable: true },
        defaultProviderConfig: { llmProviderType: "lmstudio", model: "local/native-model" }
      });
      expect(snapshot.catalog.some((item) => item.id === "lmstudio:local/embed")).toBe(false);
    } finally {
      await closeServer(server.server);
    }
  });

  it("falls back to the LM Studio OpenAI-compatible models endpoint", async () => {
    const { service, storage } = setup("available");
    const server = await jsonRouteServer({
      "/api/v0/models": { status: 404, body: { error: "not found" } },
      "/v1/models": { data: [{ id: "fallback-model" }] }
    });
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "lmstudio" ? { ...provider, baseUrl: `${server.url}/v1`, enabled: true } : provider
      )
    );

    try {
      const snapshot = await service.getLibrary();

      expect(snapshot.catalog.find((item) => item.id === "lmstudio:fallback-model")).toMatchObject({
        provider: "lmstudio",
        discovery: { providerId: "lmstudio", reachable: true }
      });
    } finally {
      await closeServer(server.server);
    }
  });

  it("sends LM Studio provider auth headers while discovering models", async () => {
    const { service, storage } = setup("available");
    let nativeAuth: string | undefined;
    let compatibleAuth: string | undefined;
    const server = await jsonRouteServer({
      "/api/v0/models": (request) => {
        nativeAuth = request.headers.authorization;
        return request.headers.authorization === "Bearer lmstudio-secret"
          ? { status: 404, body: { error: "not found" } }
          : { status: 401, body: { error: "unauthorized" } };
      },
      "/v1/models": (request) => {
        compatibleAuth = request.headers.authorization;
        return request.headers.authorization === "Bearer lmstudio-secret"
          ? { data: [{ id: "authenticated-model" }] }
          : { status: 401, body: { error: "unauthorized" } };
      }
    });
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "lmstudio"
          ? { ...provider, baseUrl: `${server.url}/v1`, enabled: true, apiKey: "lmstudio-secret" }
          : provider
      )
    );

    try {
      const snapshot = await service.getLibrary();

      expect(nativeAuth).toBe("Bearer lmstudio-secret");
      expect(compatibleAuth).toBe("Bearer lmstudio-secret");
      expect(snapshot.catalog.find((item) => item.id === "lmstudio:authenticated-model")).toMatchObject({
        provider: "lmstudio",
        discovery: { providerId: "lmstudio", reachable: true }
      });
    } finally {
      await closeServer(server.server);
    }
  });

  it("activates reachable discovered models and blocks unavailable remembered models", async () => {
    const { service, storage } = setup("available");
    const server = await jsonRouteServer({
      "/api/v0/models": { data: [{ id: "available-model", type: "llm" }] }
    });
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "lmstudio" ? { ...provider, baseUrl: `${server.url}/v1`, enabled: true } : provider
      )
    );

    try {
      await service.getLibrary();
      const activeSnapshot = await service.activateModel("lmstudio:available-model");

      expect(activeSnapshot.activeModelIds.language).toBe("lmstudio:available-model");
    } finally {
      await closeServer(server.server);
    }

    await service.getLibrary();
    storage.setActiveModel("language", undefined);
    const unavailableSnapshot = await service.activateModel("lmstudio:available-model");

    expect(unavailableSnapshot.activeModelIds.language).toBeUndefined();
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

type JsonRouteResponse = { status: number; body: unknown };
type JsonRouteHandler = (request: IncomingMessage) => Record<string, unknown> | JsonRouteResponse;
type JsonRoute = Record<string, unknown> | JsonRouteResponse | JsonRouteHandler;

function jsonRouteServer(routes: Record<string, JsonRoute>): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = request.url ?? "";
      if (!Object.prototype.hasOwnProperty.call(routes, path)) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }

      const route = routes[path];
      const result = typeof route === "function" ? route(request) : route;
      const status = isRouteResponse(result) ? result.status : 200;
      const body = isRouteResponse(result) ? result.body : result;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start test server.");
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function isRouteResponse(value: unknown): value is JsonRouteResponse {
  return Boolean(value && typeof value === "object" && "status" in value && "body" in value);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
