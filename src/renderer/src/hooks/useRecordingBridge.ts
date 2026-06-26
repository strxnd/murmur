import { useEffect, useRef } from "react";
import { murmurClient } from "../lib/murmur-client";

interface WavRecorder {
  stop: () => Promise<ArrayBuffer>;
  cancel: () => Promise<void>;
}

const levelNoiseFloor = 0.012;
const levelSpeechCeiling = 0.12;
const levelPublishIntervalMs = 32;
const levelPublishHeartbeatMs = 180;
const levelPublishMinDelta = 0.012;

export function useRecordingBridge(enabled: boolean): void {
  const recorderRef = useRef<WavRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const completingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    const stopTracks = (): void => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const completeCurrentRecording = async (cancelled: boolean): Promise<void> => {
      if (completingRef.current) return;
      completingRef.current = true;
      const recorder = recorderRef.current;
      const completedSessionId = sessionRef.current;
      recorderRef.current = null;

      try {
        if (!recorder) return;
        if (cancelled || !completedSessionId) {
          await recorder.cancel();
          return;
        }

        const audio = await recorder.stop();
        await murmurClient.completeRecording({
          sessionId: completedSessionId,
          audio,
          mimeType: "audio/wav"
        });
      } finally {
        stopTracks();
        completingRef.current = false;
      }
    };

    const start = murmurClient.onRecordingStart(async ({ sessionId }) => {
      cancelledRef.current = false;
      sessionRef.current = sessionId;

      const state = await murmurClient.getState();
      const audioConstraint: MediaTrackConstraints | boolean = state.settings.preferredAudioInputId
        ? { deviceId: { exact: state.settings.preferredAudioInputId } }
        : true;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      streamRef.current = stream;
      recorderRef.current = await startWavRecorder(stream, sessionId);
    });

    const stop = murmurClient.onRecordingStop(() => {
      void completeCurrentRecording(cancelledRef.current);
    });

    const cancel = murmurClient.onRecordingCancel(() => {
      cancelledRef.current = true;
      void completeCurrentRecording(true);
    });

    return () => {
      start();
      stop();
      cancel();
      void recorderRef.current?.cancel();
      stopTracks();
    };
  }, [enabled]);
}

async function startWavRecorder(stream: MediaStream, sessionId: string): Promise<WavRecorder> {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, source.channelCount || 1, 1);
  const monitor = context.createGain();
  monitor.gain.value = 0;

  const chunks: Float32Array[] = [];
  let smoothedLevel = 0;
  let lastLevelPublishedAt = 0;
  let lastPublishedLevel = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer;
    const output = new Float32Array(input.length);
    for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
      const data = input.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        output[index] += data[index] / input.numberOfChannels;
      }
    }
    chunks.push(output);

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

  return {
    stop: async () => {
      await cleanup();
      return encodeWav(mergeFloat32(chunks), context.sampleRate);
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

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
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
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
