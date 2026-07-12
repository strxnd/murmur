import { describe, expect, it } from "vitest";
import { encodeWav, getRecordingAudioStream } from "./useRecordingBridge";

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

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
