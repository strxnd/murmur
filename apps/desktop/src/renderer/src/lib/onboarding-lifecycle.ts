import type { DictationSession } from "../../../shared/types";

export type OnboardingDictationStatus = "idle" | "starting" | "recording" | "waiting" | "passed" | "error";

export interface OnboardingDictationControls {
  recording: boolean;
  busy: boolean;
  showStop: boolean;
  showCancel: boolean;
  canStart: boolean;
}

export function onboardingDictationControls(
  sessionStatus: DictationSession["status"],
  dictationStatus: OnboardingDictationStatus
): OnboardingDictationControls {
  const recording = sessionStatus === "recording" || dictationStatus === "recording";
  const processing = ["transcribing", "processing", "pasting"].includes(sessionStatus);
  const busy = dictationStatus === "starting" || dictationStatus === "waiting" || processing;
  return {
    recording,
    busy,
    showStop: recording,
    showCancel: recording || busy,
    canStart: !recording && !busy
  };
}

export interface MicrophoneProbeToken {
  generation: number;
  inputId: string;
}

export class MicrophoneProbeGuard {
  private generation = 0;
  private selectedInputId: string;

  constructor(selectedInputId: string) {
    this.selectedInputId = selectedInputId;
  }

  select(inputId: string): void {
    this.selectedInputId = inputId;
    this.generation += 1;
  }

  begin(): MicrophoneProbeToken {
    return { generation: ++this.generation, inputId: this.selectedInputId };
  }

  isCurrent(token: MicrophoneProbeToken): boolean {
    return token.generation === this.generation && token.inputId === this.selectedInputId;
  }

  invalidate(): void {
    this.generation += 1;
  }
}
