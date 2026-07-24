import { describe, expect, it, vi } from "vitest";
import { maxRecordingAudioBytes, maxRecordingDurationMs, recordingSampleRate } from "../../../shared/defaults";
import {
  Pcm16Resampler,
  createRecordingBridgeController,
  encodeWav,
  getRecordingAudioStream,
  type WavRecorder
} from "./useRecordingBridge";

describe("recording bridge audio input selection", () => {
  it("uses the system default input when no preferred input is set", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const getUserMedia = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      calls.push(constraints);
      return stream;
    };

    await expect(getRecordingAudioStream(undefined, getUserMedia)).resolves.toBe(stream);

    expect(calls).toEqual([{ audio: true }]);
  });

  it("falls back to the system default input when the preferred input is missing", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const missingInputError = Object.assign(new Error("missing device"), {
      name: "OverconstrainedError",
      constraint: "deviceId"
    });
    const getUserMedia = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      calls.push(constraints);
      if (calls.length === 1) throw missingInputError;
      return stream;
    };

    await expect(getRecordingAudioStream(" mic-1 ", getUserMedia)).resolves.toBe(stream);

    expect(calls).toEqual([{ audio: { deviceId: { exact: "mic-1" } } }, { audio: true }]);
  });

  it("does not retry when microphone permission is denied", async () => {
    const calls: MediaStreamConstraints[] = [];
    const permissionError = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const getUserMedia = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      calls.push(constraints);
      throw permissionError;
    };

    await expect(getRecordingAudioStream("mic-1", getUserMedia)).rejects.toThrow("denied");

    expect(calls).toEqual([{ audio: { deviceId: { exact: "mic-1" } } }]);
  });
});

describe("recording bridge WAV encoding", () => {
  it("sizes the WAV buffer from the actual recorded chunks", async () => {
    const audio = await encodeWav([new Float32Array([0, 0.5]), new Float32Array([-0.5])], 48000);
    const view = new DataView(audio);

    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(readAscii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
    expect(audio.byteLength).toBe(50);
  });

  it("clamps samples to signed 16-bit PCM", async () => {
    const audio = await encodeWav([new Float32Array([-2, 0, 2])], 16000);
    const view = new DataView(audio);

    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32767);
  });
});

describe("recording bridge capture ownership", () => {
  it("releases microphone tracks before awaiting main-process transcription", async () => {
    const harness = createBridgeHarness();
    const completion = deferred<unknown>();
    harness.completeRecording.mockReturnValueOnce(completion.promise);
    const stream = fakeStream();
    const recorder = fakeRecorder();
    harness.getAudioStream.mockResolvedValueOnce(stream.mediaStream);
    harness.createRecorder.mockResolvedValueOnce(recorder);
    const controller = createRecordingBridgeController(harness.dependencies);

    harness.emitStart("session-a");
    await vi.waitFor(() => expect(harness.createRecorder).toHaveBeenCalledOnce());
    harness.emitStop("session-a");

    await vi.waitFor(() => expect(harness.completeRecording).toHaveBeenCalledOnce());
    expect(stream.stop).toHaveBeenCalledOnce();
    expect(recorder.stop).toHaveBeenCalledOnce();

    completion.resolve({});
    await completion.promise;
    controller.dispose();
  });

  it("does not let an old finalizer stop or strand a replacement capture", async () => {
    const harness = createBridgeHarness();
    const oldCompletion = deferred<unknown>();
    harness.completeRecording.mockImplementation(({ sessionId }) =>
      sessionId === "session-a" ? oldCompletion.promise : Promise.resolve({})
    );
    const streamA = fakeStream();
    const streamB = fakeStream();
    const recorderA = fakeRecorder();
    const recorderB = fakeRecorder();
    harness.getAudioStream.mockResolvedValueOnce(streamA.mediaStream).mockResolvedValueOnce(streamB.mediaStream);
    harness.createRecorder.mockResolvedValueOnce(recorderA).mockResolvedValueOnce(recorderB);
    const controller = createRecordingBridgeController(harness.dependencies);

    harness.emitStart("session-a");
    await vi.waitFor(() => expect(harness.createRecorder).toHaveBeenCalledTimes(1));
    harness.emitStop("session-a");
    await vi.waitFor(() => expect(harness.completeRecording).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-a" })));
    expect(streamA.stop).toHaveBeenCalledOnce();

    harness.emitStart("session-b");
    await vi.waitFor(() => expect(harness.createRecorder).toHaveBeenCalledTimes(2));
    oldCompletion.resolve({});
    await oldCompletion.promise;

    expect(streamB.stop).not.toHaveBeenCalled();
    harness.emitStop("session-b");
    await vi.waitFor(() => expect(recorderB.stop).toHaveBeenCalledOnce());
    expect(streamB.stop).toHaveBeenCalledOnce();
    expect(harness.completeRecording).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-b" }));
    controller.dispose();
  });

  it("drains cancellation while recorder startup is still pending", async () => {
    const harness = createBridgeHarness();
    const recorderStart = deferred<WavRecorder>();
    const stream = fakeStream();
    const recorder = fakeRecorder();
    harness.getAudioStream.mockResolvedValueOnce(stream.mediaStream);
    harness.createRecorder.mockReturnValueOnce(recorderStart.promise);
    const controller = createRecordingBridgeController(harness.dependencies);

    harness.emitStart("session-a");
    await vi.waitFor(() => expect(harness.createRecorder).toHaveBeenCalledOnce());
    harness.emitCancel("session-a");

    expect(stream.stop).toHaveBeenCalledOnce();
    recorderStart.resolve(recorder);
    await vi.waitFor(() => expect(recorder.cancel).toHaveBeenCalledOnce());
    expect(harness.completeRecording).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("announces readiness only after listeners are installed and revokes it on disposal", () => {
    const harness = createBridgeHarness();
    const controller = createRecordingBridgeController(harness.dependencies);

    expect(harness.setRecordingCaptureReady).toHaveBeenCalledWith(true);
    expect(harness.listenerOrder).toEqual(["start", "stop", "cancel", "ready:true"]);

    controller.dispose();
    expect(harness.setRecordingCaptureReady).toHaveBeenLastCalledWith(false);
  });
});

describe("recording bridge bounded PCM capture", () => {
  it("incrementally resamples high-rate audio to compact 16 kHz PCM16 chunks", () => {
    const resampler = new Pcm16Resampler(96_000, recordingSampleRate);
    const first = resampler.push(new Float32Array(4_800).fill(0.25));
    const second = resampler.push(new Float32Array(4_800).fill(0.25));

    expect(first.length + second.length).toBe(1_600);
    expect(first.byteLength + second.byteLength).toBe(3_200);
    expect(first[0]).toBeCloseTo(8192, 0);
  });

  it("bounds the encoded ten-minute payload at the shared IPC limit", () => {
    expect(maxRecordingAudioBytes).toBe(44 + (recordingSampleRate * maxRecordingDurationMs * 2) / 1000);
    expect(maxRecordingAudioBytes).toBeLessThan(20 * 1024 * 1024);
  });
});

function createBridgeHarness() {
  let onStart: ((payload: { sessionId: string; preferredAudioInputId?: string }) => void) | undefined;
  let onStop: ((payload: { sessionId: string }) => void) | undefined;
  let onCancel: ((payload: { sessionId: string }) => void) | undefined;
  const listenerOrder: string[] = [];
  const setRecordingCaptureReady = vi.fn(async (ready: boolean) => {
    listenerOrder.push(`ready:${ready}`);
  });
  const completeRecording = vi.fn<
    (payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }) => Promise<unknown>
  >(async () => ({}));
  const getAudioStream = vi.fn<() => Promise<MediaStream>>();
  const createRecorder = vi.fn<() => Promise<WavRecorder>>();
  const client = {
    setRecordingCaptureReady,
    completeRecording,
    reportRecordingError: vi.fn(async () => ({})),
    publishRecordingLevel: vi.fn(),
    stopDictation: vi.fn(async () => ({})),
    onRecordingStart: vi.fn((callback: typeof onStart) => {
      listenerOrder.push("start");
      onStart = callback;
      return vi.fn();
    }),
    onRecordingStop: vi.fn((callback: typeof onStop) => {
      listenerOrder.push("stop");
      onStop = callback;
      return vi.fn();
    }),
    onRecordingCancel: vi.fn((callback: typeof onCancel) => {
      listenerOrder.push("cancel");
      onCancel = callback;
      return vi.fn();
    })
  };
  return {
    dependencies: { client, getAudioStream, createRecorder },
    listenerOrder,
    setRecordingCaptureReady,
    completeRecording,
    getAudioStream,
    createRecorder,
    emitStart(sessionId: string) {
      onStart?.({ sessionId });
    },
    emitStop(sessionId: string) {
      onStop?.({ sessionId });
    },
    emitCancel(sessionId: string) {
      onCancel?.({ sessionId });
    }
  };
}

function fakeStream(): { mediaStream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  return {
    mediaStream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop
  };
}

function fakeRecorder(): WavRecorder & { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return {
    stop: vi.fn(async () => new ArrayBuffer(44)),
    cancel: vi.fn(async () => undefined)
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
