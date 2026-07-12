import { describe, expect, it } from "vitest";
import { defaultModelLibrary, defaultSession, defaultSettings, defaultTranscriptionProviders } from "../../../shared/defaults";
import type { AppStateSnapshot, SttRuntimeInstallState } from "../../../shared/types";
import { recordingUnavailableReason, shouldShowSttSetupCallout } from "./stt-setup";

describe("renderer STT setup helpers", () => {
  it("shows the setup callout when recording has no usable STT path", () => {
    expect(shouldShowSttSetupCallout(state({ skipped: false, needsSetup: true }))).toBe(true);
    expect(shouldShowSttSetupCallout(state({ skipped: true, needsSetup: false }))).toBe(true);
  });

  it("disables recording when no provider or active model is usable", () => {
    expect(recordingUnavailableReason(state())).toBe("No speech-to-text provider or local voice model is ready.");
  });

  it("allows recording with an active downloaded voice model and ready runtime", () => {
    const snapshot = state({ runtimeStatus: "ready" });
    snapshot.modelLibrary = {
      ...snapshot.modelLibrary,
      activeModelIds: { voice: "whisper-tiny-en" },
      downloads: [
        {
          modelId: "whisper-tiny-en",
          status: "downloaded",
          progressBytes: 1,
          favorite: false
        }
      ]
    };

    expect(recordingUnavailableReason(snapshot)).toBeNull();
    expect(shouldShowSttSetupCallout(snapshot)).toBe(false);
  });

  it("disables recording when an active API voice model lacks credentials", () => {
    const snapshot = state();
    snapshot.modelLibrary = {
      ...snapshot.modelLibrary,
      activeModelIds: { voice: "openai-gpt-4o-transcribe" }
    };

    expect(recordingUnavailableReason(snapshot)).toBe("No speech-to-text provider or local voice model is ready.");
    expect(shouldShowSttSetupCallout(snapshot)).toBe(true);
  });

  it("allows recording when an active API voice model has usable cloud credentials", () => {
    const snapshot = state();
    snapshot.modelLibrary = {
      ...snapshot.modelLibrary,
      activeModelIds: { voice: "openai-gpt-4o-transcribe" }
    };
    snapshot.transcriptionProviders = snapshot.transcriptionProviders.map((provider) =>
      provider.id === "openai-stt" ? { ...provider, apiKey: "sk-test" } : provider
    );

    expect(recordingUnavailableReason(snapshot)).toBeNull();
    expect(shouldShowSttSetupCallout(snapshot)).toBe(false);
  });

});

function state({
  skipped = false,
  completed = false,
  needsSetup = true,
  runtimeStatus = "not_installed"
}: {
  skipped?: boolean;
  completed?: boolean;
  needsSetup?: boolean;
  runtimeStatus?: SttRuntimeInstallState["status"];
} = {}): AppStateSnapshot {
  return {
    settings: {
      ...defaultSettings,
      sttSetupSkippedAt: skipped ? "2026-01-01T00:00:00.000Z" : undefined,
      sttSetupCompletedAt: completed ? "2026-01-01T00:00:00.000Z" : undefined
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
      skipped,
      completed,
      needsSetup,
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
