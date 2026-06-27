import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import type {
  ProviderValidationResult,
  SttRuntimeId,
  SttStreamingMode,
  TranscriptionProviderConfig,
  TranscriptionResult
} from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { ensureOwnerOnlyDirectory, ensureOwnerOnlyFile, ownerOnlyFileMode } from "./app-paths";
import { fetchWithTimeout, extractTextFromTranscriptionResponse, joinUrl, parseJsonOrText } from "./http";
import { SttRuntimeService, type ResolvedSttRuntime } from "./stt-runtime";

interface TranscribeOptions {
  audio: Uint8Array;
  mimeType: string;
  provider: TranscriptionProviderConfig;
  language?: string | "auto";
  vocabularyPrompt?: string;
  onDelta?: (delta: string) => void;
}

interface RuntimeProcessResult {
  stdout: string;
  stderr: string;
}

interface WhisperServerProcess {
  key: string;
  runtimeId: SttRuntimeId;
  baseUrl: string;
  process: ChildProcessWithoutNullStreams;
}

const bundledWhisperCppRuntimeUrl = "murmur://runtime/whisper.cpp";
const transcriptionTimeoutMs = 120000;
const whisperServerIdleShutdownMs = 10 * 60 * 1000;

export class TranscriptionService {
  private whisperServer: WhisperServerProcess | null = null;
  private whisperServerIdleTimer: NodeJS.Timeout | null = null;
  private lastRuntimeDiagnostics: string[] = [];

  constructor(
    private paths: AppPaths,
    private runtimeService = new SttRuntimeService()
  ) {}

  dispose(): void {
    this.stopWhisperServer();
  }

  stopRuntime(runtimeId?: SttRuntimeId): void {
    if (!runtimeId || runtimeId === "whisper.cpp") {
      this.stopWhisperServer();
    }
  }

  getDiagnostics(): string[] {
    return this.lastRuntimeDiagnostics;
  }

  async transcribe(options: TranscribeOptions): Promise<TranscriptionResult> {
    const { provider } = options;
    if (!provider.enabled) {
      throw new Error(`Transcription provider "${provider.name}" is disabled.`);
    }

    if (provider.type === "sherpa_onnx") {
      return this.transcribeSherpaOnnx(options);
    }

    if (provider.type === "whisper_cpp") {
      return this.isBundledWhisperCppProvider(provider) ? this.transcribeBundledWhisperCpp(options) : this.transcribeWhisperCpp(options);
    }

    return this.transcribeOpenAiCompatible(options);
  }

  async validate(provider: TranscriptionProviderConfig): Promise<ProviderValidationResult> {
    if (!provider.baseUrl) {
      return { ok: false, message: "Base URL is required." };
    }

    if (provider.isCloud && !provider.apiKey) {
      return { ok: false, message: "Cloud STT provider needs an API key before validation." };
    }

    try {
      new URL(provider.baseUrl);
    } catch {
      return { ok: false, message: "Base URL is not a valid URL." };
    }

    if (this.isBundledWhisperCppProvider(provider)) {
      return this.validateBundledRuntime(provider, "whisper.cpp");
    }

    if (provider.type === "sherpa_onnx") {
      return this.validateBundledRuntime(provider, "sherpa-onnx");
    }

    if (provider.type === "cloud_openai" || provider.type.includes("openai")) {
      const headers = this.authHeaders(provider);
      const response = await fetchWithTimeout(joinUrl(provider.baseUrl, "/models"), { headers }, 8000);
      if (response.status === 401) return { ok: false, message: "Authentication failed." };
      return {
        ok: response.ok || response.status < 500,
        message: response.ok ? "Provider reachable." : `Provider responded with HTTP ${response.status}.`,
        capabilities: {
          fileTranscription: true,
          completedAudioStreaming: provider.streamingMode === "completed_audio_sse",
          liveRealtimeStreaming: provider.streamingMode === "live_realtime",
          modelDiscovery: response.ok
        }
      };
    }

    const response = await fetchWithTimeout(provider.baseUrl, {}, 8000);
    return {
      ok: response.ok || response.status < 500,
      message: response.ok ? "Provider reachable." : `Provider responded with HTTP ${response.status}.`,
      capabilities: { fileTranscription: true, completedAudioStreaming: false, liveRealtimeStreaming: false }
    };
  }

  private validateBundledRuntime(provider: TranscriptionProviderConfig, runtimeId: "whisper.cpp" | "sherpa-onnx"): ProviderValidationResult {
    const runtime = this.runtimeService.getAvailability(runtimeId);
    if (runtime.status !== "available") return { ok: false, message: runtime.message };

    if (!provider.defaultModel) {
      return { ok: false, message: `${runtime.label} needs a downloaded model selected as default.` };
    }

    const modelPath = this.resolveModelPath(provider.defaultModel);
    if (!existsSync(modelPath)) {
      return { ok: false, message: `Model is not downloaded at ${modelPath}.` };
    }

    return {
      ok: true,
      message: `${runtime.label} runtime and model are available.`,
      capabilities: { fileTranscription: true, completedAudioStreaming: false, liveRealtimeStreaming: false, modelDiscovery: false }
    };
  }

  private async transcribeBundledWhisperCpp(options: TranscribeOptions): Promise<TranscriptionResult> {
    if (!options.mimeType.includes("wav")) {
      throw new Error("Bundled whisper.cpp expects WAV input. Restart recording so Murmur can capture WAV audio.");
    }

    const modelPath = this.requiredModelPath(options.provider.defaultModel, "Bundled whisper.cpp");
    const baseUrl = await this.ensureWhisperServer(modelPath);
    return this.transcribeWhisperCpp({
      ...options,
      provider: {
        ...options.provider,
        baseUrl,
        endpointPath: "/inference"
      }
    });
  }

  private async transcribeWhisperCpp(options: TranscribeOptions): Promise<TranscriptionResult> {
    const endpoint = joinUrl(options.provider.baseUrl, options.provider.endpointPath || "/inference");
    const form = new FormData();
    form.append("file", this.audioBlob(options), this.filename(options.mimeType));
    form.append("response_format", "json");
    if (options.language && options.language !== "auto") form.append("language", options.language);
    if (options.vocabularyPrompt) form.append("prompt", options.vocabularyPrompt);

    const response = await fetchWithTimeout(endpoint, { method: "POST", body: form }, transcriptionTimeoutMs);
    if (!response.ok) {
      throw new Error(`whisper.cpp transcription failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await parseJsonOrText(response);
    return {
      text: extractTextFromTranscriptionResponse(data),
      providerId: options.provider.id,
      model: options.provider.defaultModel,
      streamingMode: "none"
    };
  }

  private async transcribeSherpaOnnx(options: TranscribeOptions): Promise<TranscriptionResult> {
    if (!options.mimeType.includes("wav")) {
      throw new Error("Sherpa ONNX expects WAV input. Restart recording so Murmur can capture WAV audio.");
    }

    const runtime = this.runtimeService.requireRuntime("sherpa-onnx");
    const modelPath = this.requiredModelPath(options.provider.defaultModel, "Sherpa ONNX");
    const audioPath = this.writeTempAudio(options.audio, "wav");

    try {
      const result = await runProcess(runtime.binaryPath, buildSherpaArgs(modelPath, audioPath), transcriptionTimeoutMs, runtime);
      this.lastRuntimeDiagnostics = runtimeDiagnostics("Sherpa ONNX", result.stdout, result.stderr);
      const text = extractSherpaText(result.stdout) || extractSherpaText(result.stderr);
      return {
        text,
        providerId: options.provider.id,
        model: options.provider.defaultModel,
        streamingMode: "none"
      };
    } catch (error) {
      this.lastRuntimeDiagnostics = [`Sherpa ONNX error: ${tail(error instanceof Error ? error.message : String(error))}`];
      throw new Error("Sherpa ONNX transcription failed. Check runtime diagnostics for details.");
    } finally {
      rmSync(audioPath, { force: true });
    }
  }

  private async transcribeOpenAiCompatible(options: TranscribeOptions): Promise<TranscriptionResult> {
    const endpoint = joinUrl(options.provider.baseUrl, options.provider.endpointPath || "/audio/transcriptions");
    const form = new FormData();
    form.append("file", this.audioBlob(options), this.filename(options.mimeType));
    form.append("model", options.provider.defaultModel || "whisper-1");
    form.append("response_format", "json");
    if (options.language && options.language !== "auto") form.append("language", options.language);
    if (options.vocabularyPrompt) form.append("prompt", options.vocabularyPrompt);

    const streamingMode = this.effectiveStreamingMode(options.provider);
    if (streamingMode === "completed_audio_sse") {
      form.append("stream", "true");
    }

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: this.authHeaders(options.provider),
        body: form
      },
      transcriptionTimeoutMs
    );

    if (!response.ok) {
      throw new Error(`STT failed with HTTP ${response.status}: ${await response.text()}`);
    }

    if (streamingMode === "completed_audio_sse" && response.body) {
      const text = await this.readSseTranscript(response, options.onDelta);
      return {
        text,
        providerId: options.provider.id,
        model: options.provider.defaultModel,
        streamingMode
      };
    }

    const data = await parseJsonOrText(response);
    return {
      text: extractTextFromTranscriptionResponse(data),
      providerId: options.provider.id,
      model: options.provider.defaultModel,
      streamingMode: "none"
    };
  }

  private async ensureWhisperServer(modelPath: string): Promise<string> {
    const runtime = this.runtimeService.requireRuntime("whisper.cpp");
    const key = [runtime.id, runtime.platformKey, runtime.source, runtime.rootDir, runtime.version, modelPath].join("|");
    const existing = this.whisperServer;
    if (existing?.key === key && existing.process.exitCode === null && !existing.process.killed) {
      this.scheduleWhisperServerIdleShutdown();
      return existing.baseUrl;
    }

    this.stopWhisperServer();
    const port = await findOpenPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const args = buildWhisperServerArgs(port, modelPath);
    const child = spawn(runtime.binaryPath, args, { stdio: ["pipe", "pipe", "pipe"], env: runtime.env, cwd: runtime.cwd });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      this.lastRuntimeDiagnostics = runtimeDiagnostics("whisper.cpp", output, "");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      this.lastRuntimeDiagnostics = runtimeDiagnostics("whisper.cpp", "", output);
    });
    child.on("close", () => {
      if (this.whisperServer?.process === child) this.whisperServer = null;
    });

    this.whisperServer = { key, runtimeId: "whisper.cpp", baseUrl, process: child };
    await waitForHttp(baseUrl, child, () => {
      this.lastRuntimeDiagnostics = runtimeDiagnostics("whisper.cpp", output, output);
      return output;
    });
    this.scheduleWhisperServerIdleShutdown();
    return baseUrl;
  }

  private stopWhisperServer(): void {
    if (this.whisperServerIdleTimer) {
      clearTimeout(this.whisperServerIdleTimer);
      this.whisperServerIdleTimer = null;
    }
    const existing = this.whisperServer;
    this.whisperServer = null;
    if (existing && existing.process.exitCode === null && !existing.process.killed) {
      existing.process.kill();
    }
  }

  private scheduleWhisperServerIdleShutdown(): void {
    if (this.whisperServerIdleTimer) clearTimeout(this.whisperServerIdleTimer);
    this.whisperServerIdleTimer = setTimeout(() => this.stopWhisperServer(), whisperServerIdleShutdownMs);
    this.whisperServerIdleTimer.unref();
  }

  private requiredModelPath(model: string | undefined, label: string): string {
    if (!model) throw new Error(`${label} needs a downloaded model selected as default.`);
    const modelPath = this.resolveModelPath(model);
    if (!existsSync(modelPath)) throw new Error(`${label} model is not downloaded at ${modelPath}.`);
    return modelPath;
  }

  private resolveModelPath(model: string): string {
    return isAbsolute(model) ? model : join(this.paths.modelDir, model);
  }

  private writeTempAudio(audio: Uint8Array, extension: string): string {
    ensureOwnerOnlyDirectory(this.paths.tempDir);
    const path = join(this.paths.tempDir, `dictation-${Date.now()}-${randomUUID()}.${extension}`);
    writeFileSync(path, audio, { mode: ownerOnlyFileMode });
    ensureOwnerOnlyFile(path);
    return path;
  }

  private isBundledWhisperCppProvider(provider: TranscriptionProviderConfig): boolean {
    return provider.type === "whisper_cpp" && provider.baseUrl === bundledWhisperCppRuntimeUrl;
  }

  private effectiveStreamingMode(provider: TranscriptionProviderConfig): SttStreamingMode {
    if (provider.defaultModel === "whisper-1") return "none";
    return provider.streamingMode;
  }

  private async readSseTranscript(response: Response, onDelta?: (delta: string) => void): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";

    const decoder = new TextDecoder();
    let buffer = "";
    let transcript = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLines = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim());

        for (const dataLine of dataLines) {
          if (!dataLine || dataLine === "[DONE]") continue;
          try {
            const data = JSON.parse(dataLine);
            const delta = data.delta ?? data.text ?? "";
            if (typeof delta === "string" && delta) {
              transcript += delta;
              onDelta?.(delta);
            }
            if (data.type === "transcript.text.done" && typeof data.text === "string") {
              transcript = data.text;
            }
          } catch {
            transcript += dataLine;
            onDelta?.(dataLine);
          }
        }
      }
    }

    return transcript.trim();
  }

  private authHeaders(provider: TranscriptionProviderConfig): HeadersInit {
    return provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
  }

  private audioBlob(options: TranscribeOptions): Blob {
    return new Blob([options.audio.slice()], { type: options.mimeType || "audio/wav" });
  }

  private filename(mimeType: string): string {
    if (mimeType.includes("wav")) return "dictation.wav";
    if (mimeType.includes("ogg")) return "dictation.ogg";
    if (mimeType.includes("mp4")) return "dictation.m4a";
    return "dictation.webm";
  }
}

export function buildSherpaArgs(modelPath: string, audioPath: string, threadCount = process.env.MURMUR_STT_THREADS || "4"): string[] {
  const tokensPath = join(modelPath, "tokens.txt");
  if (!existsSync(tokensPath)) {
    throw new Error(`Sherpa ONNX model is missing tokens.txt in ${modelPath}.`);
  }

  const ctcModel = firstExisting([join(modelPath, "model.int8.onnx"), join(modelPath, "model.onnx")]);
  if (ctcModel) {
    return [
      `--nemo-ctc-model=${ctcModel}`,
      `--tokens=${tokensPath}`,
      `--num-threads=${threadCount}`,
      "--decoding-method=greedy_search",
      "--debug=false",
      audioPath
    ];
  }

  const encoder = firstExisting([join(modelPath, "encoder.int8.onnx"), join(modelPath, "encoder.onnx")]);
  const decoder = firstExisting([join(modelPath, "decoder.int8.onnx"), join(modelPath, "decoder.onnx")]);
  const joiner = firstExisting([join(modelPath, "joiner.int8.onnx"), join(modelPath, "joiner.onnx")]);
  if (encoder && decoder && joiner) {
    return [
      `--encoder=${encoder}`,
      `--decoder=${decoder}`,
      `--joiner=${joiner}`,
      `--tokens=${tokensPath}`,
      "--model-type=nemo_transducer",
      `--num-threads=${threadCount}`,
      "--decoding-method=greedy_search",
      "--debug=false",
      audioPath
    ];
  }

  throw new Error(`Sherpa ONNX model directory is missing supported ONNX files: ${modelPath}`);
}

export function buildWhisperServerArgs(port: number, modelPath: string, threadCount = process.env.MURMUR_STT_THREADS || "4"): string[] {
  return [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--model",
    modelPath,
    "--inference-path",
    "/inference",
    "--threads",
    threadCount
  ];
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  runtime?: Pick<ResolvedSttRuntime, "env" | "cwd">
): Promise<RuntimeProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: runtime?.env, cwd: runtime?.cwd });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

function extractSherpaText(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of [...lines].reverse()) {
    try {
      const data = JSON.parse(line) as { text?: unknown };
      if (typeof data.text === "string") return data.text.trim();
    } catch {
      // Sherpa logs config lines before the JSON result.
    }
  }

  for (const match of output.matchAll(/"text"\s*:\s*"((?:\\.|[^"])*)"/g)) {
    try {
      return JSON.parse(`"${match[1]}"`).trim();
    } catch {
      return match[1].trim();
    }
  }

  return "";
}

function firstExisting(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolve(address.port);
        else reject(new Error("Could not allocate a local port."));
      });
    });
  });
}

async function waitForHttp(baseUrl: string, child: ChildProcessWithoutNullStreams, output: () => string): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = runtimeReadyTimeoutMs();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      output();
      throw new Error("whisper-server exited before becoming ready. Check runtime diagnostics for details.");
    }
    try {
      await fetchWithTimeout(baseUrl, {}, 500);
      return;
    } catch {
      await delay(150);
    }
  }

  child.kill();
  output();
  throw new Error(`whisper-server did not become ready within ${timeoutMs}ms. Check runtime diagnostics for details.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runtimeReadyTimeoutMs(): number {
  const value = Number(process.env.MURMUR_RUNTIME_READY_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 45000;
}

function runtimeDiagnostics(label: string, stdout: string, stderr: string): string[] {
  return [
    stdout.trim() ? `${label} stdout: ${tail(stdout)}` : "",
    stderr.trim() ? `${label} stderr: ${tail(stderr)}` : ""
  ].filter(Boolean);
}

function tail(value: string): string {
  return value.trim().slice(-2000);
}
