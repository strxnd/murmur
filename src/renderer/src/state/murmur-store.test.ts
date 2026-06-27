import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLlmProviders, defaultModes, defaultModelLibrary, defaultSession, defaultSettings, defaultTranscriptionProviders } from "../../../shared/defaults";
import type { AppStateSnapshot } from "../../../shared/types";
import { useMurmurStore } from "./murmur-store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useMurmurStore.setState({ status: "loading", snapshot: null, error: null, actionError: null });
});

describe("useMurmurStore action errors", () => {
  it("keeps a loaded app ready and surfaces rejected snapshot actions", async () => {
    const startDictation = vi.fn<() => Promise<AppStateSnapshot>>().mockRejectedValue(new Error("microphone denied"));
    vi.stubGlobal("window", {
      murmur: {
        startDictation
      }
    });
    useMurmurStore.setState({ status: "ready", snapshot: testSnapshot(), error: null, actionError: null });

    await expect(useMurmurStore.getState().startDictation()).rejects.toThrow("microphone denied");

    expect(useMurmurStore.getState().status).toBe("ready");
    expect(useMurmurStore.getState().actionError?.message).toBe("microphone denied");
  });

  it("surfaces rejected direct actions that do not return snapshots", async () => {
    const copyHistoryOutput = vi.fn<() => Promise<{ ok: boolean }>>().mockRejectedValue(new Error("clipboard unavailable"));
    vi.stubGlobal("window", {
      murmur: {
        copyHistoryOutput
      }
    });
    useMurmurStore.setState({ status: "ready", snapshot: testSnapshot(), error: null, actionError: null });

    await expect(useMurmurStore.getState().copyHistoryOutput("hello")).rejects.toThrow("clipboard unavailable");

    expect(copyHistoryOutput).toHaveBeenCalledWith("hello");
    expect(useMurmurStore.getState().status).toBe("ready");
    expect(useMurmurStore.getState().actionError?.message).toBe("clipboard unavailable");
  });
});

function testSnapshot(): AppStateSnapshot {
  return {
    settings: defaultSettings,
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
      runtimes: {
        "whisper.cpp": {
          id: "whisper.cpp",
          label: "whisper.cpp",
          platformKey: "linux-x64",
          requiredVersion: "test",
          status: "ready",
          progressBytes: 0,
          message: "Ready",
          canDownload: false,
          canRepair: false
        },
        "sherpa-onnx": {
          id: "sherpa-onnx",
          label: "Sherpa ONNX",
          platformKey: "linux-x64",
          requiredVersion: "test",
          status: "ready",
          progressBytes: 0,
          message: "Ready",
          canDownload: false,
          canRepair: false
        }
      }
    },
    session: defaultSession,
    capabilities: {
      sttRuntimes: {
        "whisper.cpp": {
          id: "whisper.cpp",
          label: "whisper.cpp",
          status: "available",
          platformKey: "linux-x64",
          message: "Ready"
        },
        "sherpa-onnx": {
          id: "sherpa-onnx",
          label: "Sherpa ONNX",
          status: "available",
          platformKey: "linux-x64",
          message: "Ready"
        }
      },
      stt: { diagnostics: [] },
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
