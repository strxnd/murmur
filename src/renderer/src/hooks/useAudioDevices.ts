import { useEffect, useState } from "react";

export function useAudioDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((items) => {
        if (!cancelled) setDevices(items.filter((item) => item.kind === "audioinput"));
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return devices;
}
