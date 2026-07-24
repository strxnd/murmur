import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import type {
  ProviderValidationResult,
  SttRuntimeAccelerator,
  SttRuntimeId,
  SttStreamingMode,
  TranscriptionProviderConfig,
  TranscriptionResult
} from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { ensureOwnerOnlyDirectory, ensureOwnerOnlyFile, ownerOnlyFileMode } from "./app-paths";
import { ArtifactMutationCoordinator } from "./artifact-mutation-coordinator";
import {
  closeResponseBody,
  extractTextFromTranscriptionResponse,
  fetchWithTimeout,
  joinUrl,
  parseJsonOrText,
  providerSsePendingMaxChars,
  providerSuccessBodyMaxBytes,
  providerTranscriptMaxChars,
  providerValidationBodyMaxBytes,
  readResponseBody,
  readResponseText,
  requireTranscriptText
} from "./http";
import { SttRuntimeService, type ResolvedSttRuntime } from "./stt-runtime";

interface TranscribeOptions {
  audio: Uint8Array;
  mimeType: string;
  provider: TranscriptionProviderConfig;
  language?: string | "auto";
  vocabularyPrompt?: string;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

interface RuntimeProcessResult {
  stdout: string;
  stderr: string;
}

interface WhisperServerProcess {
  key: string;
  runtimeId: SttRuntimeId;
  variantKey: string;
  accelerator: SttRuntimeAccelerator;
  modelPath: string;
  baseUrl: string;
  requestPath: string;
  scratchDir: string;
  process: ChildProcessWithoutNullStreams;
}

interface OwnedChildProcess {
  child: ChildProcessWithoutNullStreams;
  closed: Promise<void>;
}

interface RuntimeProcessFailure {
  error: Error;
}

const bundledWhisperCppRuntimeUrl = "murmur://runtime/whisper.cpp";
const transcriptionTimeoutMs = 120000;
const transcriptionIdleTimeoutMs = 30000;
const whisperServerIdleShutdownMs = 10 * 60 * 1000;
const defaultProcessTerminationGraceMs = 1000;
const maxRuntimeDiagnosticsChars = 16000;
const scratchPathPattern = /^(?:dictation-.+\.wav|whisper-server-.+)$/;

export class TranscriptionService {
  private whisperServer: WhisperServerProcess | null = null;
  private whisperServerIdleTimer: NodeJS.Timeout | null = null;
  private lastRuntimeDiagnostics: string[] = [];
  private ownedChildren = new Map<ChildProcessWithoutNullStreams, OwnedChildProcess>();
  private scratchFiles = new Set<string>();
  private artifactMutations = new ArtifactMutationCoordinator();
  private disposed = false;

  constructor(
    private paths: AppPaths,
    private runtimeService = new SttRuntimeService()
  ) {
    this.prepareScratchDirectory();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stopWhisperServer();
    await Promise.all([...this.ownedChildren.values()].map(({ child }) => this.terminateChild(child)));
    this.clearScratchFiles();
  }

  async clearLocalData(): Promise<void> {
    await this.stopWhisperServer();
    await Promise.all([...this.ownedChildren.values()].map(({ child }) => this.terminateChild(child)));
    this.clearScratchFiles();
  }

  async stopRuntime(runtimeId?: SttRuntimeId): Promise<void> {
    if (!runtimeId || runtimeId === "whisper.cpp") {
      await this.stopWhisperServer();
    }
  }

  async beginRuntimeMutation(variantKey: string, signal?: AbortSignal): Promise<() => void> {
    const finishMutation = await this.artifactMutations.beginMutation(runtimeResourceKey(variantKey), signal);
    try {
      await this.stopWhisperServer((server) => server.variantKey === variantKey);
      return finishMutation;
    } catch (error) {
      finishMutation();
      throw error;
    }
  }

  async beginModelMutation(modelPath: string, signal?: AbortSignal): Promise<() => void> {
    const finishMutation = await this.artifactMutations.beginMutation(modelResourceKey(modelPath), signal);
    try {
      await this.stopWhisperServer((server) => server.modelPath === modelPath);
      return finishMutation;
    } catch (error) {
      finishMutation();
      throw error;
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
    assertWavAudioHasSamples(options.audio, options.mimeType);

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

    try {
      if (provider.type === "cloud_openai" || provider.type.includes("openai")) {
        const headers = this.authHeaders(provider);
        const response = await fetchWithTimeout(joinUrl(provider.baseUrl, "/models"), { headers }, 8000);
        if (!response.ok) {
          await closeResponseBody(response);
          return {
            ok: false,
            message: response.status === 401 || response.status === 403
              ? "Authentication failed."
              : `Provider validation failed with HTTP ${response.status}.`
          };
        }
        const data = await parseJsonOrText(response, {
          totalTimeoutMs: 8000,
          idleTimeoutMs: 8000,
          maxBytes: providerValidationBodyMaxBytes,
          label: "STT provider validation"
        });
        if (!isRecord(data) || !Array.isArray(data.data)) {
          return { ok: false, message: "Provider returned an unexpected validation response." };
        }
        return {
          ok: true,
          message: "Provider reachable.",
          capabilities: {
            fileTranscription: true,
            completedAudioStreaming: provider.streamingMode === "completed_audio_sse",
            liveRealtimeStreaming: provider.streamingMode === "live_realtime",
            modelDiscovery: true
          }
        };
      }

      const response = await fetchWithTimeout(provider.baseUrl, {}, 8000);
      await closeResponseBody(response);
      return {
        ok: response.ok,
        message: response.ok ? "Provider reachable." : `Provider validation failed with HTTP ${response.status}.`,
        capabilities: { fileTranscription: true, completedAudioStreaming: false, liveRealtimeStreaming: false }
      };
    } catch (error) {
      return { ok: false, message: `Provider connection failed: ${errorMessage(error)}` };
    }
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

    const modelPath = this.resolveConfiguredModelPath(options.provider.defaultModel, "Bundled whisper.cpp");
    return this.withRuntimeFallback("whisper.cpp", async (runtime) =>
      this.artifactMutations.withUse(
        [modelResourceKey(modelPath), runtimeResourceKey(runtime.variantKey)],
        options.signal,
        async () => {
          this.requireExistingModelPath(modelPath, "Bundled whisper.cpp");
          const endpoint = await this.ensureWhisperServer(modelPath, runtime, options.signal);
          const result = await this.transcribeWhisperCpp({
            ...options,
            provider: {
              ...options.provider,
              baseUrl: endpoint.baseUrl,
              endpointPath: `${endpoint.requestPath}/inference`
            }
          });
          return { ...result, accelerator: runtime.accelerator };
        }
      )
    );
  }

  private async transcribeWhisperCpp(options: TranscribeOptions): Promise<TranscriptionResult> {
    const endpoint = joinUrl(options.provider.baseUrl, options.provider.endpointPath || "/inference");
    const form = new FormData();
    form.append("file", this.audioBlob(options), this.filename(options.mimeType));
    form.append("response_format", "json");
    if (options.language && options.language !== "auto") form.append("language", options.language);
    if (options.vocabularyPrompt) form.append("prompt", options.vocabularyPrompt);

    const timeouts = transcriptionHttpTimeouts();
    const response = await fetchWithTimeout(endpoint, { method: "POST", body: form, signal: options.signal }, timeouts.totalTimeoutMs);
    if (!response.ok) {
      await closeResponseBody(response);
      throw providerHttpError("whisper.cpp transcription", response);
    }

    const data = await parseJsonOrText(response, {
      ...timeouts,
      maxBytes: providerSuccessBodyMaxBytes,
      label: "whisper.cpp transcription",
      signal: options.signal
    });
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

    const modelPath = this.resolveConfiguredModelPath(options.provider.defaultModel, "Sherpa ONNX");
    const audioPath = this.writeTempAudio(options.audio, "wav");

    try {
      return await this.withRuntimeFallback("sherpa-onnx", async (runtime) =>
        this.artifactMutations.withUse(
          [modelResourceKey(modelPath), runtimeResourceKey(runtime.variantKey)],
          options.signal,
          async () => {
            this.requireExistingModelPath(modelPath, "Sherpa ONNX");
            const result = await this.runProcess(
              runtime.binaryPath,
              buildSherpaArgs(modelPath, audioPath, undefined, runtime.accelerator),
              transcriptionRuntimeTimeoutMs(),
              runtime,
              options.signal
            );
            this.lastRuntimeDiagnostics = runtimeDiagnostics(runtime.label, result.stdout, result.stderr);
            const text = extractSherpaText(result.stdout) || extractSherpaText(result.stderr);
            return {
              text,
              providerId: options.provider.id,
              model: options.provider.defaultModel,
              streamingMode: "none",
              accelerator: runtime.accelerator
            };
          }
        )
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.lastRuntimeDiagnostics = [`Sherpa ONNX error: ${tail(error instanceof Error ? error.message : String(error))}`];
      throw new Error("Sherpa ONNX transcription failed. Check runtime diagnostics for details.");
    } finally {
      rmSync(audioPath, { force: true });
      this.scratchFiles.delete(audioPath);
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

    const timeouts = transcriptionHttpTimeouts();
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: this.authHeaders(options.provider),
        body: form,
        signal: options.signal
      },
      timeouts.totalTimeoutMs
    );

    if (!response.ok) {
      await closeResponseBody(response);
      throw providerHttpError("STT", response);
    }

    if (streamingMode === "completed_audio_sse" && response.body) {
      const text = await this.readSseTranscript(response, options.onDelta, timeouts, options.signal);
      return {
        text,
        providerId: options.provider.id,
        model: options.provider.defaultModel,
        streamingMode
      };
    }

    const data = await parseJsonOrText(response, {
      ...timeouts,
      maxBytes: providerSuccessBodyMaxBytes,
      label: "STT transcription",
      signal: options.signal
    });
    return {
      text: extractTextFromTranscriptionResponse(data),
      providerId: options.provider.id,
      model: options.provider.defaultModel,
      streamingMode: "none"
    };
  }

  private async withRuntimeFallback(
    runtimeId: SttRuntimeId,
    attempt: (runtime: ResolvedSttRuntime) => Promise<TranscriptionResult>
  ): Promise<TranscriptionResult> {
    const primary = this.runtimeService.requireAutomaticRuntime(runtimeId);
    try {
      return await attempt(primary);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const primaryMessage = errorMessage(error);
      if (primary.accelerator === "cpu") {
        throw error;
      }

      await this.stopRuntime(runtimeId);
      this.lastRuntimeDiagnostics = [
        `${primary.label} failed; retrying ${primary.id} CPU once because automatic acceleration failed.`,
        primaryMessage,
        ...this.lastRuntimeDiagnostics
      ].map((line) => tail(line, maxRuntimeDiagnosticsChars));

      const cpu = this.runtimeService.requireRuntime(runtimeId, "cpu");
      try {
        return await attempt(cpu);
      } catch (cpuError) {
        throw new Error(
          `${primary.label} failed and the CPU retry also failed. GPU error: ${primaryMessage}. CPU error: ${errorMessage(cpuError)}`
        );
      }
    }
  }

  private async ensureWhisperServer(
    modelPath: string,
    runtime: ResolvedSttRuntime,
    signal?: AbortSignal
  ): Promise<Pick<WhisperServerProcess, "baseUrl" | "requestPath">> {
    if (this.disposed) throw new Error("Transcription service is disposed.");
    const key = [runtime.variantKey, runtime.source, runtime.rootDir, runtime.version, modelPath].join("|");
    const existing = this.whisperServer;
    if (existing?.key === key && existing.process.exitCode === null && !existing.process.killed) {
      this.scheduleWhisperServerIdleShutdown();
      return { baseUrl: existing.baseUrl, requestPath: existing.requestPath };
    }

    await this.stopWhisperServer();
    throwIfAborted(signal);
    const port = await findOpenPort();
    throwIfAborted(signal);
    const baseUrl = `http://127.0.0.1:${port}`;
    const requestPath = `/murmur-${randomUUID()}`;
    const challenge = randomUUID();
    const scratchDir = join(this.paths.sttTempDir, `whisper-server-${randomUUID()}`);
    ensureOwnerOnlyDirectory(scratchDir);
    const challengePath = join(scratchDir, "index.html");
    writeFileSync(challengePath, challenge, { mode: ownerOnlyFileMode });
    ensureOwnerOnlyFile(challengePath);
    this.scratchFiles.add(scratchDir);
    const args = buildWhisperServerArgs(
      port,
      modelPath,
      this.paths.sttTempDir,
      requestPath,
      scratchDir,
      undefined,
      runtime.accelerator,
      runtime.env.MURMUR_STT_GPU_DEVICE
    );
    const child = spawn(runtime.binaryPath, args, { stdio: ["pipe", "pipe", "pipe"], env: runtime.env, cwd: runtime.cwd });
    this.ownChild(child);
    const stdout = new BoundedTextBuffer(maxRuntimeDiagnosticsChars);
    const stderr = new BoundedTextBuffer(maxRuntimeDiagnosticsChars);
    let launchError: Error | null = null;

    child.on("error", (error) => {
      launchError = error;
      this.lastRuntimeDiagnostics = [`${runtime.label} launch error: ${tail(error.message)}`];
      if (this.whisperServer?.process === child) this.whisperServer = null;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.append(chunk.toString());
      this.lastRuntimeDiagnostics = runtimeDiagnostics(runtime.label, stdout.text(), stderr.text());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.append(chunk.toString());
      this.lastRuntimeDiagnostics = runtimeDiagnostics(runtime.label, stdout.text(), stderr.text());
    });
    child.on("close", () => {
      if (this.whisperServer?.process === child) this.whisperServer = null;
      this.removeScratchPath(scratchDir);
    });

    this.whisperServer = {
      key,
      runtimeId: "whisper.cpp",
      variantKey: runtime.variantKey,
      accelerator: runtime.accelerator,
      modelPath,
      baseUrl,
      requestPath,
      scratchDir,
      process: child
    };
    try {
      await waitForWhisperServer(
        baseUrl,
        requestPath,
        challenge,
        child,
        () => launchError,
        () => {
          const diagnostics = runtimeDiagnostics(runtime.label, stdout.text(), stderr.text());
          if (diagnostics.length > 0) this.lastRuntimeDiagnostics = diagnostics;
        },
        signal
      );
    } catch (error) {
      if (this.whisperServer?.process === child) this.whisperServer = null;
      await this.terminateChild(child);
      throw error;
    }
    this.scheduleWhisperServerIdleShutdown();
    return { baseUrl, requestPath };
  }

  private async stopWhisperServer(matches: (server: WhisperServerProcess) => boolean = () => true): Promise<void> {
    const existing = this.whisperServer;
    if (!existing || !matches(existing)) return;
    if (this.whisperServerIdleTimer) {
      clearTimeout(this.whisperServerIdleTimer);
      this.whisperServerIdleTimer = null;
    }
    this.whisperServer = null;
    await this.terminateChild(existing.process);
  }

  private scheduleWhisperServerIdleShutdown(): void {
    if (this.whisperServerIdleTimer) clearTimeout(this.whisperServerIdleTimer);
    this.whisperServerIdleTimer = setTimeout(() => void this.stopWhisperServer(), whisperServerIdleShutdownMs);
    this.whisperServerIdleTimer.unref();
  }

  private resolveConfiguredModelPath(model: string | undefined, label: string): string {
    if (!model) throw new Error(`${label} needs a downloaded model selected as default.`);
    return this.resolveModelPath(model);
  }

  private requireExistingModelPath(modelPath: string, label: string): void {
    if (!existsSync(modelPath)) throw new Error(`${label} model is not downloaded at ${modelPath}.`);
  }

  private resolveModelPath(model: string): string {
    return isAbsolute(model) ? model : join(this.paths.modelDir, model);
  }

  private writeTempAudio(audio: Uint8Array, extension: string): string {
    ensureOwnerOnlyDirectory(this.paths.sttTempDir);
    const path = join(this.paths.sttTempDir, `dictation-${Date.now()}-${randomUUID()}.${extension}`);
    writeFileSync(path, audio, { mode: ownerOnlyFileMode });
    ensureOwnerOnlyFile(path);
    this.scratchFiles.add(path);
    return path;
  }

  private prepareScratchDirectory(): void {
    ensureOwnerOnlyDirectory(this.paths.sttTempDir);
    this.clearScratchFiles();
  }

  private clearScratchFiles(): void {
    ensureOwnerOnlyDirectory(this.paths.sttTempDir);
    for (const entry of readdirSync(this.paths.sttTempDir, { withFileTypes: true })) {
      if (scratchPathPattern.test(entry.name)) {
        rmSync(join(this.paths.sttTempDir, entry.name), { recursive: true, force: true });
      }
    }
    for (const path of this.scratchFiles) rmSync(path, { recursive: true, force: true });
    this.scratchFiles.clear();
  }

  private removeScratchPath(path: string): void {
    rmSync(path, { recursive: true, force: true });
    this.scratchFiles.delete(path);
  }

  private runProcess(
    command: string,
    args: string[],
    timeoutMs: number,
    runtime?: Pick<ResolvedSttRuntime, "env" | "cwd">,
    signal?: AbortSignal
  ): Promise<RuntimeProcessResult> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      if (this.disposed) {
        reject(new Error("Transcription service is disposed."));
        return;
      }

      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: runtime?.env, cwd: runtime?.cwd });
      this.ownChild(child);
      let stdout = "";
      let stderr = "";
      let failure: RuntimeProcessFailure | null = null;
      let settled = false;
      const finish = (error?: Error, result?: RuntimeProcessResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(result!);
      };
      const terminateWith = (error: Error): void => {
        if (failure) return;
        failure = { error };
        void this.terminateChild(child);
      };
      const onAbort = (): void => terminateWith(abortError());
      const timeout = setTimeout(() => terminateWith(new Error(`${command} timed out after ${timeoutMs}ms.`)), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        failure = { error };
      });
      child.on("close", (code) => {
        if (failure) {
          finish(failure.error);
          return;
        }
        if (code === 0) {
          finish(undefined, { stdout, stderr });
          return;
        }
        finish(new Error(`${command} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`));
      });
    });
  }

  private ownChild(child: ChildProcessWithoutNullStreams): OwnedChildProcess {
    const existing = this.ownedChildren.get(child);
    if (existing) return existing;

    let resolveClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const owned = { child, closed };
    this.ownedChildren.set(child, owned);
    child.on("error", () => {
      // Every owned child has a listener before the event loop can deliver spawn errors.
    });
    child.once("close", () => {
      this.ownedChildren.delete(child);
      resolveClosed();
    });
    return owned;
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    const owned = this.ownedChildren.get(child);
    if (!owned) return;
    if (child.exitCode !== null) {
      await owned.closed;
      return;
    }

    child.kill("SIGTERM");
    if (await closesWithin(owned.closed, processTerminationGraceMs())) return;
    child.kill("SIGKILL");
    await owned.closed;
  }

  private isBundledWhisperCppProvider(provider: TranscriptionProviderConfig): boolean {
    return provider.type === "whisper_cpp" && provider.baseUrl === bundledWhisperCppRuntimeUrl;
  }

  private effectiveStreamingMode(provider: TranscriptionProviderConfig): SttStreamingMode {
    if (provider.defaultModel === "whisper-1") return "none";
    return provider.streamingMode;
  }

  private async readSseTranscript(
    response: Response,
    onDelta: ((delta: string) => void) | undefined,
    timeouts: { totalTimeoutMs: number; idleTimeoutMs: number },
    signal?: AbortSignal
  ): Promise<string> {
    const decoder = new TextDecoder();
    let buffer = "";
    let transcript = "";
    let completed = false;

    const consumeEvents = (final = false): void => {
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      if (final && buffer.trim()) {
        events.push(buffer);
        buffer = "";
      }

      for (const event of events) {
        const dataLines = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim());

        for (const dataLine of dataLines) {
          if (!dataLine) continue;
          if (dataLine === "[DONE]") {
            completed = true;
            continue;
          }

          let data: unknown;
          try {
            data = JSON.parse(dataLine);
          } catch {
            throw new Error("STT SSE returned a malformed JSON event.");
          }
          if (!isRecord(data)) continue;
          if (data.type === "transcript.text.done") {
            if (typeof data.text !== "string") throw new Error("STT SSE returned an invalid completion event.");
            transcript = checkedTranscriptAppend("", data.text);
            completed = true;
            continue;
          }

          const delta = data.delta;
          if (typeof delta === "string" && delta) {
            transcript = checkedTranscriptAppend(transcript, delta);
            onDelta?.(delta);
          }
        }
      }
    };

    await readResponseBody(
      response,
      (chunk) => {
        buffer += decoder.decode(chunk, { stream: true });
        consumeEvents();
        if (buffer.length > providerSsePendingMaxChars) {
          throw new Error(`STT SSE pending event exceeded ${providerSsePendingMaxChars} characters.`);
        }
      },
      { ...timeouts, maxBytes: providerSuccessBodyMaxBytes, label: "STT SSE", signal }
    );
    buffer += decoder.decode();
    consumeEvents(true);
    if (!completed) throw new Error("STT SSE ended before a terminal completion event.");

    return requireTranscriptText(transcript);
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

function runtimeResourceKey(variantKey: string): string {
  return `runtime:${variantKey}`;
}

function modelResourceKey(modelPath: string): string {
  return `model:${modelPath}`;
}

export class BoundedTextBuffer {
  private value = "";

  constructor(private readonly limit: number) {}

  append(chunk: string): void {
    this.value = tail(`${this.value}${chunk}`, this.limit);
  }

  text(): string {
    return this.value;
  }
}

export function buildSherpaArgs(
  modelPath: string,
  audioPath: string,
  threadCount = process.env.MURMUR_STT_THREADS || "4",
  accelerator: SttRuntimeAccelerator = "cpu"
): string[] {
  const tokensPath = join(modelPath, "tokens.txt");
  if (!existsSync(tokensPath)) {
    throw new Error(`Sherpa ONNX model is missing tokens.txt in ${modelPath}.`);
  }
  const provider = accelerator === "cuda" ? "cuda" : "cpu";

  const ctcModel = firstExisting([join(modelPath, "model.int8.onnx"), join(modelPath, "model.onnx")]);
  if (ctcModel) {
    return [
      `--nemo-ctc-model=${ctcModel}`,
      `--tokens=${tokensPath}`,
      `--num-threads=${threadCount}`,
      `--provider=${provider}`,
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
      `--provider=${provider}`,
      "--decoding-method=greedy_search",
      "--debug=false",
      audioPath
    ];
  }

  throw new Error(`Sherpa ONNX model directory is missing supported ONNX files: ${modelPath}`);
}

export function buildWhisperServerArgs(
  port: number,
  modelPath: string,
  tempDir: string,
  requestPath: string,
  publicDir: string,
  threadCount = process.env.MURMUR_STT_THREADS || "4",
  accelerator: SttRuntimeAccelerator = "cpu",
  gpuDevice = process.env.MURMUR_STT_GPU_DEVICE
): string[] {
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--model",
    modelPath,
    "--request-path",
    requestPath,
    "--inference-path",
    "/inference",
    "--tmp-dir",
    tempDir,
    "--public",
    publicDir,
    "--threads",
    threadCount
  ];
  if (accelerator !== "cpu" && gpuDevice) {
    args.push("--device", gpuDevice);
  }
  return args;
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

async function waitForWhisperServer(
  baseUrl: string,
  requestPath: string,
  challenge: string,
  child: ChildProcessWithoutNullStreams,
  launchError: () => Error | null,
  updateDiagnostics: () => void,
  signal?: AbortSignal
): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = runtimeReadyTimeoutMs();
  while (Date.now() - startedAt < timeoutMs) {
    throwIfAborted(signal);
    const spawnFailure = launchError();
    if (spawnFailure) {
      updateDiagnostics();
      throw new Error(`whisper-server failed to launch: ${spawnFailure.message}`);
    }
    if (child.exitCode !== null) {
      updateDiagnostics();
      throw new Error("whisper-server exited before becoming ready. Check runtime diagnostics for details.");
    }

    try {
      const challengeResponse = await fetchWithTimeout(`${baseUrl}/`, { signal }, 500);
      const challengeBody = await readResponseText(challengeResponse, {
        totalTimeoutMs: 500,
        idleTimeoutMs: 500,
        maxBytes: 1024,
        label: "whisper-server identity",
        signal
      });
      if (challengeResponse.status !== 200 || challengeBody !== challenge) {
        await delay(150, signal);
        continue;
      }

      const healthResponse = await fetchWithTimeout(`${baseUrl}${requestPath}/health`, { signal }, 500);
      const healthBody = await readResponseText(healthResponse, {
        totalTimeoutMs: 500,
        idleTimeoutMs: 500,
        maxBytes: 1024,
        label: "whisper-server health",
        signal
      });
      const health = JSON.parse(healthBody) as unknown;
      if (healthResponse.status === 200 && isRecord(health) && health.status === "ok") return;
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
    await delay(150, signal);
  }

  updateDiagnostics();
  throw new Error(`whisper-server did not become ready within ${timeoutMs}ms. Check runtime diagnostics for details.`);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function closesWithin(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  const result = await Promise.race([closed.then(() => true), timedOut]);
  if (timer) clearTimeout(timer);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function runtimeReadyTimeoutMs(): number {
  const value = Number(process.env.MURMUR_RUNTIME_READY_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 45000;
}

function processTerminationGraceMs(): number {
  return envPositiveInteger("MURMUR_STT_PROCESS_TERMINATION_GRACE_MS", defaultProcessTerminationGraceMs);
}

function transcriptionRuntimeTimeoutMs(): number {
  return envPositiveInteger("MURMUR_STT_PROCESS_TIMEOUT_MS", transcriptionTimeoutMs);
}

function transcriptionHttpTimeouts(): { totalTimeoutMs: number; idleTimeoutMs: number } {
  return {
    totalTimeoutMs: envPositiveInteger("MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS", transcriptionTimeoutMs),
    idleTimeoutMs: envPositiveInteger("MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS", transcriptionIdleTimeoutMs)
  };
}

function envPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function assertWavAudioHasSamples(audio: Uint8Array, mimeType: string): void {
  if (!mimeType.toLowerCase().includes("wav")) return;

  const dataLength = wavDataLength(audio);
  if (dataLength === null) {
    throw new Error("Recorded WAV audio is invalid. Restart recording so Murmur can capture WAV audio.");
  }
  if (dataLength === 0) {
    throw new Error("Recording did not capture any audio. Try again and keep recording for a moment before stopping.");
  }
}

function wavDataLength(audio: Uint8Array): number | null {
  if (audio.byteLength < 20) return null;

  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkLength;
    if (chunkDataEnd > view.byteLength) return null;
    if (chunkId === "data") return chunkLength;
    offset = chunkDataEnd + (chunkLength % 2);
  }

  return null;
}

function readAscii(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) return "";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function checkedTranscriptAppend(current: string, addition: string): string {
  if (current.length + addition.length > providerTranscriptMaxChars) {
    throw new Error(`STT transcript exceeded ${providerTranscriptMaxChars} characters.`);
  }
  return `${current}${addition}`;
}

function providerHttpError(providerLabel: string, response: Response): Error {
  const requestId = boundedRequestId(response);
  return new Error(`${providerLabel} failed with HTTP ${response.status}${requestId ? ` (request ID ${requestId})` : ""}.`);
}

function boundedRequestId(response: Response): string | undefined {
  const value = response.headers.get("request-id") ?? response.headers.get("x-request-id");
  if (!value) return undefined;
  const sanitized = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 128);
  return sanitized || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeDiagnostics(label: string, stdout: string, stderr: string): string[] {
  return [
    stdout.trim() ? `${label} stdout: ${tail(stdout)}` : "",
    stderr.trim() ? `${label} stderr: ${tail(stderr)}` : ""
  ].filter(Boolean);
}

function tail(value: string, length = 2000): string {
  return value.trim().slice(-length);
}
