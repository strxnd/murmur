import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modelCatalog } from "../../shared/model-catalog";
import { buildProviderSetupDraft } from "../../shared/model-provider-setup";
import type { SttRuntimeAvailability, SttRuntimeId } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
import { ModelLibraryService } from "./model-library";
import type { ProviderSecretCodec } from "./provider-secrets";
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

  it("preserves an unreadable STT secret record while enabling a local provider", async () => {
    let encryptionAvailable = true;
    const { service, storage, paths } = setup("available", reversibleCodec(() => encryptionAvailable));
    storage.setTranscriptionProviders(
      storage.getState().transcriptionProviders.map((provider) =>
        provider.id === "local-whisper-cpp"
          ? { ...provider, apiKey: "local-stt-secret", apiKeyIntent: "replace", enabled: false }
          : provider
      )
    );
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    storage.upsertModelDownload(downloaded("whisper-tiny-en", paths));

    encryptionAvailable = false;
    const snapshot = await service.activateModel("whisper-tiny-en");

    expect(snapshot.activeModelIds.voice).toBe("whisper-tiny-en");
    encryptionAvailable = true;
    const provider = storage.getState().transcriptionProviders.find((candidate) => candidate.id === "local-whisper-cpp");
    expect(provider ? storage.resolveTranscriptionProviderSecret(provider).apiKey : undefined).toBe("local-stt-secret");
  });

  it("preserves an unreadable LLM secret record while enabling a local provider", async () => {
    let encryptionAvailable = true;
    const { service, storage } = setup("available", reversibleCodec(() => encryptionAvailable));
    storage.setLlmProviders([
      ...storage.getState().llmProviders,
      {
        id: "local-compatible",
        type: "custom_openai_compatible",
        name: "Local compatible",
        baseUrl: "http://127.0.0.1:9000/v1",
        apiKey: "local-llm-secret",
        apiKeyIntent: "replace",
        isCloud: false,
        models: ["local-model"],
        enabled: true
      }
    ]);
    await service.getLibrary();
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "local-compatible" ? { ...provider, enabled: false, apiKeyIntent: "keep" } : provider
      )
    );

    encryptionAvailable = false;
    const snapshot = await service.activateModel("local-compatible:local-model");

    expect(snapshot.activeModelIds.language).toBe("local-compatible:local-model");
    encryptionAvailable = true;
    const provider = storage.getState().llmProviders.find((candidate) => candidate.id === "local-compatible");
    expect(provider ? storage.resolveLlmProviderSecret(provider).apiKey : undefined).toBe("local-llm-secret");
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
    const originalSha256 = item.sha256;
    item.downloadUrl = server.url;
    item.sha256 = sha256("model-bytes");

    try {
      const snapshot = await service.downloadModel("whisper-tiny-en");
      const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");
      const expectedPath = join(paths.modelDir, "ggml-tiny.en.bin");

      expect(download?.status).toBe("downloaded");
      expect(download?.localPath).toBe(expectedPath);
      expect(readFileSync(expectedPath, "utf8")).toBe("model-bytes");
    } finally {
      item.downloadUrl = originalUrl;
      item.sha256 = originalSha256;
      await closeServer(server.server);
    }
  });

  it("rejects direct file hash mismatches without activating partial artifacts", async () => {
    const { service, paths } = setup("available");
    const server = await modelServer("tampered-model-bytes");
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalUrl = item.downloadUrl;
    const originalSha256 = item.sha256;
    item.downloadUrl = server.url;
    item.sha256 = sha256("expected-model-bytes");

    try {
      const snapshot = await service.downloadModel("whisper-tiny-en");
      const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");
      const expectedPath = join(paths.modelDir, "ggml-tiny.en.bin");

      expect(download?.status).toBe("error");
      expect(download?.error).toContain("SHA-256 mismatch");
      expect(existsSync(expectedPath)).toBe(false);
      expect(existsSync(`${expectedPath}.part`)).toBe(false);
    } finally {
      item.downloadUrl = originalUrl;
      item.sha256 = originalSha256;
      await closeServer(server.server);
    }
  });

  it("times out stalled direct file bodies after response headers", async () => {
    const paths = testPaths();
    const storage = new StorageService(paths);
    const server = await stalledBodyServer(64);
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalUrl = item.downloadUrl;
    item.downloadUrl = server.url;
    const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService("available"), {
      downloadBodyTimeoutMs: 20
    });

    try {
      const snapshot = await service.downloadModel("whisper-tiny-en");
      const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");
      const expectedPath = join(paths.modelDir, "ggml-tiny.en.bin");

      expect(download?.status).toBe("error");
      expect(download?.error).toContain("response body");
      expect(existsSync(expectedPath)).toBe(false);
      expect(existsSync(`${expectedPath}.part`)).toBe(false);
    } finally {
      item.downloadUrl = originalUrl;
      await closeServer(server.server);
    }
  });

  it("throttles direct file download progress emissions", async () => {
    const paths = testPaths();
    const storage = new StorageService(paths);
    const body = Array.from({ length: 64 }, () => "x").join("");
    const server = await chunkedModelServer(body, 1);
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalUrl = item.downloadUrl;
    const originalSha256 = item.sha256;
    item.downloadUrl = server.url;
    item.sha256 = sha256(body);
    const progressEvents: number[] = [];
    const service = new ModelLibraryService(
      paths,
      storage,
      (download) => {
        if (download.modelId === "whisper-tiny-en" && download.status === "downloading") {
          progressEvents.push(download.progressBytes);
        }
      },
      fakeRuntimeService("available"),
      { progressEmitIntervalMs: 60_000 }
    );

    try {
      const snapshot = await service.downloadModel("whisper-tiny-en");
      const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");

      expect(download?.status).toBe("downloaded");
      expect(progressEvents.length).toBeLessThan(64);
      expect(progressEvents).toContain(64);
    } finally {
      item.downloadUrl = originalUrl;
      item.sha256 = originalSha256;
      await closeServer(server.server);
    }
  });

  it("rejects archive downloads with unsafe member paths before extraction", async () => {
    const { service, paths } = setup("available");
    const archive = unsafeTarBz2();
    const server = await binaryModelServer(archive);
    const item = modelCatalog.find((candidate) => candidate.id === "nvidia-parakeet-tdt-ctc-110m");
    if (!item) throw new Error("Missing Parakeet catalog item.");
    const originalUrl = item.downloadUrl;
    const originalSha256 = item.sha256;
    item.downloadUrl = server.url;
    item.sha256 = sha256(archive);

    try {
      const snapshot = await service.downloadModel(item.id);
      const download = snapshot.downloads.find((candidate) => candidate.modelId === item.id);

      expect(download?.status).toBe("error");
      expect(download?.error).toContain("unsafe path");
      expect(existsSync(join(paths.modelDir, item.extractDir!))).toBe(false);
      expect(existsSync(join(paths.modelDir, item.filename!))).toBe(false);
      expect(existsSync(join(paths.modelDir, `${item.filename!}.part`))).toBe(false);
    } finally {
      item.downloadUrl = originalUrl;
      item.sha256 = originalSha256;
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
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalSha256 = item.sha256;
    item.sha256 = sha256("");
    const storage = new StorageService(paths);

    try {
      const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService("available"));
      const snapshot = service.snapshot();
      const download = snapshot.downloads.find((candidate) => candidate.modelId === "whisper-tiny-en");

      expect(download?.status).toBe("downloaded");
      expect(download?.localPath).toBe(join(paths.modelDir, "ggml-tiny.en.bin"));
    } finally {
      item.sha256 = originalSha256;
    }
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

  it("discovers models from custom Ollama and LM Studio provider URLs", async () => {
    const { service, storage } = setup("available");
    const ollamaServer = await jsonRouteServer({
      "/api/tags": { models: [{ model: "custom-llama:latest" }] }
    });
    const lmStudioServer = await jsonRouteServer({
      "/api/v0/models": { data: [{ id: "custom/studio-model", type: "llm" }] }
    });
    storage.setLlmProviders([
      ...storage.getState().llmProviders,
      {
        id: "team-ollama",
        type: "ollama",
        name: "Team Ollama",
        baseUrl: ollamaServer.url,
        isCloud: false,
        enabled: true
      },
      {
        id: "team-lmstudio",
        type: "lmstudio",
        name: "Team LM Studio",
        baseUrl: `${lmStudioServer.url}/v1`,
        isCloud: false,
        enabled: true
      }
    ]);

    try {
      const snapshot = await service.getLibrary();

      expect(snapshot.catalog.find((item) => item.id === "team-ollama:custom-llama:latest")).toMatchObject({
        provider: "ollama",
        discovery: { origin: "discovered", providerId: "team-ollama", reachable: true },
        defaultProviderConfig: { providerId: "team-ollama", llmProviderType: "ollama", model: "custom-llama:latest" }
      });
      expect(snapshot.catalog.find((item) => item.id === "team-lmstudio:custom/studio-model")).toMatchObject({
        provider: "lmstudio",
        discovery: { origin: "discovered", providerId: "team-lmstudio", reachable: true },
        defaultProviderConfig: { providerId: "team-lmstudio", llmProviderType: "lmstudio", model: "custom/studio-model" }
      });
    } finally {
      await closeServer(ollamaServer.server);
      await closeServer(lmStudioServer.server);
    }
  });

  it("adds manual OpenAI-compatible provider models to the catalog and activates them", async () => {
    const { service, storage } = setup("available");
    storage.setLlmProviders([
      ...storage.getState().llmProviders,
      {
        id: "custom-openai-compatible",
        type: "custom_openai_compatible",
        name: "Custom OpenAI-compatible",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-test",
        isCloud: true,
        models: ["custom-model-a", "custom-model-b"],
        enabled: true
      }
    ]);

    const library = await service.getLibrary();
    const model = library.catalog.find((item) => item.id === "custom-openai-compatible:custom-model-a");

    expect(model).toMatchObject({
      name: "custom-model-a",
      provider: "openai_compatible",
      isCloud: true,
      isOffline: false,
      discovery: { origin: "manual", providerId: "custom-openai-compatible", reachable: true },
      defaultProviderConfig: {
        providerId: "custom-openai-compatible",
        llmProviderType: "custom_openai_compatible",
        baseUrl: "https://models.example.test/v1",
        model: "custom-model-a"
      }
    });

    const activated = await service.activateModel("custom-openai-compatible:custom-model-a");

    expect(activated.activeModelIds.language).toBe("custom-openai-compatible:custom-model-a");
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

function setup(status: SttRuntimeAvailability["status"], providerSecretCodec?: ProviderSecretCodec) {
  const paths = testPaths();
  const storage = new StorageService(paths, undefined, providerSecretCodec);
  const service = new ModelLibraryService(paths, storage, () => undefined, fakeRuntimeService(status));
  return { service, storage, paths };
}

function reversibleCodec(isAvailable: () => boolean): ProviderSecretCodec {
  return {
    encoding: "electron-safe-storage",
    isAvailable,
    encrypt: (value) => Buffer.from(`encrypted:${value}`).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^encrypted:/, "")
  };
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
  const service = {
    getAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return {
        id,
        variantKey: `${id}|linux-x64|cpu|0.0.0-test`,
        accelerator: "cpu",
        label: id,
        status,
        platformKey: "linux-x64",
        message: `${id} ${status}`
      };
    },
    getAutomaticAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return service.getAvailability(id);
    }
  };
  return service as unknown as SttRuntimeService;
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

function binaryModelServer(body: Buffer): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": body.byteLength
      });
      response.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start test server.");
      resolve({ server, url: `http://127.0.0.1:${address.port}/model.tar.bz2` });
    });
  });
}

function stalledBodyServer(contentLength: number): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": contentLength
      });
      response.flushHeaders();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start test server.");
      resolve({ server, url: `http://127.0.0.1:${address.port}/model.bin` });
    });
  });
}

function chunkedModelServer(body: string, chunkSize: number): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": Buffer.byteLength(body)
      });
      for (let index = 0; index < body.length; index += chunkSize) {
        response.write(body.slice(index, index + chunkSize));
      }
      response.end();
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

function unsafeTarBz2(): Buffer {
  const root = tempRoot();
  const tarPath = join(root, "unsafe.tar");
  const archivePath = join(root, "unsafe.tar.bz2");
  writeFileSync(tarPath, tarWithSingleFile("../payload.txt", "payload"));
  const result = spawnSync("bzip2", ["-c", tarPath]);
  if (result.status !== 0) {
    throw new Error(`Could not create unsafe tar fixture: ${result.stderr.toString("utf8")}`);
  }
  writeFileSync(archivePath, result.stdout);
  return readFileSync(archivePath);
}

function tarWithSingleFile(name: string, contents: string): Buffer {
  const body = Buffer.from(contents);
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(Buffer.byteLength(name), 100), "utf8");
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, body.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeTarOctal(header, 148, 8, checksum);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024, 0)]);
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(text.slice(-length + 1), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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
