import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLlmProviders, defaultModes, defaultModelLibrary, defaultSession, defaultSettings, defaultTranscriptionProviders } from "../../../shared/defaults";
import type { AppStateSnapshot } from "../../../shared/types";
import { useMurmurStore } from "./murmur-store";

afterEach(() => {
  useMurmurStore.getState().dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useMurmurStore.setState({ status: "loading", snapshot: null, error: null, actionError: null });
});

describe("useMurmurStore initialization", () => {
  it("subscribes before fetching and keeps a newer event snapshot", async () => {
    const initial = deferred<AppStateSnapshot>();
    const eventSnapshot = testSnapshot();
    eventSnapshot.settings = { ...eventSnapshot.settings, theme: "dark" };
    let onStateChanged: ((snapshot: AppStateSnapshot) => void) | undefined;
    const unsubscribeState = vi.fn();
    vi.stubGlobal("window", {
      murmur: {
        getState: vi.fn(() => initial.promise),
        onStateChanged: vi.fn((listener: (snapshot: AppStateSnapshot) => void) => {
          onStateChanged = listener;
          return unsubscribeState;
        }),
        onModelDownloadProgress: vi.fn(() => vi.fn()),
        onSttRuntimeProgress: vi.fn(() => vi.fn())
      }
    });

    const initialization = useMurmurStore.getState().init();
    onStateChanged?.(eventSnapshot);
    initial.resolve(testSnapshot());
    await initialization;

    expect(useMurmurStore.getState().snapshot?.settings.theme).toBe("dark");
    useMurmurStore.getState().dispose();
    expect(unsubscribeState).toHaveBeenCalledOnce();
  });

  it("keeps live subscriptions when the initial fetch fails after a state event", async () => {
    const initial = deferred<AppStateSnapshot>();
    let onStateChanged: ((snapshot: AppStateSnapshot) => void) | undefined;
    const unsubscribeState = vi.fn();
    vi.stubGlobal("window", {
      murmur: {
        getState: vi.fn(() => initial.promise),
        onStateChanged: vi.fn((listener: (snapshot: AppStateSnapshot) => void) => {
          onStateChanged = listener;
          return unsubscribeState;
        }),
        onModelDownloadProgress: vi.fn(() => vi.fn()),
        onSttRuntimeProgress: vi.fn(() => vi.fn())
      }
    });

    const initialization = useMurmurStore.getState().init();
    const firstEvent = testSnapshot();
    firstEvent.settings = { ...firstEvent.settings, theme: "dark" };
    onStateChanged?.(firstEvent);
    initial.reject(new Error("stale fetch failed"));
    await initialization;

    const secondEvent = testSnapshot();
    secondEvent.settings = { ...secondEvent.settings, theme: "light" };
    onStateChanged?.(secondEvent);
    expect(useMurmurStore.getState().snapshot?.settings.theme).toBe("light");
    expect(unsubscribeState).not.toHaveBeenCalled();

    useMurmurStore.getState().dispose();
    expect(unsubscribeState).toHaveBeenCalledOnce();
  });

  it("shares concurrent initialization and disposes listeners from a stale run", async () => {
    const initial = deferred<AppStateSnapshot>();
    const unsubscribers = [vi.fn(), vi.fn(), vi.fn()];
    const getState = vi.fn(() => initial.promise);
    vi.stubGlobal("window", {
      murmur: {
        getState,
        onStateChanged: vi.fn(() => unsubscribers[0]),
        onModelDownloadProgress: vi.fn(() => unsubscribers[1]),
        onSttRuntimeProgress: vi.fn(() => unsubscribers[2])
      }
    });

    const first = useMurmurStore.getState().init();
    const second = useMurmurStore.getState().init();
    expect(first).toBe(second);
    expect(getState).toHaveBeenCalledOnce();

    useMurmurStore.getState().dispose();
    initial.resolve(testSnapshot());
    await first;

    expect(unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(useMurmurStore.getState().snapshot).toBeNull();
  });
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

  it("commits snapshots returned by Codex account actions", async () => {
    const connected = testSnapshot();
    connected.providerRuntime.codex = {
      status: "connected",
      message: "Connected to Codex.",
      modelAvailable: true,
      accountLabel: "user@example.com"
    };
    const refreshCodex = vi.fn<() => Promise<AppStateSnapshot>>().mockResolvedValue(connected);
    vi.stubGlobal("window", { murmur: { refreshCodex } });
    useMurmurStore.setState({ status: "ready", snapshot: testSnapshot(), error: null, actionError: null });

    await useMurmurStore.getState().refreshCodex();

    expect(refreshCodex).toHaveBeenCalledOnce();
    expect(useMurmurStore.getState().snapshot?.providerRuntime.codex).toMatchObject({
      status: "connected",
      modelAvailable: true
    });
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, resolve, reject };
}

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
        "whisper.cpp|linux-x64|cpu|0.0.0-test": {
          id: "whisper.cpp",
          variantKey: "whisper.cpp|linux-x64|cpu|0.0.0-test",
          accelerator: "cpu",
          label: "whisper.cpp",
          platformKey: "linux-x64",
          requiredVersion: "0.0.0-test",
          status: "ready",
          progressBytes: 0,
          message: "Ready",
          canDownload: false,
          canRepair: false
        },
        "sherpa-onnx|linux-x64|cpu|0.0.0-test": {
          id: "sherpa-onnx",
          variantKey: "sherpa-onnx|linux-x64|cpu|0.0.0-test",
          accelerator: "cpu",
          label: "Sherpa ONNX",
          platformKey: "linux-x64",
          requiredVersion: "0.0.0-test",
          status: "ready",
          progressBytes: 0,
          message: "Ready",
          canDownload: false,
          canRepair: false
        }
      }
    },
    session: defaultSession,
    providerRuntime: {
      codex: { status: "signed_out", message: "Sign in to Codex.", modelAvailable: false }
    },
    capabilities: {
      sttRuntimes: {
        "whisper.cpp|linux-x64|cpu|0.0.0-test": {
          id: "whisper.cpp",
          variantKey: "whisper.cpp|linux-x64|cpu|0.0.0-test",
          accelerator: "cpu",
          label: "whisper.cpp",
          status: "available",
          platformKey: "linux-x64",
          message: "Ready"
        },
        "sherpa-onnx|linux-x64|cpu|0.0.0-test": {
          id: "sherpa-onnx",
          variantKey: "sherpa-onnx|linux-x64|cpu|0.0.0-test",
          accelerator: "cpu",
          label: "Sherpa ONNX",
          status: "available",
          platformKey: "linux-x64",
          message: "Ready"
        }
      },
      stt: {
        diagnostics: [],
        accelerationProbe: {
          nvidia: { available: false, devices: [], diagnostics: [] },
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
