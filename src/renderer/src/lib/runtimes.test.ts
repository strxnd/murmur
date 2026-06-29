import { describe, expect, it } from "vitest";
import { defaultLlmProviders, defaultModelLibrary, defaultModes, defaultSession, defaultSettings, defaultTranscriptionProviders } from "../../../shared/defaults";
import type {
  AppStateSnapshot,
  SttRuntimeAccelerator,
  SttRuntimeId,
  SttRuntimeInstallState
} from "../../../shared/types";
import { gpuRuntimePromptState, uniqueRuntimeInstallStates } from "./runtimes";

describe("renderer runtime helpers", () => {
  it("sorts variant-keyed runtime states", () => {
    const cpu = runtime("whisper.cpp", "cpu", "ready");
    const cuda = runtime("whisper.cpp", "cuda", "not_installed", true);
    const snapshot = state({
      runtimes: {
        [cpu.variantKey]: cpu,
        [cuda.variantKey]: cuda
      }
    });

    expect(uniqueRuntimeInstallStates(snapshot).map((item) => item.variantKey)).toEqual([cpu.variantKey, cuda.variantKey]);
  });

  it("prompts for installable CUDA runtimes when NVIDIA is detected", () => {
    const cuda = runtime("whisper.cpp", "cuda", "not_installed", true);
    const snapshot = state({
      nvidia: true,
      runtimes: {
        [cuda.variantKey]: cuda
      }
    });

    const prompt = gpuRuntimePromptState(snapshot);

    expect(prompt?.accelerators).toEqual(["cuda"]);
    expect(prompt?.candidates.map((item) => item.variantKey)).toEqual([cuda.variantKey]);
    expect(prompt?.installable.map((item) => item.variantKey)).toEqual([cuda.variantKey]);
  });

  it("keeps the prompt visible while a detected GPU runtime is installing", () => {
    const cuda = runtime("whisper.cpp", "cuda", "downloading", false);
    const snapshot = state({
      nvidia: true,
      runtimes: {
        [cuda.variantKey]: cuda
      }
    });

    const prompt = gpuRuntimePromptState(snapshot);

    expect(prompt?.accelerators).toEqual(["cuda"]);
    expect(prompt?.candidates.map((item) => item.variantKey)).toEqual([cuda.variantKey]);
    expect(prompt?.installable).toEqual([]);
  });

  it("does not prompt after the GPU runtime prompt is dismissed", () => {
    const cuda = runtime("whisper.cpp", "cuda", "not_installed", true);
    const snapshot = state({
      nvidia: true,
      dismissed: true,
      runtimes: {
        [cuda.variantKey]: cuda
      }
    });

    expect(gpuRuntimePromptState(snapshot)).toBeNull();
  });
});

function state({
  runtimes,
  nvidia = false,
  dismissed = false
}: {
  runtimes: Record<string, SttRuntimeInstallState>;
  nvidia?: boolean;
  dismissed?: boolean;
}): AppStateSnapshot {
  return {
    settings: {
      ...defaultSettings,
      gpuRuntimeInstallPromptDismissedAt: dismissed ? "2026-01-01T00:00:00.000Z" : undefined
    },
    modes: defaultModes,
    transcriptionProviders: defaultTranscriptionProviders,
    llmProviders: defaultLlmProviders,
    autoModeRules: [],
    vocabulary: [],
    history: [],
    modelLibrary: defaultModelLibrary,
    releaseNotes: [],
    sttSetup: {
      skipped: false,
      completed: false,
      needsSetup: false,
      runtimes
    },
    session: defaultSession,
    capabilities: {
      sttRuntimes: {},
      stt: {
        diagnostics: [],
        gpuProbe: {
          nvidia: { available: nvidia, devices: nvidia ? ["Test NVIDIA GPU"] : [], diagnostics: [] },
          diagnostics: []
        }
      },
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
        focusedText: false,
        selectedText: false,
        browserDomain: false,
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

function runtime(
  id: SttRuntimeId,
  accelerator: SttRuntimeAccelerator,
  status: SttRuntimeInstallState["status"],
  canDownload = false
): SttRuntimeInstallState {
  return {
    id,
    variantKey: `${id}|linux-x64|${accelerator}|0.0.0-test`,
    accelerator,
    label: `${id} ${accelerator}`,
    platformKey: "linux-x64",
    requiredVersion: "0.0.0-test",
    status,
    progressBytes: 0,
    message: "Runtime state",
    canDownload,
    canRepair: canDownload && status === "repairable"
  };
}
