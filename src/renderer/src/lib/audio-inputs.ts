export const systemAudioInputSelectValue = "__murmur_system_audio_input__";

export interface AudioInputDeviceLike {
  deviceId: string;
  label: string;
  kind?: string;
}

export interface AudioInputSelectItem {
  value: string;
  label: string;
}

export function audioInputSelectItems(devices: AudioInputDeviceLike[]): AudioInputSelectItem[] {
  const items: AudioInputSelectItem[] = [{ value: systemAudioInputSelectValue, label: "System default" }];
  const seen = new Set([systemAudioInputSelectValue]);
  let fallbackIndex = 1;

  for (const device of devices) {
    if (device.kind && device.kind !== "audioinput") continue;

    const deviceId = device.deviceId.trim();
    if (!deviceId || seen.has(deviceId)) continue;

    seen.add(deviceId);
    items.push({
      value: deviceId,
      label: device.label.trim() || `Microphone ${fallbackIndex}`
    });
    fallbackIndex += 1;
  }

  return items;
}

export function preferredAudioInputIdToSelectValue(preferredAudioInputId: string | undefined): string {
  return preferredAudioInputId?.trim() ? preferredAudioInputId : systemAudioInputSelectValue;
}

export function audioInputSelectValueToPreferredId(value: string): string {
  return value === systemAudioInputSelectValue ? "" : value;
}
