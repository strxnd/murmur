import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SttRuntimeService } from "./stt-runtime";
import { sttRuntimeCatalog } from "../../shared/stt-runtime-catalog";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("SttRuntimeService", () => {
  it("resolves env var paths first", () => {
    const root = tempRoot();
    const envBinary = touch(join(root, "env", "whisper-server"));
    touch(join(root, "vendor", "runtimes", "linux-x64", "whisper.cpp", "whisper-server"));

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      env: { MURMUR_WHISPER_CPP_SERVER: envBinary }
    });

    const availability = service.getAvailability("whisper.cpp");
    expect(availability.status).toBe("available");
    expect(availability.source).toBe("env");
    expect(availability.binaryPath).toBe(envBinary);
    expect(availability.message).toBe("whisper.cpp runtime is available.");
    expect(availability.message).not.toContain(envBinary);
  });

  it("resolves packaged resources before vendor", () => {
    const root = tempRoot();
    const resourcesPath = join(root, "resources");
    const resourcesBinary = touch(join(resourcesPath, "runtimes", "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));
    touch(join(root, "vendor", "runtimes", "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      resourcesPath,
      env: {}
    });

    const availability = service.getAvailability("sherpa-onnx");
    expect(availability.status).toBe("available");
    expect(availability.source).toBe("resources");
    expect(availability.binaryPath).toBe(resourcesBinary);
  });

  it("reports packaged resource runtimes as ready without download actions when downloads are disabled", () => {
    const root = tempRoot();
    const resourcesPath = join(root, "resources");
    const resourcesBinary = touch(join(resourcesPath, "runtimes", "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      resourcesPath,
      env: {},
      downloadsEnabled: false
    });

    const state = service.getInstallState("sherpa-onnx");
    expect(state.status).toBe("ready");
    expect(state.source).toBe("resources");
    expect(state.binaryPath).toBe(resourcesBinary);
    expect(state.canDownload).toBe(false);
    expect(state.canRepair).toBe(false);
  });

  it("resolves cache installs before dev vendor", () => {
    const root = tempRoot();
    const runtimeDir = join(root, "cache", "runtimes", "stt");
    const cacheRoot = join(runtimeDir, "linux-x64", "whisper.cpp", "v1.8.6");
    const cacheBinary = touch(join(cacheRoot, "whisper-server"));
    writeRuntimeReceipt(cacheRoot, "whisper.cpp", "linux-x64", "v1.8.6");
    touch(join(root, "vendor", "runtimes", "linux-x64", "whisper.cpp", "whisper-server"));

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      runtimeDir,
      env: {}
    });

    const availability = service.getAvailability("whisper.cpp");
    expect(availability.status).toBe("available");
    expect(availability.source).toBe("cache");
    expect(availability.binaryPath).toBe(cacheBinary);
  });

  it("keeps cache installs ready but disables actions when downloads are disabled", () => {
    const root = tempRoot();
    const runtimeDir = join(root, "cache", "runtimes", "stt");
    const cacheRoot = join(runtimeDir, "linux-x64", "whisper.cpp", "v1.8.6");
    const cacheBinary = touch(join(cacheRoot, "whisper-server"));
    writeRuntimeReceipt(cacheRoot, "whisper.cpp", "linux-x64", "v1.8.6");

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      runtimeDir,
      env: {},
      downloadsEnabled: false
    });

    const state = service.getInstallState("whisper.cpp");
    expect(state.status).toBe("ready");
    expect(state.source).toBe("cache");
    expect(state.binaryPath).toBe(cacheBinary);
    expect(state.canDownload).toBe(false);
    expect(state.canRepair).toBe(false);
  });

  it("handles .exe candidates on Windows", () => {
    const root = tempRoot();
    const binary = touch(join(root, "vendor", "runtimes", "win32-x64", "whisper.cpp", "whisper-server.exe"));

    const service = new SttRuntimeService({
      platform: "win32",
      arch: "x64",
      projectRoot: root,
      env: {}
    });

    const availability = service.getAvailability("whisper.cpp");
    expect(availability.status).toBe("available");
    expect(availability.binaryPath).toBe(binary);
  });

  it("keeps missing runtime messages actionable", () => {
    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot(),
      env: {}
    });

    const availability = service.getAvailability("whisper.cpp");

    expect(availability.status).toBe("missing");
    expect(availability.message).toContain("MURMUR_WHISPER_CPP_SERVER");
    expect(availability.message).toContain("vendor/runtimes/linux-x64/whisper.cpp");

    const state = service.getInstallState("whisper.cpp");
    expect(state.status).toBe("not_installed");
    expect(state.canDownload).toBe(true);
    expect(state.canRepair).toBe(false);
  });

  it("reports missing packaged runtimes without download actions when downloads are disabled", () => {
    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot(),
      env: {},
      downloadsEnabled: false
    });

    const state = service.getInstallState("sherpa-onnx");

    expect(state.status).toBe("not_installed");
    expect(state.canDownload).toBe(false);
    expect(state.canRepair).toBe(false);
    expect(state.message).toBe(
      "Sherpa ONNX runtime was not found in bundled application resources for linux-x64. Reinstall Murmur or set MURMUR_SHERPA_ONNX_OFFLINE to a compatible binary."
    );
  });

  it("returns unsupported for unknown platform and arch", () => {
    const service = new SttRuntimeService({
      platform: "freebsd",
      arch: "x64",
      projectRoot: tempRoot(),
      env: {}
    });

    expect(service.getAvailability("whisper.cpp").status).toBe("unsupported");
    expect(() => service.requireRuntime("whisper.cpp")).toThrow(/not bundled/);
  });

  it("marks corrupt cache receipts as repairable", () => {
    const root = tempRoot();
    const runtimeDir = join(root, "cache", "runtimes", "stt");
    const cacheRoot = join(runtimeDir, "linux-x64", "whisper.cpp", "v1.8.6");
    touch(join(cacheRoot, "whisper-server"));
    writeFileSync(join(cacheRoot, "runtime.json"), "{not json");

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      runtimeDir,
      env: {}
    });

    const state = service.getInstallState("whisper.cpp");
    expect(state.status).toBe("repairable");
    expect(state.canRepair).toBe(true);
  });

  it("cleans partial downloads and staging dirs on startup", () => {
    const root = tempRoot();
    const runtimeDir = join(root, "cache", "runtimes", "stt");
    const parent = join(runtimeDir, "linux-x64", "whisper.cpp");
    const part = join(parent, "runtime.tar.gz.part");
    const staging = join(parent, "v1.8.6.staging-1");
    touch(part);
    mkdirSync(staging, { recursive: true });

    new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      runtimeDir,
      env: {}
    });

    expect(existsSync(part)).toBe(false);
    expect(existsSync(staging)).toBe(false);
  });

  it("marks SHA mismatches as errors and deletes staged archives", async () => {
    const root = tempRoot();
    const runtimeDir = join(root, "cache", "runtimes", "stt");
    const catalog = structuredClone(sttRuntimeCatalog);
    catalog["whisper.cpp"].platforms["linux-x64"] = {
      assetName: "runtime.tar.gz",
      url: "https://example.test/runtime.tar.gz",
      sizeBytes: 5,
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
    };

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      runtimeDir,
      env: {},
      catalog,
      fetch: async () => new Response("bytes", { status: 200, headers: { "content-length": "5" } }),
      extractArchive: async () => undefined
    });

    const state = await service.downloadRuntime("whisper.cpp");

    expect(state.status).toBe("error");
    expect(state.error).toContain("SHA-256 mismatch");
    expect(service.getInstallState("whisper.cpp").status).toBe("error");
  });

  it("does not fetch or emit progress when download and repair are disabled", async () => {
    let fetchCalls = 0;
    let progressEvents = 0;
    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: tempRoot(),
      env: {},
      downloadsEnabled: false,
      fetch: async () => {
        fetchCalls += 1;
        return new Response("bytes", { status: 200 });
      },
      emitProgress: () => {
        progressEvents += 1;
      }
    });

    const downloadState = await service.downloadRuntime("whisper.cpp");
    const repairState = await service.repairRuntime("whisper.cpp");

    expect(downloadState.status).toBe("not_installed");
    expect(repairState.status).toBe("not_installed");
    expect(fetchCalls).toBe(0);
    expect(progressEvents).toBe(0);
  });

  it("passes cancellation to runtime archive extraction", async () => {
    const root = tempRoot();
    const runtimeDir = join(root, "cache", "runtimes", "stt");
    const bytes = "bytes";
    const catalog = structuredClone(sttRuntimeCatalog);
    catalog["whisper.cpp"].platforms["linux-x64"] = {
      assetName: "runtime.tar.gz",
      url: "https://example.test/runtime.tar.gz",
      sizeBytes: bytes.length,
      sha256: sha256(bytes)
    };

    let extractSignal: AbortSignal | undefined;
    let extractionStarted!: () => void;
    const extractionStartedPromise = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      runtimeDir,
      env: {},
      catalog,
      fetch: async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } }),
      extractArchive: async (_archivePath, _targetDir, signal) => {
        extractSignal = signal;
        extractionStarted();
        return new Promise<void>((_resolve, reject) => {
          const failWithAbort = (): void => reject(createAbortError());
          if (signal?.aborted) {
            failWithAbort();
            return;
          }
          signal?.addEventListener("abort", failWithAbort, { once: true });
        });
      }
    });

    const installPromise = service.downloadRuntime("whisper.cpp");
    await extractionStartedPromise;

    expect(extractSignal).toBeDefined();
    expect(extractSignal?.aborted).toBe(false);

    const cancelState = await service.cancelRuntimeDownload("whisper.cpp");
    const installState = await installPromise;

    expect(extractSignal?.aborted).toBe(true);
    expect(cancelState.status).toBe("not_installed");
    expect(installState.status).toBe("not_installed");
    expect(existsSync(join(runtimeDir, "linux-x64", "whisper.cpp", "v1.8.6"))).toBe(false);
  });

  it("builds dynamic library environment variables", () => {
    const root = tempRoot();
    const runtimeRoot = join(root, "vendor", "runtimes", "linux-x64", "sherpa-onnx");
    touch(join(runtimeRoot, "bin", "sherpa-onnx-offline"));
    mkdirSync(join(runtimeRoot, "lib"), { recursive: true });

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      env: { LD_LIBRARY_PATH: "/system/lib" }
    });

    const runtime = service.requireRuntime("sherpa-onnx");
    const paths = runtime.env.LD_LIBRARY_PATH?.split(":") ?? [];
    expect(paths[0]).toBe(join(runtimeRoot, "lib"));
    expect(paths).toContain("/system/lib");
  });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
  tempDirs.push(dir);
  return dir;
}

function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return path;
}

function writeRuntimeReceipt(root: string, id: string, platformKey: string, version: string): void {
  writeFileSync(
    join(root, "runtime.json"),
    JSON.stringify({
      id,
      platformKey,
      version,
      archiveName: "runtime.tar.gz",
      archiveSha256: "0".repeat(64),
      installedAt: new Date().toISOString()
    })
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
