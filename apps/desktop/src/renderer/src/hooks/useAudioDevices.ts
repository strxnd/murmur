import { useEffect, useState } from "react";

export function useAudioDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => watchAudioDevices(navigator.mediaDevices, setDevices), []);

  return devices;
}

export function watchAudioDevices(
  mediaDevices: MediaDevices | undefined,
  onDevicesChanged: (devices: MediaDeviceInfo[]) => void
): () => void {
  let cancelled = false;

  const refresh = (): void => {
    mediaDevices
      ?.enumerateDevices()
      .then((items) => {
        if (!cancelled) onDevicesChanged(items.filter((item) => item.kind === "audioinput"));
      })
      .catch(() => {
        if (!cancelled) onDevicesChanged([]);
      });
  };

  mediaDevices?.addEventListener("devicechange", refresh);
  refresh();

  return () => {
    cancelled = true;
    mediaDevices?.removeEventListener("devicechange", refresh);
  };
}
