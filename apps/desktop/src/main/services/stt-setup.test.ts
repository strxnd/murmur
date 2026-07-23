import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modelCatalog } from "../../shared/model-catalog";
import type { SttRuntimeAvailability, SttRuntimeId, SttRuntimeInstallState, SttRuntimeVariantKey } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
import { ModelLibraryService } from "./model-library";
import { StorageService } from "./storage";
import { SttSetupService } from "./stt-setup";
import type { SttRuntimeService } from "./stt-runtime";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("SttSetupService", () => {
  it("reports first-run setup as needed when no STT provider is usable", () => {
    const { setup } = createSetup("not_installed");

    const snapshot = setup.getSnapshot();

    expect(snapshot.needsSetup).toBe(true);
    expect(snapshot.skipped).toBe(false);
    expect(snapshot.completed).toBe(false);
  });

  it("hides first-run setup after skip", () => {
    const { setup } = createSetup("not_installed");

    setup.skipSttSetup();
    const snapshot = setup.getSnapshot();

    expect(snapshot.skipped).toBe(true);
    expect(snapshot.needsSetup).toBe(false);
  });

  it("does not require setup for existing users with an active downloaded model and runtime", async () => {
    const { setup, storage, modelLibrary, paths } = createSetup("ready");
    writeFileSync(join(paths.modelDir, "ggml-tiny.en.bin"), "model");
    storage.upsertModelDownload({
      modelId: "whisper-tiny-en",
      status: "downloaded",
      progressBytes: 1,
      localPath: join(paths.modelDir, "ggml-tiny.en.bin"),
      favorite: false
    });
    storage.setTranscriptionProviders(
      storage.getState().transcriptionProviders.map((provider) =>
        provider.id === "local-whisper-cpp" ? { ...provider, enabled: true } : provider
      )
    );
    storage.setActiveModel("voice", "whisper-tiny-en");
    await modelLibrary.getLibrary();

    const snapshot = setup.getSnapshot();

    expect(snapshot.needsSetup).toBe(false);
  });

  it("repairs the required runtime before activating a downloaded model", async () => {
    const runtime = fakeRuntimeService("repairable");
    const { setup, storage } = createSetup("repairable", runtime);
    const server = await modelServer("model");
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    if (!item) throw new Error("Missing whisper-tiny-en catalog item.");
    const originalUrl = item.downloadUrl;
    const originalSha256 = item.sha256;
    item.downloadUrl = server.url;
    item.sha256 = sha256("model");

    try {
      await setup.setupBundledStt("whisper-tiny-en");
      const state = storage.getState();

      expect(runtime.repaired).toBe(true);
      expect(state.modelLibrary.activeModelIds.voice).toBe("whisper-tiny-en");
      expect(state.settings.sttSetupCompletedAt).toBeTruthy();
    } finally {
      item.downloadUrl = originalUrl;
      item.sha256 = originalSha256;
      await closeServer(server.server);
    }
  });

  it("does not repair the required runtime when runtime actions are disabled", async () => {
    const runtime = fakeRuntimeService("not_installed", {
      canDownload: false,
      canRepair: false,
      message: "Packaged runtime is missing."
    });
    const { setup } = createSetup("not_installed", runtime);

    await expect(setup.setupBundledStt("whisper-tiny-en")).rejects.toThrow("Packaged runtime is missing.");
    expect(runtime.repaired).toBe(false);
  });
});

function createSetup(status: SttRuntimeInstallState["status"], runtime = fakeRuntimeService(status)) {
  const paths = testPaths();
  const storage = jsonStorage(paths);
  const modelLibrary = new ModelLibraryService(paths, storage, () => undefined, runtime as unknown as SttRuntimeService);
  const setup = new SttSetupService(paths, storage, modelLibrary, runtime as unknown as SttRuntimeService);
  return { setup, storage, modelLibrary, paths };
}

function fakeRuntimeService(
  initialStatus: SttRuntimeInstallState["status"],
  options: Partial<Pick<SttRuntimeInstallState, "canDownload" | "canRepair" | "message">> = {}
) {
  let status = initialStatus;
  const runtime = {
    repaired: false,
    getAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return {
        id,
        variantKey: `${id}|linux-x64|cpu|0.0.0-test`,
        accelerator: "cpu",
        label: id,
        platformKey: "linux-x64",
        status: status === "ready" ? "available" : "missing",
        message: `${id} ${status}`
      };
    },
    getAutomaticAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return runtime.getAvailability(id);
    },
    getInstallState(id: SttRuntimeId): SttRuntimeInstallState {
      return installState(id, status, options);
    },
    getInstallStates(): Record<SttRuntimeVariantKey, SttRuntimeInstallState> {
      return {
        "whisper.cpp|linux-x64|cpu|0.0.0-test": installState("whisper.cpp", status, options),
        "sherpa-onnx|linux-x64|cpu|0.0.0-test": installState("sherpa-onnx", status, options)
      };
    },
    async repairRuntime(): Promise<SttRuntimeInstallState> {
      runtime.repaired = true;
      status = "ready";
      return installState("whisper.cpp", "ready");
    }
  };
  return runtime;
}

function installState(
  id: SttRuntimeId,
  status: SttRuntimeInstallState["status"],
  options: Partial<Pick<SttRuntimeInstallState, "canDownload" | "canRepair" | "message">> = {}
): SttRuntimeInstallState {
  return {
    id,
    variantKey: `${id}|linux-x64|cpu|0.0.0-test`,
    accelerator: "cpu",
    label: id,
    platformKey: "linux-x64",
    requiredVersion: "0.0.0-test",
    status,
    progressBytes: 0,
    message: options.message ?? `${id} ${status}`,
    canDownload: options.canDownload ?? status !== "ready",
    canRepair: options.canRepair ?? status !== "ready"
  };
}

function jsonStorage(paths: AppPaths): StorageService {
  return new StorageService(paths, () => {
    throw new Error("sqlite disabled for test");
  });
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
