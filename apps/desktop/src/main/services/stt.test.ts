import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SttRuntimeAvailability, SttRuntimeId, TranscriptionProviderConfig } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
import { providerSuccessBodyMaxBytes, providerTranscriptMaxChars } from "./http";
import { BoundedTextBuffer, buildSherpaArgs, buildWhisperServerArgs, TranscriptionService } from "./stt";
import type { ResolvedSttRuntime, SttRuntimeService } from "./stt-runtime";

let tempDirs: string[] = [];
const servers: Array<() => Promise<void>> = [];
const originalEnv = new Map(
  [
    "MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS",
    "MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS",
    "MURMUR_RUNTIME_READY_TIMEOUT_MS",
    "MURMUR_STT_PROCESS_TIMEOUT_MS",
    "MURMUR_STT_PROCESS_TERMINATION_GRACE_MS"
  ].map((name) => [name, process.env[name]])
);

afterEach(async () => {
  restoreTestEnv();
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

  it("builds whisper-server args with private scratch and capability paths", () => {
    const args = buildWhisperServerArgs(
      49152,
      "/models/ggml-tiny.en.bin",
      "/private/stt",
      "/murmur-secret",
      "/private/challenge",
      "8"
    );

    expect(args).toEqual([
      "--host",
      "127.0.0.1",
      "--port",
      "49152",
      "--model",
      "/models/ggml-tiny.en.bin",
      "--request-path",
      "/murmur-secret",
      "--inference-path",
      "/inference",
      "--tmp-dir",
      "/private/stt",
      "--public",
      "/private/challenge",
      "--threads",
      "8"
    ]);
  });
});

describe("TranscriptionService", () => {
  it("resolves relative bundled model names through the cache model dir", async () => {
    const paths = testPaths();
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    const service = new TranscriptionService(paths, fakeRuntimeService("available"));

    const result = await service.validate(bundledWhisperCppProvider("ggml-tiny.en.bin"));

    expect(result.ok).toBe(true);
    await service.dispose();
  });

  it("returns a failed validation result when the provider connection fails", async () => {
    const { url } = await startServer((response) => response.socket?.destroy());
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    const result = await service.validate(openAiCompatibleProvider(url));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Provider connection failed:/);
    await service.dispose();
  });

  it("rejects non-2xx OpenAI-compatible validation responses", async () => {
    const { url } = await startServer((response) => {
      response.writeHead(429, { "Content-Type": "application/json" });
      response.write('{"error":"rate limited"}');
    });
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    const result = await service.validate(openAiCompatibleProvider(url));

    expect(result).toEqual({ ok: false, message: "Provider validation failed with HTTP 429." });
    await service.dispose();
  });

  it("rejects unknown successful STT response schemas", async () => {
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "upstream failed" } }));
    });
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    await expect(
      service.transcribe({
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: openAiCompatibleProvider(url)
      })
    ).rejects.toThrow("unrecognized success response");
    await service.dispose();
  });

  it("sanitizes STT error bodies that echo transcript metadata", async () => {
    const secretMarker = "CAPTURED_CONTEXT_SECRET";
    const { url } = await startServer((response) => {
      response.writeHead(400, { "x-request-id": "stt_req-123" });
      response.end(`gateway echoed ${secretMarker}`);
    });
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    const request = service.transcribe({
      audio: wavWithSamples(160),
      mimeType: "audio/wav",
      provider: openAiCompatibleProvider(url),
      vocabularyPrompt: secretMarker
    });

    await expect(request).rejects.toThrow("STT failed with HTTP 400 (request ID stt_req-123).");
    await expect(request).rejects.not.toThrow(secretMarker);
    await service.dispose();
  });

  it("rejects STT response bodies above the configured byte ceiling", async () => {
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("x".repeat(providerSuccessBodyMaxBytes + 1));
    });
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    await expect(
      service.transcribe({
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: openAiCompatibleProvider(url)
      })
    ).rejects.toThrow(`exceeded ${providerSuccessBodyMaxBytes} bytes`);
    await service.dispose();
  });

  it("writes Sherpa scratch audio under the private STT temp dir", async () => {
    const paths = testPaths();
    const modelDir = join(paths.modelDir, "sherpa-test-model");
    const argsPath = join(paths.tempDir, "sherpa-args.json");
    touch(join(modelDir, "tokens.txt"));
    touch(join(modelDir, "model.int8.onnx"));
    const runtimePath = sherpaResultShim(tempRoot());
    const service = new TranscriptionService(paths, fakeRuntimeService("available", runtimePath, { MURMUR_ARGS_PATH: argsPath }));

    const result = await service.transcribe({
      audio: wavWithSamples(160),
      mimeType: "audio/wav",
      provider: sherpaProvider("sherpa-test-model")
    });

    const args = JSON.parse(readFileSync(argsPath, "utf8")) as string[];
    const audioPath = args.at(-1);
    if (!audioPath) throw new Error("Sherpa shim did not record an audio path.");
    const relativeAudioPath = relative(paths.sttTempDir, audioPath);
    expect(result.text).toBe("shim transcript");
    expect(relativeAudioPath.startsWith("..")).toBe(false);
    expect(isAbsolute(relativeAudioPath)).toBe(false);
    expect(existsSync(audioPath)).toBe(false);
    await service.dispose();
  });

  it("sweeps stale owned scratch audio at startup and Clear local data", async () => {
    const paths = testPaths();
    const staleSherpa = join(paths.sttTempDir, "dictation-stale.wav");
    const staleWhisper = join(paths.sttTempDir, "whisper-server-stale.wav");
    const unrelated = join(paths.sttTempDir, "keep.txt");
    writeFileSync(staleSherpa, "sensitive audio");
    writeFileSync(staleWhisper, "sensitive audio");
    writeFileSync(unrelated, "keep");

    const service = new TranscriptionService(paths, fakeRuntimeService("available"));

    expect(existsSync(staleSherpa)).toBe(false);
    expect(existsSync(staleWhisper)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);

    const laterScratch = join(paths.sttTempDir, "dictation-later.wav");
    writeFileSync(laterScratch, "sensitive audio");
    await service.clearLocalData();

    expect(existsSync(laterScratch)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    await service.dispose();
  });

  it("turns whisper-server launch errors into managed transcription failures", async () => {
    const paths = testPaths();
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    const missingRuntime = join(paths.tempDir, "missing-whisper-server");
    const service = new TranscriptionService(paths, fakeRuntimeService("available", missingRuntime));

    await expect(
      service.transcribe({
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: bundledWhisperCppProvider("ggml-tiny.en.bin")
      })
    ).rejects.toThrow(/failed to launch|ENOENT/);
    expect(service.getDiagnostics().join("\n")).toMatch(/launch error/i);
    await service.dispose();
  });

  it("uses whisper.cpp root static routing for identity and authenticated managed API paths", async () => {
    const paths = testPaths();
    const modelPath = join(paths.modelDir, "ggml-tiny.en.bin");
    const argsPath = join(paths.tempDir, "whisper-args.json");
    const requestPath = join(paths.tempDir, "whisper-request.txt");
    touch(modelPath);
    const runtimePath = whisperServerShim(tempRoot());
    const service = new TranscriptionService(
      paths,
      fakeRuntimeService("available", runtimePath, { MURMUR_ARGS_PATH: argsPath, MURMUR_REQUEST_PATH: requestPath })
    );

    const result = await service.transcribe({
      audio: wavWithSamples(160),
      mimeType: "audio/wav",
      provider: bundledWhisperCppProvider("ggml-tiny.en.bin")
    });

    const args = JSON.parse(readFileSync(argsPath, "utf8")) as string[];
    const configuredRequestPath = optionValue(args, "--request-path");
    const publicDir = optionValue(args, "--public");
    expect(result.text).toBe("managed transcript");
    expect(optionValue(args, "--tmp-dir")).toBe(paths.sttTempDir);
    expect(configuredRequestPath).toMatch(/^\/murmur-[0-9a-f-]+$/);
    expect(relative(paths.sttTempDir, publicDir).startsWith("..")).toBe(false);
    expect(readFileSync(requestPath, "utf8")).toBe(`${configuredRequestPath}/inference`);

    await service.dispose();
    expect(existsSync(publicDir)).toBe(false);
  });

  it("rejects a local endpoint that cannot answer the per-launch identity challenge", async () => {
    process.env.MURMUR_RUNTIME_READY_TIMEOUT_MS = "120";
    const paths = testPaths();
    touch(join(paths.modelDir, "ggml-tiny.en.bin"));
    const runtimePath = unauthenticatedWhisperServerShim(tempRoot());
    const service = new TranscriptionService(paths, fakeRuntimeService("available", runtimePath));

    await expect(
      service.transcribe({
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: bundledWhisperCppProvider("ggml-tiny.en.bin")
      })
    ).rejects.toThrow(/did not become ready/);
    await service.dispose();
  });

  it("requires a terminal event for completed-audio SSE", async () => {
    const { url } = await startSseServer([
      'data: {"type":"transcript.text.delta","delta":"partial"}\n\n'
    ]);
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    await expect(
      service.transcribe({
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: streamingProvider(url)
      })
    ).rejects.toThrow("ended before a terminal completion event");
    await service.dispose();
  });

  it("bounds accumulated streaming transcripts", async () => {
    const delta = "x".repeat(200000);
    const { url } = await startSseServer([
      `data: ${JSON.stringify({ type: "transcript.text.delta", delta })}\n\n`,
      `data: ${JSON.stringify({ type: "transcript.text.delta", delta })}\n\n`,
      `data: ${JSON.stringify({ type: "transcript.text.delta", delta })}\n\n`,
      "data: [DONE]\n\n"
    ]);
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    await expect(
      service.transcribe({
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: streamingProvider(url)
      })
    ).rejects.toThrow(`transcript exceeded ${providerTranscriptMaxChars} characters`);
    await service.dispose();
  });

  it("processes the terminal SSE event before generic delta extraction", async () => {
    const { url } = await startSseServer([
      'data: {"type":"transcript.text.delta","delta":"draft"}\n\n',
      'data: {"type":"transcript.text.done","text":"final transcript"}\n\n'
    ]);
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));
    const deltas: string[] = [];

    const result = await service.transcribe({
      audio: wavWithSamples(160),
      mimeType: "audio/wav",
      provider: streamingProvider(url),
      onDelta: (delta) => deltas.push(delta)
    });

    expect(result.text).toBe("final transcript");
    expect(deltas).toEqual(["draft"]);
    await service.dispose();
  });

  it("waits for a timed-out Sherpa child to terminate and escalates to SIGKILL", async () => {
    process.env.MURMUR_STT_PROCESS_TIMEOUT_MS = "800";
    process.env.MURMUR_STT_PROCESS_TERMINATION_GRACE_MS = "30";
    const paths = testPaths();
    const modelDir = join(paths.modelDir, "sherpa-test-model");
    const pidPath = join(paths.tempDir, "sherpa.pid");
    const readyPath = join(paths.tempDir, "sherpa.ready");
    const signalPath = join(paths.tempDir, "sherpa.sigterm");
    touch(join(modelDir, "tokens.txt"));
    touch(join(modelDir, "model.int8.onnx"));
    const runtimePath = stubbornProcessShim(tempRoot());
    const service = new TranscriptionService(
      paths,
      fakeRuntimeService("available", runtimePath, {
        MURMUR_PID_PATH: pidPath,
        MURMUR_READY_PATH: readyPath,
        MURMUR_SIGNAL_PATH: signalPath
      })
    );
    const transcription = service.transcribe({
      audio: wavWithSamples(160),
      mimeType: "audio/wav",
      provider: sherpaProvider("sherpa-test-model")
    });
    await waitForFile(readyPath);

    await expect(transcription).rejects.toThrow("Sherpa ONNX transcription failed");

    const pid = Number(readFileSync(pidPath, "utf8"));
    expect(existsSync(signalPath)).toBe(true);
    expectProcessMissing(pid);
    expect(readdirSync(paths.sttTempDir).filter((name) => name.startsWith("dictation-"))).toEqual([]);
    await service.dispose();
  });

  it("awaits active one-shot children during disposal", async () => {
    process.env.MURMUR_STT_PROCESS_TIMEOUT_MS = "5000";
    process.env.MURMUR_STT_PROCESS_TERMINATION_GRACE_MS = "30";
    const paths = testPaths();
    const modelDir = join(paths.modelDir, "sherpa-test-model");
    const pidPath = join(paths.tempDir, "dispose-sherpa.pid");
    const readyPath = join(paths.tempDir, "dispose-sherpa.ready");
    const signalPath = join(paths.tempDir, "dispose-sherpa.sigterm");
    touch(join(modelDir, "tokens.txt"));
    touch(join(modelDir, "model.int8.onnx"));
    const runtimePath = stubbornProcessShim(tempRoot());
    const service = new TranscriptionService(
      paths,
      fakeRuntimeService("available", runtimePath, {
        MURMUR_PID_PATH: pidPath,
        MURMUR_READY_PATH: readyPath,
        MURMUR_SIGNAL_PATH: signalPath
      })
    );
    const transcription = service.transcribe({
      audio: wavWithSamples(160),
      mimeType: "audio/wav",
      provider: sherpaProvider("sherpa-test-model")
    });
    await waitForFile(readyPath);

    await service.dispose();
    await expect(transcription).rejects.toThrow("Sherpa ONNX transcription failed");

    const pid = Number(readFileSync(pidPath, "utf8"));
    expect(existsSync(signalPath)).toBe(true);
    expectProcessMissing(pid);
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
        audio: wavWithSamples(160),
        mimeType: "audio/wav",
        provider: openAiCompatibleProvider(url)
      })
    ).rejects.toThrow(/STT transcription response body/);
    await service.dispose();
  });

  it("rejects empty WAV recordings before sending them to whisper.cpp", async () => {
    let requestCount = 0;
    const { url } = await startServer((response) => {
      requestCount += 1;
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Invalid request");
    });
    const service = new TranscriptionService(testPaths(), fakeRuntimeService("available"));

    await expect(
      service.transcribe({
        audio: wavWithSamples(0),
        mimeType: "audio/wav",
        provider: whisperCppProvider(url)
      })
    ).rejects.toThrow("Recording did not capture any audio");
    expect(requestCount).toBe(0);
    await service.dispose();
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

function bundledWhisperCppProvider(defaultModel: string): TranscriptionProviderConfig {
  return {
    id: "local-whisper-cpp",
    type: "whisper_cpp",
    name: "Bundled whisper.cpp",
    baseUrl: "murmur://runtime/whisper.cpp",
    endpointPath: "/inference",
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

function streamingProvider(baseUrl: string): TranscriptionProviderConfig {
  return {
    ...openAiCompatibleProvider(baseUrl),
    defaultModel: "gpt-4o-mini-transcribe",
    streamingMode: "completed_audio_sse"
  };
}

function whisperCppProvider(baseUrl: string): TranscriptionProviderConfig {
  return {
    id: "external-whisper-cpp",
    type: "whisper_cpp",
    name: "External whisper.cpp server",
    baseUrl,
    endpointPath: "/inference",
    isCloud: false,
    isLocal: true,
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: true
  };
}

function fakeRuntimeService(
  status: SttRuntimeAvailability["status"],
  binaryPath = "/tmp/runtime",
  runtimeEnv: NodeJS.ProcessEnv = {}
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
        env: { ...process.env, ...runtimeEnv }
      };
    },
    requireAutomaticRuntime(id: SttRuntimeId): ResolvedSttRuntime {
      return service.requireRuntime(id);
    }
  };
  return service as unknown as SttRuntimeService;
}

function sherpaResultShim(root: string): string {
  return executableShim(root, "sherpa-result.cjs", [
    'const fs = require("node:fs");',
    "fs.writeFileSync(process.env.MURMUR_ARGS_PATH, JSON.stringify(process.argv.slice(2)));",
    'process.stdout.write(JSON.stringify({ text: "shim transcript" }) + "\\n");'
  ]);
}

function stubbornProcessShim(root: string): string {
  return executableShim(root, "stubborn-process.cjs", [
    'const fs = require("node:fs");',
    "fs.writeFileSync(process.env.MURMUR_PID_PATH, String(process.pid));",
    'process.on("SIGTERM", () => fs.writeFileSync(process.env.MURMUR_SIGNAL_PATH, "SIGTERM"));',
    'fs.writeFileSync(process.env.MURMUR_READY_PATH, "ready");',
    "setInterval(() => {}, 1000);"
  ]);
}

function whisperServerShim(root: string): string {
  return executableShim(root, "whisper-server.cjs", [
    'const fs = require("node:fs");',
    'const http = require("node:http");',
    "const args = process.argv.slice(2);",
    "const value = (name) => args[args.indexOf(name) + 1];",
    'fs.writeFileSync(process.env.MURMUR_ARGS_PATH, JSON.stringify(args));',
    'const requestPath = value("--request-path");',
    'const challenge = fs.readFileSync(value("--public") + "/index.html", "utf8");',
    "const server = http.createServer((request, response) => {",
    '  if (request.url === "/") { response.end(challenge); return; }',
    '  if (request.url === requestPath + "/health") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ status: "ok" })); return; }',
    '  if (request.url === requestPath + "/inference") { request.resume(); request.on("end", () => { fs.writeFileSync(process.env.MURMUR_REQUEST_PATH, request.url); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ text: "managed transcript" })); }); return; }',
    "  response.statusCode = 404; response.end();",
    "});",
    'server.listen(Number(value("--port")), "127.0.0.1");',
    'process.on("SIGTERM", () => server.close(() => process.exit(0)));'
  ]);
}

function unauthenticatedWhisperServerShim(root: string): string {
  return executableShim(root, "unauthenticated-whisper-server.cjs", [
    'const http = require("node:http");',
    "const args = process.argv.slice(2);",
    "const value = (name) => args[args.indexOf(name) + 1];",
    'const server = http.createServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ status: "ok" })); });',
    'server.listen(Number(value("--port")), "127.0.0.1");',
    'process.on("SIGTERM", () => server.close(() => process.exit(0)));'
  ]);
}

function executableShim(root: string, name: string, lines: string[]): string {
  const path = join(root, name);
  writeFileSync(path, ["#!/usr/bin/env node", ...lines].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function optionValue(args: string[], option: string): string {
  const index = args.indexOf(option);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${option} in runtime arguments.`);
  return value;
}

function testPaths(): AppPaths {
  const root = tempRoot();
  return resolveAppPaths(
    fakeApp(root),
    {
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache")
    },
    { platform: "linux", uid: 1000 }
  );
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

function wavWithSamples(sampleCount: number): Uint8Array {
  const bytesPerSample = 2;
  const dataLength = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 16000 * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function restoreTestEnv(): void {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function startSseServer(chunks: string[]): Promise<{ url: string }> {
  return startServer((response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of chunks) response.write(chunk);
    response.end();
  });
}

function startServer(handler: (response: ServerResponse) => void): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const server = createServer((request, response) => {
      request.on("error", () => response.destroy());
      request.resume();
      handler(response);
    });
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

async function waitForFile(path: string): Promise<void> {
  const startedAt = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - startedAt > 2000) throw new Error(`Timed out waiting for ${path}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function expectProcessMissing(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrow();
}
