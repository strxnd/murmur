import { describe, expect, it } from "vitest";
import { MicrophoneProbeGuard, onboardingDictationControls } from "./onboarding-lifecycle";

describe("onboarding dictation lifecycle controls", () => {
  it.each(["transcribing", "processing", "pasting"] as const)(
    "keeps cancellation available while the pipeline is %s",
    (sessionStatus) => {
      expect(onboardingDictationControls(sessionStatus, "waiting")).toMatchObject({
        busy: true,
        showStop: false,
        showCancel: true,
        canStart: false
      });
    }
  );

  it("shows both stop and cancel while recording", () => {
    expect(onboardingDictationControls("recording", "recording")).toMatchObject({
      recording: true,
      showStop: true,
      showCancel: true,
      canStart: false
    });
  });
});

describe("microphone probe ownership", () => {
  it("rejects a probe after the selected input changes", () => {
    const guard = new MicrophoneProbeGuard("device-a");
    const probe = guard.begin();

    guard.select("device-b");

    expect(guard.isCurrent(probe)).toBe(false);
    expect(guard.begin().inputId).toBe("device-b");
  });

  it("rejects a probe after onboarding closes", () => {
    const guard = new MicrophoneProbeGuard("device-a");
    const probe = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(probe)).toBe(false);
  });
});
