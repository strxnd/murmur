import { useEffect, useRef } from "react";
import { maxRecordingDurationMs } from "../../../shared/defaults";
import { murmurClient } from "../lib/murmur-client";

interface WavRecorder {
  stop: () => Promise<ArrayBuffer>;
  cancel: () => Promise<void>;
}

interface PendingCompletion {
  sessionId: string;
  cancelled: boolean;
}

const levelNoiseFloor = 0.012;
const levelSpeechCeiling = 0.12;
const levelPublishIntervalMs = 32;
const levelPublishHeartbeatMs = 180;
const levelPublishMinDelta = 0.012;
const encodeYieldEveryChunks = 24;

export function useRecordingBridge(enabled: boolean): void {
  const recorderRef = useRef<WavRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const completingRef = useRef(false);
  const startGenerationRef = useRef(0);
  const pendingCompletionRef = useRef<PendingCompletion | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const stopTracks = (stream = streamRef.current): void => {
      stream?.getTracks().forEach((track) => track.stop());
      if (stream === streamRef.current) streamRef.current = null;
    };

    const completeCurrentRecording = async (sessionId: string, cancelled: boolean): Promise<void> => {
      if (sessionId !== sessionRef.current) return;
      if (completingRef.current) {
        pendingCompletionRef.current = { sessionId, cancelled: cancelled || pendingCompletionRef.current?.cancelled === true };
        return;
      }

      const recorder = recorderRef.current;
      if (!recorder) {
        pendingCompletionRef.current = { sessionId, cancelled: cancelled || pendingCompletionRef.current?.cancelled === true };
        return;
      }

      completingRef.current = true;
      pendingCompletionRef.current = null;
      recorderRef.current = null;

      try {
        if (cancelled) {
          await recorder.cancel();
          return;
        }

        const audio = await recorder.stop();
        await murmurClient.completeRecording({
          sessionId,
          audio,
          mimeType: "audio/wav"
        });
      } finally {
        stopTracks();
        if (sessionRef.current === sessionId) sessionRef.current = null;
        completingRef.current = false;
      }
    };

    const start = murmurClient.onRecordingStart(async ({ sessionId, preferredAudioInputId }) => {
      const generation = startGenerationRef.current + 1;
      startGenerationRef.current = generation;
      pendingCompletionRef.current = null;
      sessionRef.current = sessionId;

      try {
        const audioConstraint: MediaTrackConstraints | boolean = preferredAudioInputId
          ? { deviceId: { exact: preferredAudioInputId } }
          : true;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
        if (startGenerationRef.current !== generation || sessionRef.current !== sessionId) {
          stopTracks(stream);
          return;
        }

        streamRef.current = stream;
        const recorder = await startWavRecorder(stream, sessionId, () => {
          if (sessionRef.current === sessionId) {
            void murmurClient.stopDictation();
          }
        });
        if (startGenerationRef.current !== generation || sessionRef.current !== sessionId) {
          await recorder.cancel();
          stopTracks(stream);
          return;
        }

        recorderRef.current = recorder;
        const pendingCompletion = pendingCompletionRef.current as PendingCompletion | null;
        if (pendingCompletion?.sessionId === sessionId) {
          void completeCurrentRecording(sessionId, pendingCompletion.cancelled);
        }
      } catch (error) {
        stopTracks();
        if (
          startGenerationRef.current === generation &&
          sessionRef.current === sessionId &&
          (pendingCompletionRef.current as PendingCompletion | null)?.cancelled !== true
        ) {
          await murmurClient.reportRecordingError({
            sessionId,
            message: `Microphone recording failed: ${errorMessage(error)}`
          });
        }
      }
    });

    const stop = murmurClient.onRecordingStop(({ sessionId }) => {
      void completeCurrentRecording(sessionId, false);
    });

    const cancel = murmurClient.onRecordingCancel(({ sessionId }) => {
      void completeCurrentRecording(sessionId, true);
    });

    return () => {
      startGenerationRef.current += 1;
      start();
      stop();
      cancel();
      void recorderRef.current?.cancel();
      recorderRef.current = null;
      pendingCompletionRef.current = null;
      sessionRef.current = null;
      stopTracks();
    };
  }, [enabled]);
}

async function startWavRecorder(stream: MediaStream, sessionId: string, onMaxDuration: () => void): Promise<WavRecorder> {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, source.channelCount || 1, 1);
  const monitor = context.createGain();
  monitor.gain.value = 0;

  const chunks: Float32Array[] = [];
  const maxSamples = Math.floor((context.sampleRate * maxRecordingDurationMs) / 1000);
  let totalSamples = 0;
  let maxDurationNotified = false;
  let smoothedLevel = 0;
  let lastLevelPublishedAt = 0;
  let lastPublishedLevel = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer;
    let output = new Float32Array(input.length);
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
    if (output.length > remainingSamples) {
      output = output.slice(0, remainingSamples);
    }
    chunks.push(output);
    totalSamples += output.length;
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

  let closed = false;
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
      const sampleRate = context.sampleRate;
      await cleanup();
      return encodeWav(chunks, totalSamples, sampleRate);
    },
    cancel: cleanup
  };
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

async function encodeWav(chunks: Float32Array[], totalSamples: number, sampleRate: number): Promise<ArrayBuffer> {
  const bytesPerSample = 2;
  const dataLength = totalSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  let chunksSinceYield = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += bytesPerSample;
    }

    chunksSinceYield += 1;
    if (chunksSinceYield >= encodeYieldEveryChunks) {
      chunksSinceYield = 0;
      await yieldToBrowser();
    }
  }

  return buffer;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
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
