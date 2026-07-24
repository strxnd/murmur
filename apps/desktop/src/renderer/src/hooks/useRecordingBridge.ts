import { useEffect } from "react";
import {
  maxRecordingAudioBytes,
  maxRecordingDurationMs,
  recordingSampleRate
} from "../../../shared/defaults";
import type { RecordingStartPayload } from "../../../shared/types";
import { murmurClient } from "../lib/murmur-client";

export interface WavRecorder {
  stop: () => Promise<ArrayBuffer>;
  cancel: () => Promise<void>;
}

interface RecordingBridgeClient {
  setRecordingCaptureReady: (ready: boolean) => Promise<void>;
  completeRecording: (payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }) => Promise<unknown>;
  reportRecordingError: (payload: { sessionId: string; message: string }) => Promise<unknown>;
  publishRecordingLevel: (payload: { sessionId: string; level: number }) => void;
  stopDictation: () => Promise<unknown>;
  onRecordingStart: (callback: (payload: RecordingStartPayload) => void) => () => void;
  onRecordingStop: (callback: (payload: { sessionId: string }) => void) => () => void;
  onRecordingCancel: (callback: (payload: { sessionId: string }) => void) => () => void;
}

interface RecordingCaptureSession {
  sessionId: string;
  generation: number;
  stream: MediaStream | null;
  recorder: WavRecorder | null;
  completionRequested: boolean | null;
  finalizing: boolean;
  disposed: boolean;
}

interface RecordingBridgeDependencies {
  client?: RecordingBridgeClient;
  getAudioStream?: (preferredAudioInputId: string | undefined) => Promise<MediaStream>;
  createRecorder?: (stream: MediaStream, sessionId: string, onMaxDuration: () => void) => Promise<WavRecorder>;
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

const levelNoiseFloor = 0.012;
const levelSpeechCeiling = 0.12;
const levelPublishIntervalMs = 32;
const levelPublishHeartbeatMs = 180;
const levelPublishMinDelta = 0.012;
const encodeYieldEveryChunks = 24;
const wavHeaderBytes = 44;
const bytesPerPcmSample = 2;

export function useRecordingBridge(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = createRecordingBridgeController();
    return () => controller.dispose();
  }, [enabled]);
}

export function createRecordingBridgeController(dependencies: RecordingBridgeDependencies = {}): { dispose(): void } {
  const client = dependencies.client ?? murmurClient;
  const getAudioStream = dependencies.getAudioStream ?? getRecordingAudioStream;
  const createRecorder = dependencies.createRecorder ?? startWavRecorder;
  const captures = new Set<RecordingCaptureSession>();
  let activeCapture: RecordingCaptureSession | null = null;
  let generation = 0;
  let disposed = false;

  const stopTracks = (stream: MediaStream | null): void => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const releaseCaptureResources = async (capture: RecordingCaptureSession): Promise<void> => {
    const recorder = capture.recorder;
    const stream = capture.stream;
    capture.recorder = null;
    capture.stream = null;
    stopTracks(stream);
    if (recorder) await recorder.cancel().catch(() => undefined);
  };

  const finalizeCapture = async (capture: RecordingCaptureSession, cancelled: boolean): Promise<void> => {
    capture.completionRequested = cancelled || capture.completionRequested === true;
    if (capture.finalizing) return;
    if (!capture.recorder) {
      if (capture.completionRequested && capture.stream) {
        stopTracks(capture.stream);
        capture.stream = null;
      }
      return;
    }

    capture.finalizing = true;
    const recorder = capture.recorder;
    const stream = capture.stream;
    capture.recorder = null;
    capture.stream = null;

    try {
      if (capture.completionRequested) {
        stopTracks(stream);
        await recorder.cancel();
        return;
      }

      const audio = await recorder.stop();
      stopTracks(stream);
      await client.completeRecording({
        sessionId: capture.sessionId,
        audio,
        mimeType: "audio/wav"
      });
    } catch (error) {
      stopTracks(stream);
      if (!capture.completionRequested && !capture.disposed) {
        await client.reportRecordingError({
          sessionId: capture.sessionId,
          message: `Microphone recording failed: ${errorMessage(error)}`
        }).catch(() => undefined);
      }
    } finally {
      capture.disposed = true;
      captures.delete(capture);
      if (activeCapture === capture) activeCapture = null;
    }
  };

  const handleStart = async ({ sessionId, preferredAudioInputId }: RecordingStartPayload): Promise<void> => {
    const capture: RecordingCaptureSession = {
      sessionId,
      generation: ++generation,
      stream: null,
      recorder: null,
      completionRequested: null,
      finalizing: false,
      disposed: false
    };
    const previousCapture = activeCapture;
    activeCapture = capture;
    captures.add(capture);
    if (previousCapture && !previousCapture.finalizing) {
      previousCapture.disposed = true;
      void releaseCaptureResources(previousCapture).finally(() => captures.delete(previousCapture));
    }

    try {
      const stream = await getAudioStream(preferredAudioInputId);
      capture.stream = stream;
      if (disposed || capture.disposed || activeCapture !== capture || capture.generation !== generation) {
        await releaseCaptureResources(capture);
        captures.delete(capture);
        return;
      }
      if (capture.completionRequested === true) {
        await releaseCaptureResources(capture);
        capture.disposed = true;
        captures.delete(capture);
        if (activeCapture === capture) activeCapture = null;
        return;
      }

      const recorder = await createRecorder(stream, sessionId, () => {
        if (!capture.disposed && activeCapture === capture) void client.stopDictation();
      });
      capture.recorder = recorder;
      if (disposed || capture.disposed || activeCapture !== capture || capture.generation !== generation) {
        await releaseCaptureResources(capture);
        captures.delete(capture);
        return;
      }

      if (capture.completionRequested !== null) {
        void finalizeCapture(capture, capture.completionRequested);
      }
    } catch (error) {
      await releaseCaptureResources(capture);
      captures.delete(capture);
      if (activeCapture === capture) activeCapture = null;
      if (!disposed && !capture.disposed && capture.completionRequested !== true) {
        await client.reportRecordingError({
          sessionId,
          message: `Microphone recording failed: ${errorMessage(error)}`
        }).catch(() => undefined);
      }
    }
  };

  const start = client.onRecordingStart((payload) => {
    void handleStart(payload);
  });
  const stop = client.onRecordingStop(({ sessionId }) => {
    const capture = [...captures].find((candidate) => candidate.sessionId === sessionId);
    if (capture) void finalizeCapture(capture, false);
  });
  const cancel = client.onRecordingCancel(({ sessionId }) => {
    const capture = [...captures].find((candidate) => candidate.sessionId === sessionId);
    if (capture) void finalizeCapture(capture, true);
  });
  void client.setRecordingCaptureReady(true).catch(() => undefined);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      start();
      stop();
      cancel();
      void client.setRecordingCaptureReady(false).catch(() => undefined);
      for (const capture of captures) {
        capture.disposed = true;
        void releaseCaptureResources(capture).finally(() => captures.delete(capture));
      }
      activeCapture = null;
    }
  };
}

export async function getRecordingAudioStream(
  preferredAudioInputId: string | undefined,
  getUserMedia: GetUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints)
): Promise<MediaStream> {
  const deviceId = preferredAudioInputId?.trim() ?? "";
  if (!deviceId) return getUserMedia({ audio: true });

  try {
    return await getUserMedia({ audio: { deviceId: { exact: deviceId } } });
  } catch (error) {
    if (!isMissingPreferredAudioInputError(error)) throw error;
    return getUserMedia({ audio: true });
  }
}

async function startWavRecorder(stream: MediaStream, sessionId: string, onMaxDuration: () => void): Promise<WavRecorder> {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, source.channelCount || 1, 1);
  const monitor = context.createGain();
  monitor.gain.value = 0;

  const chunks: Int16Array[] = [];
  const resampler = new Pcm16Resampler(context.sampleRate, recordingSampleRate);
  const maxSamples = Math.min(
    Math.floor((recordingSampleRate * maxRecordingDurationMs) / 1000),
    Math.floor((maxRecordingAudioBytes - wavHeaderBytes) / bytesPerPcmSample)
  );
  let totalSamples = 0;
  let maxDurationNotified = false;
  let smoothedLevel = 0;
  let lastLevelPublishedAt = 0;
  let lastPublishedLevel = 0;
  let closed = false;
  processor.onaudioprocess = (event) => {
    if (closed) return;

    const input = event.inputBuffer;
    const output = new Float32Array(input.length);
    for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
      const data = input.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        output[index] += data[index] / input.numberOfChannels;
      }
    }

    const remainingSamples = maxSamples - totalSamples;
    if (remainingSamples <= 0) {
      notifyMaxDuration();
      return;
    }
    const resampled = resampler.push(output);
    const bounded = resampled.length > remainingSamples ? resampled.slice(0, remainingSamples) : resampled;
    if (bounded.length > 0) {
      chunks.push(bounded);
      totalSamples += bounded.length;
    }
    if (totalSamples >= maxSamples) notifyMaxDuration();

    const targetLevel = normalizeRecordingLevel(computeRms(output));
    const smoothing = targetLevel > smoothedLevel ? 0.35 : 0.18;
    smoothedLevel += (targetLevel - smoothedLevel) * smoothing;

    const now = performance.now();
    const elapsedSincePublish = now - lastLevelPublishedAt;
    const nextPublishedLevel = Math.round(smoothedLevel * 1000) / 1000;
    const levelDelta = Math.abs(nextPublishedLevel - lastPublishedLevel);
    if (elapsedSincePublish >= levelPublishIntervalMs && (levelDelta >= levelPublishMinDelta || elapsedSincePublish >= levelPublishHeartbeatMs)) {
      lastLevelPublishedAt = now;
      lastPublishedLevel = nextPublishedLevel;
      murmurClient.publishRecordingLevel({ sessionId, level: nextPublishedLevel });
    }
  };

  source.connect(processor);
  processor.connect(monitor);
  monitor.connect(context.destination);

  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    processor.disconnect();
    source.disconnect();
    monitor.disconnect();
    await context.close();
  };

  const notifyMaxDuration = (): void => {
    if (maxDurationNotified) return;
    maxDurationNotified = true;
    onMaxDuration();
  };

  return {
    stop: async () => {
      await cleanup();
      return encodePcm16Wav(chunks, recordingSampleRate);
    },
    cancel: cleanup
  };
}

export class Pcm16Resampler {
  private readonly sourceSamplesPerOutput: number;
  private nextSourcePosition = 0;
  private sourceSamplesSeen = 0;
  private previousSample: number | undefined;

  constructor(sourceSampleRate: number, targetSampleRate: number) {
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) throw new Error("Source sample rate must be positive.");
    if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0) throw new Error("Target sample rate must be positive.");
    this.sourceSamplesPerOutput = sourceSampleRate / targetSampleRate;
  }

  push(samples: Float32Array): Int16Array {
    if (samples.length === 0) return new Int16Array();

    const firstCurrentIndex = this.sourceSamplesSeen;
    const finalIndex = firstCurrentIndex + samples.length - 1;
    const output: number[] = [];
    while (this.nextSourcePosition <= finalIndex) {
      const leftIndex = Math.floor(this.nextSourcePosition);
      const fraction = this.nextSourcePosition - leftIndex;
      if (fraction > Number.EPSILON && leftIndex >= finalIndex) break;

      const left = this.sampleAt(leftIndex, firstCurrentIndex, samples);
      const right = fraction <= Number.EPSILON ? left : this.sampleAt(leftIndex + 1, firstCurrentIndex, samples);
      output.push(floatSampleToPcm16(left + (right - left) * fraction));
      this.nextSourcePosition += this.sourceSamplesPerOutput;
    }

    this.sourceSamplesSeen += samples.length;
    this.previousSample = samples[samples.length - 1];
    return Int16Array.from(output);
  }

  private sampleAt(index: number, firstCurrentIndex: number, samples: Float32Array): number {
    if (index === firstCurrentIndex - 1 && this.previousSample !== undefined) return this.previousSample;
    return samples[index - firstCurrentIndex] ?? samples[samples.length - 1] ?? 0;
  }
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

function normalizeRecordingLevel(rms: number): number {
  return Math.max(0, Math.min(1, (rms - levelNoiseFloor) / (levelSpeechCeiling - levelNoiseFloor)));
}

export async function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Promise<ArrayBuffer> {
  return encodePcm16Wav(chunks.map((chunk) => Int16Array.from(chunk, floatSampleToPcm16)), sampleRate);
}

export async function encodePcm16Wav(chunks: readonly Int16Array[], sampleRate: number): Promise<ArrayBuffer> {
  const totalSamples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const dataLength = totalSamples * bytesPerPcmSample;
  if (wavHeaderBytes + dataLength > maxRecordingAudioBytes) throw new Error("Recording is too large.");
  const buffer = new ArrayBuffer(wavHeaderBytes + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerPcmSample, true);
  view.setUint16(32, bytesPerPcmSample, true);
  view.setUint16(34, 8 * bytesPerPcmSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = wavHeaderBytes;
  let chunksSinceYield = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true);
      offset += bytesPerPcmSample;
    }

    chunksSinceYield += 1;
    if (chunksSinceYield >= encodeYieldEveryChunks) {
      chunksSinceYield = 0;
      await yieldToBrowser();
    }
  }

  return buffer;
}

function floatSampleToPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingPreferredAudioInputError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const name = (error as { name?: unknown }).name;
  if (name === "OverconstrainedError" || name === "NotFoundError" || name === "DevicesNotFoundError") return true;

  return name === "ConstraintNotSatisfiedError" && (error as { constraint?: unknown }).constraint === "deviceId";
}
