import { describe, expect, it, vi } from "vitest";
import { watchAudioDevices } from "./useAudioDevices";

describe("watchAudioDevices", () => {
  it("refreshes audio inputs on device changes and removes its listener", async () => {
    let deviceChange: (() => void) | undefined;
    const microphone = { kind: "audioinput", deviceId: "mic-1" } as MediaDeviceInfo;
    const enumerateDevices = vi
      .fn<() => Promise<MediaDeviceInfo[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([microphone, { kind: "audiooutput", deviceId: "speaker-1" } as MediaDeviceInfo]);
    const removeEventListener = vi.fn();
    const mediaDevices = {
      enumerateDevices,
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        deviceChange = listener;
      }),
      removeEventListener
    } as unknown as MediaDevices;
    const onDevicesChanged = vi.fn();

    const stop = watchAudioDevices(mediaDevices, onDevicesChanged);
    await vi.waitFor(() => expect(onDevicesChanged).toHaveBeenLastCalledWith([]));

    deviceChange?.();
    await vi.waitFor(() => expect(onDevicesChanged).toHaveBeenLastCalledWith([microphone]));

    stop();
    expect(removeEventListener).toHaveBeenCalledWith("devicechange", deviceChange);
  });
});
