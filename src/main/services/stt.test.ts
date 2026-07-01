import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SttRuntimeAvailability, SttRuntimeId, TranscriptionProviderConfig } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
import { BoundedTextBuffer, buildSherpaArgs, buildWhisperServerArgs, TranscriptionService } from "./stt";
import type { ResolvedSttRuntime, SttRuntimeService } from "./stt-runtime";

let tempDirs: string[] = [];
const servers: Array<() => Promise<void>> = [];
const originalTotalTimeout = process.env.MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS;
const originalIdleTimeout = process.env.MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS;

afterEach(async () => {
  restoreTimeoutEnv();
  await Promise.all(servers.splice(0).map((close) => close()));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("STT runtime args", () => {
  it("builds Sherpa CTC args", () => {
    const modelDir = tempRoot();
    touch(join(modelDir, "tokens.txt"));
    touch(join(modelDir, "model.int8.onnx"));

    const args = buildSherpaArgs(modelDir, "/tmp/audio.wav", "6");

    expect(args.some((arg) => arg.startsWith("--nemo-ctc-model="))).toBe(true);
    expect(args.some((arg) => arg.startsWith("--tokens="))).toBe(true);
    expect(args).toContain("--num-threads=6");
    expect(args).toContain("--debug=false");
    expect(args.at(-1)).toBe("/tmp/audio.wav");
  });

  it("builds Sherpa transducer args", () => {
    const modelDir = tempRoot();
    touch(join(modelDir, "tokens.txt"));
    touch(join(modelDir, "encoder.int8.onnx"));
    touch(join(modelDir, "decoder.int8.onnx"));
    touch(join(modelDir, "joiner.int8.onnx"));

    const args = buildSherpaArgs(modelDir, "/tmp/audio.wav", "3");

    expect(args.some((arg) => arg.startsWith("--encoder="))).toBe(true);
    expect(args.some((arg) => arg.startsWith("--decoder="))).toBe(true);
    expect(args.some((arg) => arg.startsWith("--joiner="))).toBe(true);
    expect(args).toContain("--model-type=nemo_transducer");
    expect(args).toContain("--debug=false");
  });

  it("builds whisper-server args", () => {
    const args = buildWhisperServerArgs(49152, "/models/ggml-tiny.en.bin", "8");

    expect(args).toEqual([
      "--host",
      "127.0.0.1",
      "--port",
      "49152",
      "--model",
      "/models/ggml-tiny.en.bin",
      "--inference-path",
      "/inference",
      "--threads",
      "8"
    ]);
  });

  it("resolves relative bundled model names through the cache model dir", async () => {
    const paths = testPaths();
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    const service = new TranscriptionService(paths, fakeRuntimeService("available"));

    const result = await service.validate({
      id: "local-whisper-cpp",
      type: "whisper_cpp",
      name: "Bundled whisper.cpp",
      baseUrl: "murmur://runtime/whisper.cpp",
      endpointPath: "/inference",
      isCloud: false,
      isLocal: true,
      defaultModel: "ggml-tiny.en.bin",
      streamingMode: "none",
      enabled: true
    });

    expect(result.ok).toBe(true);
  });

  it("writes Sherpa scratch audio under the temp dir", async () => {
    const paths = testPaths();
    const modelDir = join(paths.modelDir, "sherpa-test-model");
    const argsPath = join(paths.tempDir, "sherpa-args.json");
    touch(join(modelDir, "tokens.txt"));
    touch(join(modelDir, "model.int8.onnx"));
    const runtimePath = runtimeShim(tempRoot());
    const service = new TranscriptionService(paths, fakeRuntimeService("available", runtimePath, argsPath));

    const result = await service.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav",
      provider: sherpaProvider("sherpa-test-model")
    });

    const args = JSON.parse(readFileSync(argsPath, "utf8")) as string[];
    const audioPath = args.at(-1);
    if (!audioPath) throw new Error("Sherpa shim did not record an audio path.");
    const relativeAudioPath = relative(paths.tempDir, audioPath);
    expect(result.text).toBe("shim transcript");
    expect(relativeAudioPath.startsWith("..")).toBe(false);
    expect(isAbsolute(relativeAudioPath)).toBe(false);
    expect(existsSync(audioPath)).toBe(false);
  });

  it("rejects stalled OpenAI-compatible response bodies", async () => {
    process.env.MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS = "60";
    process.env.MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS = "20";
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"text":');
    });
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    await expect(
      service.transcribe({
        audio: new Uint8Array([1, 2, 3]),
        mimeType: "audio/wav",
        provider: openAiCompatibleProvider(url)
      })
    ).rejects.toThrow(/STT transcription response body/);
  });

  it("bounds retained runtime diagnostics text", () => {
    const buffer = new BoundedTextBuffer(12);

    buffer.append("1234567890");
    buffer.append("abcdef");

    expect(buffer.text()).toBe("567890abcdef");
  });
});

function sherpaProvider(defaultModel: string): TranscriptionProviderConfig {
  return {
    id: "local-sherpa",
    type: "sherpa_onnx",
    name: "Bundled Sherpa",
    baseUrl: "murmur://runtime/sherpa-onnx",
    isCloud: false,
    isLocal: true,
    defaultModel,
    streamingMode: "none",
    enabled: true
  };
}

function openAiCompatibleProvider(baseUrl: string): TranscriptionProviderConfig {
  return {
    id: "local-openai-stt",
    type: "local_openai_compatible_stt",
    name: "Local OpenAI-compatible STT",
    baseUrl,
    endpointPath: "/audio/transcriptions",
    isCloud: false,
    isLocal: true,
    defaultModel: "test-model",
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: true
  };
}

function fakeRuntimeService(
  status: SttRuntimeAvailability["status"],
  binaryPath = "/tmp/runtime",
  argsPath = "/tmp/sherpa-args.json"
): SttRuntimeService {
  const service = {
    getAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return {
        id,
        variantKey: `${id}|linux-x64|cpu|0.0.0-test`,
        accelerator: "cpu",
        label: id,
        status,
        platformKey: "linux-x64",
        binaryPath,
        source: "env",
        message: `${id} ${status}`
      };
    },
    getAutomaticAvailability(id: SttRuntimeId): SttRuntimeAvailability {
      return service.getAvailability(id);
    },
    requireRuntime(id: SttRuntimeId): ResolvedSttRuntime {
      return {
        id,
        variantKey: `${id}|linux-x64|cpu|0.0.0-test`,
        accelerator: "cpu",
        label: id,
        platformKey: "linux-x64",
        binaryPath,
        rootDir: dirname(binaryPath),
        cwd: dirname(binaryPath),
        source: "env",
        version: "0.0.0-test",
        env: { ...process.env, MURMUR_ARGS_PATH: argsPath }
      };
    },
    requireAutomaticRuntime(id: SttRuntimeId): ResolvedSttRuntime {
      return service.requireRuntime(id);
    }
  };
  return service as unknown as SttRuntimeService;
}

function runtimeShim(root: string): string {
  const path = join(root, "sherpa-shim.cjs");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      "fs.writeFileSync(process.env.MURMUR_ARGS_PATH, JSON.stringify(process.argv.slice(2)));",
      'process.stdout.write(JSON.stringify({ text: "shim transcript" }) + "\\n");'
    ].join("\n")
  );
  chmodSync(path, 0o755);
  return path;
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

function restoreTimeoutEnv(): void {
  restoreEnvValue("MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS", originalTotalTimeout);
  restoreEnvValue("MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS", originalIdleTimeout);
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function startServer(handler: (response: ServerResponse) => void): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => handler(response));
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port."));
        return;
      }
      servers.push(() => closeServer(server, sockets));
      resolve({ url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
