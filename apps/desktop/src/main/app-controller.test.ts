import { describe, expect, it, vi } from "vitest";
import { codexProviderDefaults } from "../shared/codex-provider";
import {
  defaultAutoModeRules,
  defaultModelLibrary,
  defaultModes,
  defaultReleaseNotes,
  defaultSession,
  defaultSettings
} from "../shared/defaults";
import type {
  AppStateSnapshot,
  CodexProviderRuntime,
  DictationHistoryItem,
  DictationSession,
  LlmProviderConfig,
  TranscriptionProviderConfig,
  TranscriptionResult
} from "../shared/types";
import {
  AppController,
  computeDurationMs,
  countWords,
  isSameOutputTarget,
  rendererQueryFromSuffix,
  selectLlmProviderAfterInitialRefresh,
  shouldPersistDictationHistory,
  wrapIndex
} from "./app-controller";
import { DictationSessionOwner, type DictationSessionOperation } from "./services/dictation-session";

vi.mock("./electron-api", () => ({
  app: {
    getPath: () => "/tmp/murmur-tests",
    getVersion: () => "0.1.0",
    isPackaged: false
  },
  BrowserWindow: vi.fn(),
  clipboard: {
    readBuffer: vi.fn(),
    readHTML: vi.fn(() => ""),
    readImage: vi.fn(),
    readRTF: vi.fn(() => ""),
    readText: vi.fn(() => ""),
    write: vi.fn(),
    writeBuffer: vi.fn(),
    writeText: vi.fn()
  },
  dialog: {},
  globalShortcut: {
    isRegistered: vi.fn(() => false),
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn()
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn(() => ({})) },
  nativeTheme: { shouldUseDarkColors: true },
  Notification: Object.assign(vi.fn(), { isSupported: vi.fn(() => false) }),
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(() => false)
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
  },
  shell: { openExternal: vi.fn() },
  systemPreferences: {},
  Tray: vi.fn()
}));

const testSttProvider: TranscriptionProviderConfig = {
  id: "test-stt",
  type: "local_openai_compatible_stt",
  name: "Test STT",
  baseUrl: "http://127.0.0.1:8000/v1",
  isCloud: false,
  isLocal: true,
  defaultModel: "test-stt-model",
  defaultLanguage: "auto",
  streamingMode: "none",
  enabled: true
};

const transcriptionResult: TranscriptionResult = {
  text: "raw transcript",
  providerId: testSttProvider.id,
  model: testSttProvider.defaultModel,
  streamingMode: "none"
};

const capturedContext = {
  appName: "Test App",
  appId: "dev.test.app",
  windowTitle: "Test Window",
  capturedAt: "2026-07-23T00:00:00.000Z",
  sourceQuality: "full" as const,
  diagnostics: []
};

interface TestController {
  session: DictationSession;
  sessionOperation: DictationSessionOperation | null;
  sessionContext: typeof capturedContext | null;
  initialCodexRefresh: Promise<unknown>;
  startRecording(trigger: string): Promise<AppStateSnapshot>;
  stopRecording(notice?: string): Promise<AppStateSnapshot>;
  cancelRecording(): Promise<AppStateSnapshot>;
  clearLocalData(): Promise<AppStateSnapshot>;
  completeRecording(payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot>;
  ensureAutomationReadyForUserAction: ReturnType<typeof vi.fn>;
  dispose(): void;
}

interface ControllerHarness {
  controller: TestController;
  state: ReturnType<typeof createPersistedState>;
  storage: {
    addHistory: ReturnType<typeof vi.fn>;
    clearLocalData: ReturnType<typeof vi.fn>;
    resolveLlmProviderSecret: ReturnType<typeof vi.fn>;
  };
  stt: { transcribe: ReturnType<typeof vi.fn> };
  llm: { process: ReturnType<typeof vi.fn> };
  paste: { copyText: ReturnType<typeof vi.fn>; insertText: ReturnType<typeof vi.fn> };
  codex: { logout: ReturnType<typeof vi.fn> };
  mainWindowSend: ReturnType<typeof vi.fn>;
  setCodexStatus(status: CodexProviderRuntime): void;
  setCurrentContext(context: typeof capturedContext): void;
}

function createPersistedState(options: { aiEnabled?: boolean; llmProviders?: LlmProviderConfig[] } = {}) {
  const mode = {
    ...defaultModes[0],
    aiEnabled: options.aiEnabled ?? true,
    examples: defaultModes[0].examples.map((example) => ({ ...example })),
    context: { ...defaultModes[0].context }
  };
  return {
    settings: { ...defaultSettings, activeModeId: mode.id, selectedTextCapture: "disabled" as const },
    modes: [mode],
    transcriptionProviders: [{ ...testSttProvider }],
    llmProviders: (options.llmProviders ?? [{ ...codexProviderDefaults }]).map((provider) => ({ ...provider })),
    autoModeRules: defaultAutoModeRules.map((rule) => ({ ...rule, match: { ...rule.match } })),
    vocabulary: [],
    history: [] as DictationHistoryItem[],
    modelLibrary: {
      catalog: [...defaultModelLibrary.catalog],
      downloads: [...defaultModelLibrary.downloads],
      activeModelIds: {}
    },
    releaseNotes: [...defaultReleaseNotes]
  };
}

function createControllerHarness(options: {
  aiEnabled?: boolean;
  codexStatus?: CodexProviderRuntime;
  initialCodexRefresh?: Promise<unknown>;
  llmProviders?: LlmProviderConfig[];
} = {}): ControllerHarness {
  const state = createPersistedState(options);
  let codexStatus: CodexProviderRuntime =
    options.codexStatus ?? { status: "connected", message: "Connected", modelAvailable: true };
  let currentContext = capturedContext;
  const mainWindowSend = vi.fn();
  const storage = {
    backend: "json" as const,
    getState: vi.fn(() => state),
    getSettings: vi.fn(() => state.settings),
    resolveTranscriptionProviderSecret: vi.fn((provider: TranscriptionProviderConfig) => ({ ...provider })),
    resolveLlmProviderSecret: vi.fn((provider: LlmProviderConfig) => ({ ...provider })),
    addHistory: vi.fn((item) => state.history.push(item)),
    clearLocalData: vi.fn(),
    getDiagnostics: vi.fn(() => [])
  };
  const stt = {
    transcribe: vi.fn(async () => transcriptionResult),
    dispose: vi.fn()
  };
  const llm = {
    process: vi.fn(async () => ({ text: "processed transcript", providerId: "codex", model: "test-llm" }))
  };
  const paste = {
    copyText: vi.fn(async () => ({ pasted: false, message: "Automatic paste was skipped; output left on the clipboard." })),
    insertText: vi.fn(async () => ({ pasted: true, message: "" })),
    getDiagnostics: vi.fn(() => [])
  };
  const codex = {
    getStatus: vi.fn(() => ({ ...codexStatus })),
    logout: vi.fn(async () => ({ ...codexStatus })),
    dispose: vi.fn()
  };

  const controller = Object.create(AppController.prototype) as TestController & Record<string, unknown>;
  Object.assign(controller, {
    mainWindow: { webContents: { send: mainWindowSend } },
    pillWindow: null,
    modeSelectorWindow: null,
    tray: null,
    closeToTrayNotification: null,
    storage,
    textAutomation: { dispose: vi.fn(), getCapability: vi.fn() },
    context: { capture: vi.fn(async () => currentContext), dispose: vi.fn() },
    paste,
    automationPermissions: {},
    runtimeService: {},
    accelerationProbe: {},
    portalHotkeys: { dispose: vi.fn() },
    nativeHotkeys: { dispose: vi.fn() },
    macosReleaseHotkeys: { unregister: vi.fn() },
    paths: { modelDir: "/tmp/murmur-test-models" },
    stt,
    codex,
    initialCodexRefresh: options.initialCodexRefresh ?? Promise.resolve(),
    clearingLocalData: false,
    llm,
    session: { ...defaultSession },
    dictationOwner: new DictationSessionOwner(),
    dictationStartGeneration: 0,
    sessionOperation: null,
    sessionContext: null,
    pendingContextCapture: null,
    recordingStoppedAt: null,
    pillHideTimer: null,
    recordingMaxDurationTimer: null,
    recordingStopAckTimer: null,
    pushToTalkPressed: false,
    pushToTalkSessionId: null,
    onboardingDictationScopeActive: false,
    ensureAutomationReadyForUserAction: vi.fn(() => ({ ready: true })),
    beginRecordingContextCapture: vi.fn(() => {
      controller.sessionContext = capturedContext;
    }),
    showPill: vi.fn(),
    hidePill: vi.fn(),
    hidePillSoon: vi.fn(),
    scheduleRecordingMaxDurationStop: vi.fn(),
    scheduleRecordingStopAckTimeout: vi.fn(),
    broadcastState: vi.fn(),
    registerHotkeys: vi.fn(async () => undefined),
    unregisterModeSelectorNavigationShortcuts: vi.fn(),
    getSnapshot: vi.fn(() => ({ ...state, session: controller.session }) as unknown as AppStateSnapshot),
    notifyPasteFallback: vi.fn(),
    notifyHistoryPersistenceFailure: vi.fn()
  });

  return {
    controller,
    state,
    storage,
    stt,
    llm,
    paste,
    codex,
    mainWindowSend,
    setCodexStatus(status) {
      codexStatus = status;
    },
    setCurrentContext(context) {
      currentContext = context;
    }
  };
}

async function startAndStop(controller: TestController): Promise<string> {
  await controller.startRecording("test");
  expect(controller.session.status).toBe("recording");
  const sessionId = controller.session.id;
  await controller.stopRecording();
  expect(controller.session.status).toBe("transcribing");
  return sessionId;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("app-controller utility contracts", () => {
  it("keeps renderer window routing suffixes as loadFile query objects", () => {
    expect(rendererQueryFromSuffix("")).toBeUndefined();
    expect(rendererQueryFromSuffix("?pill=1")).toEqual({ pill: "1" });
    expect(rendererQueryFromSuffix("mode-selector=1")).toEqual({ "mode-selector": "1" });
  });

  it("wraps mode selector indexes in both directions", () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(2, 0)).toBe(0);
  });

  it("computes recording duration and transcript word counts defensively", () => {
    expect(computeDurationMs("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:02.500Z")).toBe(2500);
    expect(computeDurationMs("bad", "2026-01-01T00:00:02.500Z")).toBeUndefined();
    expect(countWords("  one   two\nthree  ")).toBe(3);
  });

  it("keeps onboarding dictations out of persisted history", () => {
    expect(shouldPersistDictationHistory("dictation")).toBe(true);
    expect(shouldPersistDictationHistory("onboarding")).toBe(false);
  });

  it("requires a verifiable matching application and window for output delivery", () => {
    expect(isSameOutputTarget(capturedContext, { ...capturedContext })).toBe(true);
    expect(isSameOutputTarget(capturedContext, { ...capturedContext, appId: "dev.other.app" })).toBe(false);
    expect(isSameOutputTarget(capturedContext, { ...capturedContext, windowTitle: "Other Window" })).toBe(false);
    expect(
      isSameOutputTarget(
        { ...capturedContext, appId: undefined, appName: undefined },
        { ...capturedContext, appId: undefined, appName: undefined }
      )
    ).toBe(false);
  });

  it("waits for the initial Codex refresh before selecting an LLM for completed recordings", async () => {
    let finishRefresh!: () => void;
    const initialRefresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const selectProvider = vi.fn(() => ({ ...codexProviderDefaults }));

    const selection = selectLlmProviderAfterInitialRefresh(initialRefresh, selectProvider);

    expect(selectProvider).not.toHaveBeenCalled();
    finishRefresh();
    await expect(selection).resolves.toEqual(codexProviderDefaults);
    expect(selectProvider).toHaveBeenCalledOnce();
  });
});

describe("AppController dictation ownership", () => {
  it("starts recording without Accessibility and defers to clipboard-only delivery", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    harness.controller.ensureAutomationReadyForUserAction.mockReturnValue({
      ready: false,
      message: "Accessibility permission is unavailable."
    });

    const sessionId = await startAndStop(harness.controller);
    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.controller.ensureAutomationReadyForUserAction).toHaveBeenCalledOnce();
    expect(harness.paste.copyText).toHaveBeenCalledWith("raw transcript", expect.any(AbortSignal));
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.controller.session.status).toBe("complete");
  });

  it("copies output without automation when focus no longer matches the recording target", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const sessionId = await startAndStop(harness.controller);
    harness.setCurrentContext({ ...capturedContext, appId: "dev.other.app", appName: "Other App", windowTitle: "Other Window" });

    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.controller.ensureAutomationReadyForUserAction).not.toHaveBeenCalled();
    expect(harness.paste.copyText).toHaveBeenCalledWith("raw transcript", expect.any(AbortSignal));
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).toHaveBeenCalledOnce();
    expect(harness.controller.session.status).toBe("complete");
    expect(harness.controller.session.error).toContain("original app or window is no longer active");
  });

  it("surfaces a nonfatal warning when output must remain on the clipboard", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const sessionId = await startAndStop(harness.controller);
    harness.paste.insertText.mockResolvedValueOnce({
      pasted: true,
      message: "Paste shortcut sent; output left on the clipboard because the previous clipboard contained unsupported formats.",
      clipboardRetained: true
    });

    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.controller.session.status).toBe("complete");
    expect(harness.controller.session.error).toContain("output left on the clipboard");
  });

  it("keeps successful delivery complete when history persistence fails", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const sessionId = await startAndStop(harness.controller);
    harness.storage.addHistory.mockImplementationOnce(() => {
      throw new Error("history disk unavailable");
    });

    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.paste.insertText).toHaveBeenCalledOnce();
    expect(harness.paste.copyText).not.toHaveBeenCalled();
    expect(harness.controller.session.status).toBe("complete");
    expect(harness.controller.session.error).toContain("History was not saved: history disk unavailable");
  });

  it("does not freeze an enabled but unavailable Codex provider into a recording plan", async () => {
    const refresh = deferred<void>();
    const harness = createControllerHarness({
      codexStatus: { status: "checking", message: "Checking", modelAvailable: false },
      initialCodexRefresh: refresh.promise
    });

    const start = harness.controller.startRecording("test");
    await Promise.resolve();
    expect(harness.controller.session.status).toBe("idle");

    harness.setCodexStatus({ status: "signed_out", message: "Sign in required", modelAvailable: false });
    refresh.resolve();
    await start;

    expect(harness.controller.session.status).toBe("recording");
    expect(harness.controller.sessionOperation?.plan.llmProvider).toBeUndefined();
    expect(harness.storage.resolveLlmProviderSecret).not.toHaveBeenCalled();
  });

  it("invalidates a pending provider refresh when local data is cleared", async () => {
    const refresh = deferred<void>();
    const harness = createControllerHarness({
      codexStatus: { status: "checking", message: "Checking", modelAvailable: false },
      initialCodexRefresh: refresh.promise
    });

    const start = harness.controller.startRecording("test");
    await Promise.resolve();
    await harness.controller.clearLocalData();
    refresh.resolve();
    await start;

    expect(harness.storage.clearLocalData).toHaveBeenCalledOnce();
    expect(harness.controller.session.status).toBe("idle");
    expect(harness.controller.sessionOperation).toBeNull();
    expect(harness.mainWindowSend).not.toHaveBeenCalledWith("recording:start", expect.anything());
  });

  it("blocks new recordings until local-data clearing finishes", async () => {
    const harness = createControllerHarness();
    const logout = deferred<CodexProviderRuntime>();
    harness.codex.logout.mockReturnValueOnce(logout.promise);

    const clearing = harness.controller.clearLocalData();
    await vi.waitFor(() => expect(harness.codex.logout).toHaveBeenCalledOnce());
    await harness.controller.startRecording("during-clear");

    expect(harness.controller.session.status).toBe("idle");
    expect(harness.mainWindowSend).not.toHaveBeenCalledWith("recording:start", expect.anything());

    logout.resolve({ status: "signed_out", message: "Signed out", modelAvailable: false });
    await clearing;
    await harness.controller.startRecording("after-clear");

    expect(harness.controller.session.status).toBe("recording");
    expect(harness.mainWindowSend).toHaveBeenCalledWith(
      "recording:start",
      expect.objectContaining({ sessionId: harness.controller.session.id })
    );
  });

  it("stops a cancelled STT continuation before LLM, paste, or history", async () => {
    const harness = createControllerHarness();
    const transcription = deferred<TranscriptionResult>();
    harness.stt.transcribe.mockReturnValueOnce(transcription.promise);
    const sessionId = await startAndStop(harness.controller);

    const completion = harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });
    await vi.waitFor(() => expect(harness.stt.transcribe).toHaveBeenCalledOnce());
    const signal = harness.stt.transcribe.mock.calls[0]?.[0]?.signal as AbortSignal;
    await harness.controller.cancelRecording();
    transcription.resolve(transcriptionResult);
    await completion;

    expect(signal.aborted).toBe(true);
    expect(harness.controller.session.status).toBe("cancelled");
    expect(harness.llm.process).not.toHaveBeenCalled();
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).not.toHaveBeenCalled();
  });

  it("stops a cancelled LLM continuation before paste or history", async () => {
    const harness = createControllerHarness();
    const processing = deferred<{ text: string; providerId?: string; model?: string }>();
    harness.llm.process.mockReturnValueOnce(processing.promise);
    const sessionId = await startAndStop(harness.controller);

    const completion = harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });
    await vi.waitFor(() => expect(harness.llm.process).toHaveBeenCalledOnce());
    const signal = harness.llm.process.mock.calls[0]?.[0]?.signal as AbortSignal;
    await harness.controller.cancelRecording();
    processing.resolve({ text: "stale processed text", providerId: "codex", model: "test-llm" });
    await completion;

    expect(signal.aborted).toBe(true);
    expect(harness.controller.session.status).toBe("cancelled");
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).not.toHaveBeenCalled();
  });

  it("does not let cancellation during history insertion finalize the session", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const sessionId = await startAndStop(harness.controller);
    harness.storage.addHistory.mockImplementationOnce(() => {
      void harness.controller.cancelRecording();
    });

    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.paste.insertText).toHaveBeenCalledOnce();
    expect(harness.storage.addHistory).toHaveBeenCalledOnce();
    expect(harness.controller.session.status).toBe("cancelled");
  });

  it("aborts an active STT continuation when local data is cleared", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const transcription = deferred<TranscriptionResult>();
    harness.stt.transcribe.mockReturnValueOnce(transcription.promise);
    const sessionId = await startAndStop(harness.controller);

    const completion = harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });
    await vi.waitFor(() => expect(harness.stt.transcribe).toHaveBeenCalledOnce());
    const signal = harness.stt.transcribe.mock.calls[0]?.[0]?.signal as AbortSignal;
    await harness.controller.clearLocalData();
    transcription.resolve(transcriptionResult);
    await completion;

    expect(signal.aborted).toBe(true);
    expect(harness.storage.clearLocalData).toHaveBeenCalledOnce();
    expect(harness.controller.session.status).toBe("idle");
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).not.toHaveBeenCalled();
  });

  it("aborts an active LLM continuation during shutdown", async () => {
    const harness = createControllerHarness();
    const processing = deferred<{ text: string; providerId?: string; model?: string }>();
    harness.llm.process.mockReturnValueOnce(processing.promise);
    const sessionId = await startAndStop(harness.controller);

    const completion = harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });
    await vi.waitFor(() => expect(harness.llm.process).toHaveBeenCalledOnce());
    const signal = harness.llm.process.mock.calls[0]?.[0]?.signal as AbortSignal;
    harness.controller.dispose();
    processing.resolve({ text: "stale processed text", providerId: "codex", model: "test-llm" });
    await completion;

    expect(signal.aborted).toBe(true);
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).not.toHaveBeenCalled();
  });

  it("keeps a replacement recording authoritative when an old finalizer resolves", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const transcription = deferred<TranscriptionResult>();
    harness.stt.transcribe.mockReturnValueOnce(transcription.promise);
    const oldSessionId = await startAndStop(harness.controller);
    const oldCompletion = harness.controller.completeRecording({
      sessionId: oldSessionId,
      audio: new ArrayBuffer(1),
      mimeType: "audio/wav"
    });
    await vi.waitFor(() => expect(harness.stt.transcribe).toHaveBeenCalledOnce());

    await harness.controller.cancelRecording();
    await harness.controller.startRecording("replacement");
    const replacementSessionId = harness.controller.session.id;
    expect(replacementSessionId).not.toBe(oldSessionId);
    expect(harness.controller.session.status).toBe("recording");

    transcription.resolve(transcriptionResult);
    await oldCompletion;

    expect(harness.controller.session.id).toBe(replacementSessionId);
    expect(harness.controller.session.status).toBe("recording");
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).not.toHaveBeenCalled();
  });
});
