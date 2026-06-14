import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import type {
  ProviderValidationResult,
  SttStreamingMode,
  TranscriptionProviderConfig,
  TranscriptionResult
} from "../../shared/types";
import { fetchWithTimeout, extractTextFromTranscriptionResponse, joinUrl, parseJsonOrText } from "./http";

interface TranscribeOptions {
  audio: Uint8Array;
  mimeType: string;
  provider: TranscriptionProviderConfig;
  language?: string | "auto";
  vocabularyPrompt?: string;
  localOnly: boolean;
  onDelta?: (delta: string) => void;
}

interface RuntimeProcessResult {
  stdout: string;
  stderr: string;
}

interface WhisperServerProcess {
  key: string;
  baseUrl: string;
  process: ChildProcessWithoutNullStreams;
}

const bundledWhisperCppRuntimeUrl = "murmur://runtime/whisper.cpp";
const runtimeReadyTimeoutMs = 10000;
const transcriptionTimeoutMs = 120000;

export class TranscriptionService {
  private whisperServer: WhisperServerProcess | null = null;

  constructor(private userDataPath: string) {}

  dispose(): void {
    this.stopWhisperServer();
  }

  async transcribe(options: TranscribeOptions): Promise<TranscriptionResult> {
    const { provider, localOnly } = options;
    if (localOnly && provider.isCloud) {
      throw new Error(`Local-only mode blocks cloud STT provider "${provider.name}".`);
    }
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
      return this.validateBundledRuntime(provider, "MURMUR_WHISPER_CPP_SERVER", "whisper.cpp", "whisper.cpp", "whisper-server");
    }

    if (provider.type === "sherpa_onnx") {
      return this.validateBundledRuntime(provider, "MURMUR_SHERPA_ONNX_OFFLINE", "sherpa-onnx", "Sherpa ONNX", "sherpa-onnx-offline");
    }

    if (provider.type === "cloud_openai" || provider.type === "cloud_groq" || provider.type.includes("openai")) {
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

  private validateBundledRuntime(
    provider: TranscriptionProviderConfig,
    envName: string,
    runtimeDir: string,
    label: string,
    executable: string
  ): ProviderValidationResult {
    const binary = this.resolveRuntimeBinary(envName, runtimeDir, executable);
    if (!binary) {
      return {
        ok: false,
        message: `${label} runtime binary was not found. Set ${envName} or install it under vendor/runtimes/${this.runtimeKey()}/${runtimeDir}.`
      };
    }

    if (!provider.defaultModel) {
      return { ok: false, message: `${label} needs a downloaded model selected as default.` };
    }

    const modelPath = this.resolveModelPath(provider.defaultModel);
    if (!existsSync(modelPath)) {
      return { ok: false, message: `Model is not downloaded at ${modelPath}.` };
    }

    return {
      ok: true,
      message: `${label} runtime and model are available.`,
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

    const binary = this.requiredRuntimeBinary("MURMUR_SHERPA_ONNX_OFFLINE", "sherpa-onnx", "sherpa-onnx-offline");
    const modelPath = this.requiredModelPath(options.provider.defaultModel, "Sherpa ONNX");
    const audioPath = this.writeTempAudio(options.audio, "wav");

    try {
      const result = await runProcess(binary, this.sherpaArgs(modelPath, audioPath), transcriptionTimeoutMs);
      const text = extractSherpaText(result.stdout) || extractSherpaText(result.stderr);
      return {
        text,
        providerId: options.provider.id,
        model: options.provider.defaultModel,
        streamingMode: "none"
      };
    } finally {
      rmSync(audioPath, { force: true });
    }
  }

  private sherpaArgs(modelPath: string, audioPath: string): string[] {
    const tokensPath = join(modelPath, "tokens.txt");
    const threadCount = process.env.MURMUR_STT_THREADS || "4";
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
        audioPath
      ];
    }

    throw new Error(`Sherpa ONNX model directory is missing supported ONNX files: ${modelPath}`);
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
    const existing = this.whisperServer;
    if (existing?.key === modelPath && existing.process.exitCode === null && !existing.process.killed) {
      return existing.baseUrl;
    }

    this.stopWhisperServer();
    const binary = this.requiredRuntimeBinary("MURMUR_WHISPER_CPP_SERVER", "whisper.cpp", "whisper-server");
    const port = await findOpenPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const args = ["--host", "127.0.0.1", "--port", String(port), "--model", modelPath, "--inference-path", "/inference"];
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", () => {
      if (this.whisperServer?.process === child) this.whisperServer = null;
    });

    this.whisperServer = { key: modelPath, baseUrl, process: child };
    await waitForHttp(baseUrl, child, () => output);
    return baseUrl;
  }

  private stopWhisperServer(): void {
    const existing = this.whisperServer;
    this.whisperServer = null;
    if (existing && existing.process.exitCode === null && !existing.process.killed) {
      existing.process.kill();
    }
  }

  private requiredRuntimeBinary(envName: string, runtimeDir: string, executable: string): string {
    const binary = this.resolveRuntimeBinary(envName, runtimeDir, executable);
    if (!binary) {
      throw new Error(`Runtime binary "${executable}" was not found. Set ${envName} or install it under vendor/runtimes/${this.runtimeKey()}/${runtimeDir}.`);
    }
    return binary;
  }

  private resolveRuntimeBinary(envName: string, runtimeDir: string, executable: string): string | null {
    const executableName = process.platform === "win32" ? `${executable}.exe` : executable;
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      process.env[envName],
      resourcesPath ? join(resourcesPath, "runtimes", this.runtimeKey(), runtimeDir, executableName) : undefined,
      join(process.cwd(), "vendor", "runtimes", this.runtimeKey(), runtimeDir, executableName),
      join(process.cwd(), "vendor", "runtimes", runtimeDir, executableName)
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  private runtimeKey(): string {
    return `${process.platform}-${process.arch}`;
  }

  private requiredModelPath(model: string | undefined, label: string): string {
    if (!model) throw new Error(`${label} needs a downloaded model selected as default.`);
    const modelPath = this.resolveModelPath(model);
    if (!existsSync(modelPath)) throw new Error(`${label} model is not downloaded at ${modelPath}.`);
    return modelPath;
  }

  private resolveModelPath(model: string): string {
    return isAbsolute(model) ? model : join(this.userDataPath, "models", "stt", model);
  }

  private writeTempAudio(audio: Uint8Array, extension: string): string {
    const dir = join(this.userDataPath, "tmp");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `dictation-${Date.now()}-${randomUUID()}.${extension}`);
    writeFileSync(path, audio);
    return path;
  }

  private isBundledWhisperCppProvider(provider: TranscriptionProviderConfig): boolean {
    return provider.type === "whisper_cpp" && provider.baseUrl === bundledWhisperCppRuntimeUrl;
  }

  private effectiveStreamingMode(provider: TranscriptionProviderConfig): SttStreamingMode {
    if (provider.type === "cloud_groq") return "none";
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

function runProcess(command: string, args: string[], timeoutMs: number): Promise<RuntimeProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
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
  while (Date.now() - startedAt < runtimeReadyTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`whisper-server exited before becoming ready: ${output().trim()}`);
    }
    try {
      await fetchWithTimeout(baseUrl, {}, 500);
      return;
    } catch {
      await delay(150);
    }
  }

  child.kill();
  throw new Error(`whisper-server did not become ready within ${runtimeReadyTimeoutMs}ms: ${output().trim()}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
