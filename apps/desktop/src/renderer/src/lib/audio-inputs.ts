export const systemAudioInputSelectValue = "__murmur_system_audio_input__";

export interface AudioInputDeviceLike {
  deviceId: string;
  label: string;
  kind?: string;
}

export interface AudioInputSelectItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export function audioInputSelectItems(devices: AudioInputDeviceLike[], selectedInputId?: string): AudioInputSelectItem[] {
  const items: AudioInputSelectItem[] = [{ value: systemAudioInputSelectValue, label: "System default" }];
  const seen = new Set([systemAudioInputSelectValue]);
  const selectedDeviceId = selectedInputId?.trim() ?? "";
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

  if (selectedDeviceId && !seen.has(selectedDeviceId)) {
    items.push({
      value: selectedDeviceId,
      label: "Unavailable microphone",
      disabled: true
    });
  }

  return items;
}

export function preferredAudioInputIdToSelectValue(preferredAudioInputId: string | undefined): string {
  const deviceId = preferredAudioInputId?.trim() ?? "";
  return deviceId ? deviceId : systemAudioInputSelectValue;
}

export function audioInputSelectValueToPreferredId(value: string): string {
  const deviceId = value.trim();
  return deviceId === systemAudioInputSelectValue ? "" : deviceId;
}
