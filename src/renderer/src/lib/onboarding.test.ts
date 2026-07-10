import { describe, expect, it } from "vitest";
import { defaultModelLibrary, defaultSession, defaultSettings, defaultTranscriptionProviders } from "../../../shared/defaults";
import type { AppStateSnapshot, SttRuntimeInstallState } from "../../../shared/types";
import {
  activeReadyLocalVoiceModel,
  defaultOnboardingVoiceModelId,
  localVoiceModelActiveAndReady,
  onboardingLocalVoiceModels,
  onboardingStepIds,
  onboardingStepIdsForState,
  onboardingSttReady,
  onboardingVoiceModel,
  runtimeIdForVoiceModel,
  shouldAutoOpenOnboarding
} from "./onboarding";

describe("renderer onboarding helpers", () => {
  it("uses the redesigned four-step wizard order", () => {
    expect(onboardingStepIds).toEqual(["microphone", "stt", "transcription", "ready"]);
    expect(onboardingStepIdsForState(state())).toEqual(["microphone", "stt", "transcription", "ready"]);
  });

  it("auto-opens for a first run without usable STT", () => {
    expect(shouldAutoOpenOnboarding(state())).toBe(true);
  });

  it("does not auto-open after onboarding is completed or skipped", () => {
    expect(
      shouldAutoOpenOnboarding(
        state({
          onboardingCompletedAt: "2026-01-01T00:00:00.000Z"
        })
      )
    ).toBe(false);
    expect(
      shouldAutoOpenOnboarding(
        state({
          onboardingSkippedAt: "2026-01-01T00:00:00.000Z"
        })
      )
    ).toBe(false);
  });

  it("uses the default tiny English Whisper model when no local voice model is ready", () => {
    expect(onboardingVoiceModel(state())?.id).toBe(defaultOnboardingVoiceModelId);
  });

  it("limits onboarding STT choices to downloadable whisper.cpp and Sherpa ONNX voice models", () => {
    const options = onboardingLocalVoiceModels(state());

    expect(options.map((item) => item.id)).toContain(defaultOnboardingVoiceModelId);
    expect(options.map((item) => item.id)).toContain("nvidia-parakeet-tdt-ctc-110m");
    expect(options.map((item) => item.id)).not.toContain("openai-gpt-4o-transcribe");
    expect(options.every((item) => item.kind === "voice" && !item.isCloud && item.downloadStrategy !== "none")).toBe(true);
    expect(new Set(options.map((item) => runtimeIdForVoiceModel(item)))).toEqual(new Set(["whisper.cpp", "sherpa-onnx"]));
  });

  it("recognizes an active downloaded local voice model as ready", () => {
    const snapshot = state({ runtimeStatus: "ready" });
    snapshot.modelLibrary = {
      ...snapshot.modelLibrary,
      activeModelIds: { voice: "whisper-base-en" },
      downloads: [
        {
          modelId: "whisper-base-en",
          status: "downloaded",
          progressBytes: 1,
          favorite: false
        }
      ]
    };

    expect(activeReadyLocalVoiceModel(snapshot)?.id).toBe("whisper-base-en");
    expect(onboardingVoiceModel(snapshot)?.id).toBe("whisper-base-en");
    expect(localVoiceModelActiveAndReady(snapshot, onboardingVoiceModel(snapshot)!)).toBe(true);
    expect(onboardingSttReady(snapshot)).toBe(true);
  });

  it("treats configured cloud STT as ready without forcing a local download", () => {
    const snapshot = state();
    snapshot.modelLibrary = {
      ...snapshot.modelLibrary,
      activeModelIds: { voice: "openai-gpt-4o-transcribe" }
    };
    snapshot.transcriptionProviders = snapshot.transcriptionProviders.map((provider) =>
      provider.id === "openai-stt" ? { ...provider, apiKey: "sk-test" } : provider
    );

    expect(onboardingSttReady(snapshot)).toBe(true);
    expect(onboardingStepIdsForState(snapshot)).toEqual(["microphone", "transcription", "ready"]);
  });

  it("treats configured external STT as ready without forcing a local download", () => {
    const snapshot = state();
    snapshot.transcriptionProviders = snapshot.transcriptionProviders.map((provider) =>
      provider.id === "local-openai-stt" ? { ...provider, enabled: true } : provider
    );

    expect(onboardingSttReady(snapshot)).toBe(true);
    expect(onboardingStepIdsForState(snapshot)).toEqual(["microphone", "transcription", "ready"]);
  });
});

function state({
  runtimeStatus = "not_installed",
  onboardingCompletedAt,
  onboardingSkippedAt
}: {
  runtimeStatus?: SttRuntimeInstallState["status"];
  onboardingCompletedAt?: string;
  onboardingSkippedAt?: string;
} = {}): AppStateSnapshot {
  return {
    settings: {
      ...defaultSettings,
      onboardingCompletedAt,
      onboardingSkippedAt
    },
    modes: [],
    transcriptionProviders: defaultTranscriptionProviders,
    llmProviders: [],
    autoModeRules: [],
    vocabulary: [],
    history: [],
    modelLibrary: defaultModelLibrary,
    releaseNotes: [],
    sttSetup: {
      skipped: false,
      completed: false,
      needsSetup: true,
      runtimes: {
        "whisper.cpp|linux-x64|cpu|0.0.0-test": runtime("whisper.cpp", runtimeStatus),
        "sherpa-onnx|linux-x64|cpu|0.0.0-test": runtime("sherpa-onnx", "not_installed")
      }
    },
    session: defaultSession,
    capabilities: {
      sttRuntimes: {
        "whisper.cpp|linux-x64|cpu|0.0.0-test": {
          id: "whisper.cpp",
          variantKey: "whisper.cpp|linux-x64|cpu|0.0.0-test",
          accelerator: "cpu",
          label: "whisper.cpp",
          status: runtimeStatus === "ready" ? "available" : "missing",
          platformKey: "linux-x64",
          message: "runtime"
        },
        "sherpa-onnx|linux-x64|cpu|0.0.0-test": {
          id: "sherpa-onnx",
          variantKey: "sherpa-onnx|linux-x64|cpu|0.0.0-test",
          accelerator: "cpu",
          label: "sherpa-onnx",
          status: "missing",
          platformKey: "linux-x64",
          message: "runtime"
        }
      },
      stt: { diagnostics: [], accelerationProbe: emptyAccelerationProbe() },
      hotkeys: {
        backend: "electron_global_shortcut",
        pushToTalkRelease: false,
        registered: true,
        diagnostics: [],
        modeSelector: {
          registered: true,
          diagnostics: []
        }
      },
      context: {
        backend: "clipboard_fallback",
        appMetadata: false,
        selectedText: false,
        diagnostics: []
      },
      automation: {
        status: "not_required",
        permissionRequired: false,
        canPrompt: false,
        diagnostics: []
      },
      paste: {
        backend: "clipboard_only",
        automationAvailable: false,
        permissionRequired: false,
        diagnostics: []
      },
      storage: {
        backend: "json",
        diagnostics: []
      }
    }
  };
}

function runtime(id: "whisper.cpp" | "sherpa-onnx", status: SttRuntimeInstallState["status"]): SttRuntimeInstallState {
  return {
    id,
    variantKey: `${id}|linux-x64|cpu|0.0.0-test`,
    accelerator: "cpu",
    label: id,
    platformKey: "linux-x64",
    requiredVersion: "0.0.0-test",
    status,
    progressBytes: 0,
    message: id,
    canDownload: status !== "ready",
    canRepair: status !== "ready"
  };
}

function emptyAccelerationProbe() {
  return {
    nvidia: { available: false, devices: [], diagnostics: [] },
    diagnostics: []
  };
}
