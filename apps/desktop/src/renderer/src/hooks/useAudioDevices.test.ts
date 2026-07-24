import { describe, expect, it, vi } from "vitest";
import { watchAudioDevices } from "./useAudioDevices";

describe("watchAudioDevices", () => {
  it("ignores an older enumeration that resolves after a device-change refresh", async () => {
    const initial = deferred<MediaDeviceInfo[]>();
    const refreshed = deferred<MediaDeviceInfo[]>();
    let deviceChange: (() => void) | undefined;
    const microphone = { kind: "audioinput", deviceId: "mic-new" } as MediaDeviceInfo;
    const mediaDevices = {
      enumerateDevices: vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise),
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        deviceChange = listener;
      }),
      removeEventListener: vi.fn()
    } as unknown as MediaDevices;
    const onDevicesChanged = vi.fn();

    const stop = watchAudioDevices(mediaDevices, onDevicesChanged);
    deviceChange?.();
    refreshed.resolve([microphone]);
    await vi.waitFor(() => expect(onDevicesChanged).toHaveBeenLastCalledWith([microphone]));
    initial.resolve([]);
    await Promise.resolve();

    expect(onDevicesChanged).toHaveBeenCalledOnce();
    stop();
  });

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
