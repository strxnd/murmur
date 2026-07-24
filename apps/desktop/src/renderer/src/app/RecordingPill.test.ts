import { describe, expect, it } from "vitest";
import { shouldAnimateRecordingLevels } from "./RecordingPill";

describe("recording pill motion preference", () => {
  it("keeps the live waveform static when reduced motion is requested", () => {
    expect(shouldAnimateRecordingLevels(true, true)).toBe(false);
  });

  it("animates live levels only during recording without reduced motion", () => {
    expect(shouldAnimateRecordingLevels(true, false)).toBe(true);
    expect(shouldAnimateRecordingLevels(false, false)).toBe(false);
  });
});
