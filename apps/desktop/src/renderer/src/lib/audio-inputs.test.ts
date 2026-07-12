import { describe, expect, it } from "vitest";
import {
  audioInputSelectItems,
  audioInputSelectValueToPreferredId,
  preferredAudioInputIdToSelectValue,
  systemAudioInputSelectValue
} from "./audio-inputs";

describe("audio input helpers", () => {
  it("uses a non-empty select value for the system default option", () => {
    expect(preferredAudioInputIdToSelectValue(undefined)).toBe(systemAudioInputSelectValue);
    expect(preferredAudioInputIdToSelectValue("")).toBe(systemAudioInputSelectValue);
    expect(preferredAudioInputIdToSelectValue("  ")).toBe(systemAudioInputSelectValue);
    expect(audioInputSelectValueToPreferredId(systemAudioInputSelectValue)).toBe("");
  });

  it("filters blank and duplicate device IDs from the selector items", () => {
    const items = audioInputSelectItems([
      { kind: "audioinput", deviceId: "", label: "" },
      { kind: "audioinput", deviceId: "mic-1", label: "Desk mic" },
      { kind: "audioinput", deviceId: "mic-1", label: "Duplicate mic" },
      { kind: "videoinput", deviceId: "camera-1", label: "Camera" },
      { kind: "audioinput", deviceId: "mic-2", label: "" }
    ]);

    expect(items).toEqual([
      { value: systemAudioInputSelectValue, label: "System default" },
      { value: "mic-1", label: "Desk mic" },
      { value: "mic-2", label: "Microphone 2" }
    ]);
  });

  it("keeps real device IDs distinct from the system default sentinel", () => {
    expect(preferredAudioInputIdToSelectValue("default")).toBe("default");
    expect(audioInputSelectValueToPreferredId("default")).toBe("default");
  });

  it("includes a stale selected device as unavailable instead of falling back to system default", () => {
    const items = audioInputSelectItems([{ kind: "audioinput", deviceId: "mic-1", label: "Desk mic" }], " mic-missing ");

    expect(items).toEqual([
      { value: systemAudioInputSelectValue, label: "System default" },
      { value: "mic-1", label: "Desk mic" },
      { value: "mic-missing", label: "Unavailable microphone", disabled: true }
    ]);
    expect(preferredAudioInputIdToSelectValue(" mic-missing ")).toBe("mic-missing");
  });
});
