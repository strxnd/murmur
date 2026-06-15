import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { cpus, totalmem } from "node:os";
import { isAbsolute, join } from "node:path";
import { modelCatalog } from "../../shared/model-catalog";
import type { ModelCatalogItem, SttBenchmarkResult, SttModelRecommendation, SttPreferredLanguageScope } from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { fetchWithTimeout, joinUrl } from "./http";
import { ModelLibraryService } from "./model-library";
import { SttRuntimeService, type ResolvedSttRuntime } from "./stt-runtime";
import { buildWhisperServerArgs } from "./stt";

const benchmarkAudioDurationMs = 1000;
const benchmarkTimeoutMs = 60000;

export class SttBenchmarkService {
  constructor(
    private paths: AppPaths,
    private modelLibrary: ModelLibraryService,
    private runtimeService: SttRuntimeService
  ) {}

  async run(languageScope: SttPreferredLanguageScope): Promise<SttModelRecommendation> {
    const runtimeState = this.runtimeService.getInstallState("whisper.cpp");
    if (runtimeState.status === "unsupported") throw new Error(runtimeState.message);
    if (runtimeState.status !== "ready") {
      await this.runtimeService.downloadRuntime("whisper.cpp");
    }
    const readyRuntime = this.runtimeService.getInstallState("whisper.cpp");
    if (readyRuntime.status !== "ready") throw new Error(readyRuntime.error || readyRuntime.message);

    const baselineModelId = languageScope === "english" ? "whisper-tiny-en" : "whisper-tiny";
    const baselineModel = requireModel(baselineModelId);
    await this.ensureModelDownloaded(baselineModel);

    const modelPath = this.modelPath(baselineModel);
    const audioPath = this.writeBenchmarkWav();
    const runtime = this.runtimeService.requireRuntime("whisper.cpp");
    const startedAt = performance.now();
    let server: { url: string; child: ChildProcessWithoutNullStreams } | null = null;

    try {
      server = await startWhisperServer(runtime, modelPath);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(readFileSync(audioPath))], { type: "audio/wav" }), "benchmark.wav");
      form.append("response_format", "json");
      const response = await fetchWithTimeout(joinUrl(server.url, "/inference"), { method: "POST", body: form }, benchmarkTimeoutMs);
      if (!response.ok) throw new Error(`Benchmark transcription failed with HTTP ${response.status}: ${await response.text()}`);

      const elapsedMs = Math.max(1, performance.now() - startedAt);
      const benchmark: SttBenchmarkResult = {
        modelId: baselineModel.id,
        audioDurationMs: benchmarkAudioDurationMs,
        elapsedMs,
        realtimeFactor: benchmarkAudioDurationMs / elapsedMs,
        totalMemoryBytes: totalmem(),
        cpuThreadCount: cpus().length,
        createdAt: new Date().toISOString()
      };
      return recommendSttModel(languageScope, benchmark);
    } finally {
      if (server?.child.exitCode === null && !server.child.killed) server.child.kill();
      rmSync(audioPath, { force: true });
    }
  }

  private async ensureModelDownloaded(item: ModelCatalogItem): Promise<void> {
    const snapshot = this.modelLibrary.snapshot();
    const existing = snapshot.downloads.find((download) => download.modelId === item.id);
    if (existing?.status === "downloaded" && existsSync(this.modelPath(item))) return;

    const afterDownload = await this.modelLibrary.downloadModel(item.id);
    const download = afterDownload.downloads.find((candidate) => candidate.modelId === item.id);
    if (download?.status !== "downloaded" || !existsSync(this.modelPath(item))) {
      throw new Error(`Could not download benchmark model ${item.name}.`);
    }
  }

  private modelPath(item: ModelCatalogItem): string {
    const modelName = item.defaultProviderConfig?.model ?? item.filename;
    if (!modelName) throw new Error(`${item.name} does not define a local model path.`);
    return isAbsolute(modelName) ? modelName : join(this.paths.modelDir, modelName);
  }

  private writeBenchmarkWav(): string {
    mkdirSync(this.paths.tempDir, { recursive: true });
    const path = join(this.paths.tempDir, `stt-benchmark-${Date.now()}-${randomUUID()}.wav`);
    writeFileSync(path, createSineWaveWav(benchmarkAudioDurationMs));
    return path;
  }
}

export function recommendSttModel(
  languageScope: SttPreferredLanguageScope,
  benchmark: SttBenchmarkResult
): SttModelRecommendation {
  const totalMemoryBytes = benchmark.totalMemoryBytes;
  const realtimeFactor = benchmark.realtimeFactor;
  const tiny = scopedWhisperModel("tiny", languageScope);
  const base = scopedWhisperModel("base", languageScope);
  const small = scopedWhisperModel("small", languageScope);
  const turbo = "whisper-turbo";

  let recommendedModelId = turbo;
  let reason = "This machine has enough memory and measured throughput for Whisper Turbo.";

  if (totalMemoryBytes < gb(6) || realtimeFactor < 2) {
    recommendedModelId = tiny;
    reason = "Tiny is recommended because memory or measured transcription speed is limited.";
  } else if (totalMemoryBytes < gb(12) || realtimeFactor < 6) {
    recommendedModelId = base;
    reason = "Base is recommended for a balanced local setup on this machine.";
  } else if (totalMemoryBytes < gb(24) || realtimeFactor < 12) {
    recommendedModelId = small;
    reason = "Small is recommended because the benchmark has enough headroom for better accuracy.";
  }

  return {
    recommendedModelId,
    fallbackModelId: tiny,
    reason,
    benchmark,
    alternatives: [
      { modelId: tiny, reason: "Fastest and lowest memory use." },
      { modelId: base, reason: "Balanced speed and quality." },
      { modelId: small, reason: "Better quality when memory and speed allow it." },
      { modelId: turbo, reason: "High quality with faster decoding than large-v3." },
      { modelId: "whisper-medium", reason: "Manual quality option; not auto-recommended." },
      { modelId: "whisper-large", reason: "Manual maximum-quality option; not auto-recommended." }
    ].filter((alternative, index, alternatives) => alternatives.findIndex((candidate) => candidate.modelId === alternative.modelId) === index)
  };
}

function scopedWhisperModel(size: "tiny" | "base" | "small", languageScope: SttPreferredLanguageScope): string {
  if (languageScope === "english") {
    const englishId = `whisper-${size}-en`;
    if (modelCatalog.some((item) => item.id === englishId)) return englishId;
  }
  return `whisper-${size}`;
}

function requireModel(modelId: string): ModelCatalogItem {
  const item = modelCatalog.find((candidate) => candidate.id === modelId);
  if (!item) throw new Error(`Missing benchmark model ${modelId}.`);
  return item;
}

async function startWhisperServer(runtime: ResolvedSttRuntime, modelPath: string): Promise<{ url: string; child: ChildProcessWithoutNullStreams }> {
  const port = await findOpenPort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(runtime.binaryPath, buildWhisperServerArgs(port, modelPath), {
    stdio: ["pipe", "pipe", "pipe"],
    env: runtime.env,
    cwd: runtime.cwd
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  try {
    await waitForHttp(url, child, () => output);
    return { url, child };
  } catch (error) {
    if (child.exitCode === null && !child.killed) child.kill();
    throw error;
  }
}

function createSineWaveWav(durationMs: number): Buffer {
  const sampleRate = 16000;
  const sampleCount = Math.round((durationMs / 1000) * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }

  return buffer;
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
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
  while (Date.now() - startedAt < 45000) {
    if (child.exitCode !== null) {
      throw new Error(`whisper-server exited before benchmark was ready. ${truncate(output())}`);
    }
    try {
      await fetchWithTimeout(baseUrl, {}, 500);
      return;
    } catch {
      await delay(150);
    }
  }

  child.kill();
  throw new Error(`whisper-server did not become ready for benchmark. ${truncate(output())}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function truncate(value: string): string {
  return value.trim().slice(0, 500);
}

function gb(value: number): number {
  return value * 1024 * 1024 * 1024;
}
