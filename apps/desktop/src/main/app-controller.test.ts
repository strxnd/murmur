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
  AppSettings,
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
  calculateModeSelectorBounds,
  computeDurationMs,
  countWords,
  isAllowedRendererPermission,
  isSameOutputTarget,
  rendererQueryFromSuffix,
  selectLlmProviderAfterInitialRefresh,
  shouldPersistDictationHistory,
  shouldRecoverRenderer,
  wrapIndex
} from "./app-controller";
import { DictationSessionOwner, type DictationSessionOperation } from "./services/dictation-session";
import { app, BrowserWindow, globalShortcut, ipcMain, session } from "./electron-api";

vi.mock("./electron-api", () => ({
  app: {
    getPath: () => "/tmp/murmur-tests",
    getVersion: () => "0.1.0",
    isPackaged: false,
    quit: vi.fn()
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
  session: {
    defaultSession: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn()
    }
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
  windowId: "window-1",
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
  registerIpc(): void;
  captureRecordingContext(operation: DictationSessionOperation): Promise<typeof capturedContext>;
  completeRecording(payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot>;
  ensureAutomationReadyForUserAction: ReturnType<typeof vi.fn>;
  dispose(): Promise<void>;
}

interface ControllerHarness {
  controller: TestController;
  state: ReturnType<typeof createPersistedState>;
  storage: {
    addHistory: ReturnType<typeof vi.fn>;
    clearLocalData: ReturnType<typeof vi.fn>;
    resolveLlmProviderSecret: ReturnType<typeof vi.fn>;
  };
  stt: {
    transcribe: ReturnType<typeof vi.fn>;
    stopRuntime: ReturnType<typeof vi.fn>;
    clearLocalData: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  sttSetup: { setupBundledStt: ReturnType<typeof vi.fn> };
  llm: { process: ReturnType<typeof vi.fn> };
  paste: { copyText: ReturnType<typeof vi.fn>; insertText: ReturnType<typeof vi.fn> };
  codex: { logout: ReturnType<typeof vi.fn> };
  contextCapture: ReturnType<typeof vi.fn>;
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
    settings: {
      ...defaultSettings,
      activeModeId: mode.id,
      selectedTextCapture: "disabled" as AppSettings["selectedTextCapture"]
    },
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
    stopRuntime: vi.fn(async () => undefined),
    clearLocalData: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  };
  const sttSetup = {
    getSnapshot: vi.fn(),
    setupBundledStt: vi.fn(async () => undefined),
    skipSttSetup: vi.fn()
  };
  const llm = {
    process: vi.fn(async () => ({ text: "processed transcript", providerId: "codex", model: "test-llm" }))
  };
  const paste = {
    copyText: vi.fn(async () => ({ pasted: false, message: "Automatic paste was skipped; output left on the clipboard." })),
    insertText: vi.fn(
      async (
        _text: string,
        _signal?: AbortSignal,
        beforePaste?: () => Promise<{ allowed: boolean; message?: string }>
      ) => {
        const guardResult = await beforePaste?.();
        return guardResult && !guardResult.allowed
          ? { pasted: false, message: guardResult.message ?? "", clipboardRetained: true }
          : { pasted: true, message: "", clipboardRetained: false };
      }
    ),
    getDiagnostics: vi.fn(() => [])
  };
  const codex = {
    getStatus: vi.fn(() => ({ ...codexStatus })),
    logout: vi.fn(async () => ({ ...codexStatus })),
    dispose: vi.fn()
  };
  const contextCapture = vi.fn(async () => currentContext);

  const controller = Object.create(AppController.prototype) as TestController & Record<string, unknown>;
  Object.assign(controller, {
    mainWindow: { webContents: { send: mainWindowSend } },
    pillWindow: null,
    modeSelectorWindow: null,
    tray: null,
    closeToTrayNotification: null,
    storage,
    textAutomation: { dispose: vi.fn(), getCapability: vi.fn() },
    context: { capture: contextCapture, dispose: vi.fn() },
    paste,
    automationPermissions: {},
    runtimeService: {},
    accelerationProbe: {},
    portalHotkeys: { dispose: vi.fn() },
    nativeHotkeys: { dispose: vi.fn() },
    macosReleaseHotkeys: { unregister: vi.fn() },
    paths: { modelDir: "/tmp/murmur-test-models" },
    stt,
    sttSetup,
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
    hotkeyCaptureLeases: new Map(),
    onboardingDictationLeases: new Set(),
    rendererRoles: new Map(),
    rendererRecoveryAttempts: new Map(),
    ipcHandlerChannels: new Set(),
    ipcEventListeners: new Map(),
    disposePromise: null,
    permissionPolicyInstalled: false,
    ensureAutomationReadyForUserAction: vi.fn(() => ({ ready: true })),
    assertTrustedIpcSender: vi.fn(),
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
    unregisterIpc: vi.fn(),
    clearPermissionPolicy: vi.fn(),
    destroyOwnedWindows: vi.fn(),
    getSnapshot: vi.fn(() => ({ ...state, session: controller.session }) as unknown as AppStateSnapshot),
    notifyPasteFallback: vi.fn(),
    notifyHistoryPersistenceFailure: vi.fn()
  });

  return {
    controller,
    state,
    storage,
    stt,
    sttSetup,
    llm,
    paste,
    codex,
    contextCapture,
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
    expect(isSameOutputTarget(capturedContext, { ...capturedContext, windowId: "window-2" })).toBe(false);
    expect(isSameOutputTarget(capturedContext, { ...capturedContext, windowId: undefined })).toBe(false);
    expect(
      isSameOutputTarget(
        { ...capturedContext, windowTitle: undefined },
        { ...capturedContext, windowTitle: "Other Window" }
      )
    ).toBe(false);
    expect(isSameOutputTarget(capturedContext, { ...capturedContext, windowTitle: undefined })).toBe(false);
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

describe("AppController lifecycle and window ownership", () => {
  it("keeps quit reversible until renderer unload guards approve closure", () => {
    const tray = { destroy: vi.fn(), setContextMenu: vi.fn() };
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      isQuitting: false,
      disposePromise: null,
      tray,
      closeToTrayNotification: null,
      refreshTrayMenu: vi.fn()
    });

    (controller as unknown as { requestQuit(): void }).requestQuit();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(tray.destroy).not.toHaveBeenCalled();

    controller.prepareToQuit();
    controller.cancelQuit();
    expect(controller).toMatchObject({ isQuitting: false, tray });

    const listeners = new Map<string, () => void>();
    const cancelQuit = vi.fn();
    Object.assign(controller, {
      rendererSource: { kind: "packaged", filePath: "/tmp/index.html" },
      cancelQuit
    });
    (controller as unknown as { attachWindowDiagnostics(window: unknown, role: string): void }).attachWindowDiagnostics(
      { webContents: { id: 1, on: (event: string, listener: () => void) => listeners.set(event, listener) } },
      "main"
    );
    listeners.get("will-prevent-unload")?.();
    expect(cancelQuit).toHaveBeenCalledOnce();
  });

  it("awaits initial renderer navigation before initialization succeeds", async () => {
    const navigationFailure = new Error("renderer missing");
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    const registerHotkeys = vi.fn(async () => undefined);
    Object.assign(controller, {
      automationPermissions: { initialize: vi.fn(async () => undefined) },
      textAutomation: { initialize: vi.fn(async () => undefined) },
      context: { initialize: vi.fn(async () => undefined) },
      paste: { initialize: vi.fn(async () => undefined) },
      registerIpc: vi.fn(),
      configureSessionPermissions: vi.fn(),
      codex: { refreshStatus: vi.fn(async () => undefined) },
      createTray: vi.fn(),
      createWindows: vi.fn(async () => Promise.reject(navigationFailure)),
      storage: { getState: vi.fn() },
      registerHotkeys
    });

    await expect(controller.initialize()).rejects.toBe(navigationFailure);
    expect(registerHotkeys).not.toHaveBeenCalled();
  });

  it("stops initialization after Quit marks the constructing controller", async () => {
    const firstStep = deferred<void>();
    const textInitialize = vi.fn(async () => undefined);
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      isQuitting: false,
      disposePromise: null,
      automationPermissions: { initialize: vi.fn(() => firstStep.promise) },
      textAutomation: { initialize: textInitialize }
    });

    const initialization = controller.initialize();
    controller.prepareToQuit();
    firstStep.resolve();

    await expect(initialization).rejects.toThrow("startup was cancelled");
    expect(textInitialize).not.toHaveBeenCalled();
  });

  it("recovers unexpected renderer loss but not expected termination", async () => {
    expect(shouldRecoverRenderer("crashed", false)).toBe(true);
    expect(shouldRecoverRenderer("clean-exit", false)).toBe(false);
    expect(shouldRecoverRenderer("killed", false)).toBe(true);
    expect(shouldRecoverRenderer("crashed", true)).toBe(false);

    const loadRenderer = vi.fn(async () => undefined);
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      isQuitting: false,
      rendererRecoveryAttempts: new Map(),
      loadRenderer,
      invalidateFailedWindow: vi.fn()
    });
    const window = { isDestroyed: vi.fn(() => false) };

    await (controller as unknown as {
      recoverRenderer(window: unknown, role: string, reason: string): Promise<void>;
    }).recoverRenderer(window, "pill", "crashed");

    expect(loadRenderer).toHaveBeenCalledWith(window, "?pill=1");
  });

  it("releases renderer-owned transient leases when the renderer disappears", () => {
    const registerHotkeys = vi.fn(async () => undefined);
    const broadcastState = vi.fn();
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      hotkeyCaptureLeases: new Map([[41, 2]]),
      onboardingDictationLeases: new Set([41]),
      isQuitting: false,
      registerHotkeys,
      broadcastState
    });

    (controller as unknown as { releaseRendererLeases(senderId: number): void }).releaseRendererLeases(41);

    expect(controller).toMatchObject({
      hotkeyCaptureLeases: new Map(),
      onboardingDictationLeases: new Set()
    });
    expect(registerHotkeys).toHaveBeenCalledOnce();
  });

  it("keeps selector navigation local and hides the selector when it loses focus", async () => {
    vi.mocked(globalShortcut.register).mockClear();
    const listeners = new Map<string, () => void>();
    const hide = vi.fn();
    const window = {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      hide,
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      webContents: { id: 52 }
    };
    vi.mocked(BrowserWindow).mockImplementationOnce(function MockBrowserWindow() {
      return window as never;
    });
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      modeSelectorWindow: null,
      configureTrustedRendererWindow: vi.fn(),
      attachWindowDiagnostics: vi.fn(),
      configureModeSelectorWindow: vi.fn(),
      loadRenderer: vi.fn(async () => undefined),
      releaseRendererOwnership: vi.fn()
    });

    await (controller as unknown as { createModeSelectorWindow(): Promise<void> }).createModeSelectorWindow();
    listeners.get("blur")?.();

    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledOnce();
  });

  it("enforces role-specific channels for owned renderer senders", () => {
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      rendererRoles: new Map([[9, "pill"]]),
      rendererSource: { kind: "dev", url: "http://127.0.0.1:5173", filePath: "/unused" }
    });
    const event = {
      sender: { id: 9, getURL: () => "http://127.0.0.1:5173/?pill=1" },
      senderFrame: { url: "http://127.0.0.1:5173/?pill=1" }
    };
    const authorize = (channel: string): void =>
      (controller as unknown as { assertTrustedIpcSender(event: unknown, channel: string): void }).assertTrustedIpcSender(
        event,
        channel
      );

    expect(() => authorize("app:get-pill-state")).not.toThrow();
    expect(() => authorize("settings:update")).toThrow("Unauthorized IPC sender");
  });

  it("rejects unsupported macOS push-to-talk shortcuts before persistence", async () => {
    const harness = createControllerHarness();
    const processPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.mocked(ipcMain.handle).mockClear();
    harness.controller.registerIpc();
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "settings:update");
    const updateHandler = registration?.[1] as
      | ((event: unknown, patch: Partial<AppSettings>) => Promise<AppStateSnapshot>)
      | undefined;
    if (!updateHandler) throw new Error("Settings update IPC handler was not registered.");

    await expect(
      updateHandler({}, { activationMode: "push_to_talk", activationHotkey: "CommandOrControl+F8" })
    ).rejects.toThrow('macOS push-to-talk does not support shortcut "CommandOrControl+F8".');

    processPlatform.mockRestore();
  });

  it("allows only trusted main-renderer audio permission requests", () => {
    expect(isAllowedRendererPermission("media", ["audio"])).toBe(true);
    expect(isAllowedRendererPermission("media", ["video"])).toBe(false);
    expect(isAllowedRendererPermission("media", ["audio", "video"])).toBe(false);
    expect(isAllowedRendererPermission("clipboard-read")).toBe(false);

    const requestHandlerSetter = vi.mocked(session.defaultSession.setPermissionRequestHandler);
    requestHandlerSetter.mockClear();
    const controller = Object.create(AppController.prototype) as AppController & Record<string, unknown>;
    Object.assign(controller, {
      rendererRoles: new Map([[7, "main"], [8, "pill"]]),
      rendererSource: { kind: "dev", url: "http://127.0.0.1:5173", filePath: "/unused" },
      permissionPolicyInstalled: false
    });
    (controller as unknown as { configureSessionPermissions(): void }).configureSessionPermissions();
    const requestHandler = requestHandlerSetter.mock.calls[0]?.[0] as unknown as (
      webContents: { id: number; getURL(): string },
      permission: string,
      callback: (allowed: boolean) => void,
      details: { requestingUrl: string; mediaTypes: string[] }
    ) => void;
    const mainCallback = vi.fn();
    const pillCallback = vi.fn();
    requestHandler({ id: 7, getURL: () => "http://127.0.0.1:5173/" }, "media", mainCallback, {
      requestingUrl: "http://127.0.0.1:5173/",
      mediaTypes: ["audio"]
    });
    requestHandler({ id: 8, getURL: () => "http://127.0.0.1:5173/?pill=1" }, "media", pillCallback, {
      requestingUrl: "http://127.0.0.1:5173/?pill=1",
      mediaTypes: ["audio"]
    });

    expect(mainCallback).toHaveBeenCalledWith(true);
    expect(pillCallback).toHaveBeenCalledWith(false);
  });

  it("fits and centers the selector inside small work areas", () => {
    expect(calculateModeSelectorBounds({ x: 100, y: 50, width: 420, height: 300 })).toEqual({
      x: 176,
      y: 66,
      width: 268,
      height: 268
    });
    expect(calculateModeSelectorBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({
      x: 640,
      y: 220,
      width: 640,
      height: 640
    });
  });

  it("does not resolve disposal until asynchronous desktop cleanup completes", async () => {
    const harness = createControllerHarness();
    const cleanup = deferred<void>();
    Object.assign(harness.controller, {
      portalHotkeys: { dispose: vi.fn(() => cleanup.promise) },
      nativeHotkeys: { dispose: vi.fn(async () => undefined) },
      textAutomation: { dispose: vi.fn(async () => undefined) },
      context: { dispose: vi.fn() },
      destroyOwnedWindows: vi.fn(),
      unregisterIpc: vi.fn(),
      clearPermissionPolicy: vi.fn(),
      hotkeyCaptureLeases: new Map(),
      onboardingDictationLeases: new Set(),
      hotkeyRegistrationQueue: Promise.resolve(),
      closeToTrayNotification: null,
      tray: null,
      disposePromise: null
    });

    let settled = false;
    const disposal = harness.controller.dispose().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    cleanup.resolve();
    await disposal;
    expect(settled).toBe(true);
  });

  it("does not register macOS push-to-talk activation before release detection is ready", async () => {
    const harness = createControllerHarness();
    const processPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const portalHotkeys = {
      register: vi.fn(async () => ({
        registered: false,
        diagnostics: [],
        actionResults: {
          activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
          "mode-selector": { registered: false, pushToTalkRelease: false, diagnostics: [] }
        }
      })),
      unregister: vi.fn(async () => undefined)
    };
    const nativeHotkeys = {
      register: vi.fn(async () => ({
        registered: false,
        backend: undefined,
        pushToTalkRelease: false,
        diagnostics: [],
        actionResults: {
          activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
          "mode-selector": { registered: false, pushToTalkRelease: false, diagnostics: [] }
        }
      })),
      unregister: vi.fn(async () => undefined)
    };
    const macosReleaseHotkeys = {
      register: vi.fn(async () => ({ registered: false, diagnostics: ["helper unavailable"] })),
      unregister: vi.fn()
    };
    harness.state.settings.activationMode = "push_to_talk";
    Object.assign(harness.controller, {
      automationPermissions: { status: vi.fn(() => ({ status: "trusted", diagnostics: [] })) },
      portalHotkeys,
      nativeHotkeys,
      macosReleaseHotkeys,
      hotkeyRegistrationGeneration: 0,
      hotkeyRegistrationQueue: Promise.resolve(),
      resetHotkeyCapabilities: vi.fn(),
      hideModeSelectorWindow: vi.fn()
    });
    delete (harness.controller as unknown as Record<string, unknown>).registerHotkeys;
    vi.mocked(globalShortcut.register).mockClear();
    vi.mocked(globalShortcut.isRegistered).mockReturnValue(true);

    await (harness.controller as unknown as { registerHotkeys(): Promise<void> }).registerHotkeys();

    expect(globalShortcut.register).toHaveBeenCalledOnce();
    expect(globalShortcut.register).toHaveBeenCalledWith(harness.state.settings.modeSelectorHotkey, expect.any(Function));
    expect(globalShortcut.register).not.toHaveBeenCalledWith(harness.state.settings.activationHotkey, expect.any(Function));
    expect(macosReleaseHotkeys.unregister).toHaveBeenCalled();
    vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);
    processPlatform.mockRestore();
  });

  it("unregisters activation and stops recording when macOS release detection dies", async () => {
    const harness = createControllerHarness();
    const handleRelease = vi.fn(async () => undefined);
    Object.assign(harness.controller, {
      isQuitting: false,
      hotkeyRegistrationGeneration: 4,
      hotkeyRegistered: true,
      hotkeyPushToTalkRelease: true,
      hotkeyTriggerDescription: "CommandOrControl+Shift+Space",
      macosReleaseHotkeys: { unregister: vi.fn() },
      handlePushToTalkDeactivated: handleRelease
    });
    vi.mocked(globalShortcut.unregister).mockClear();

    (harness.controller as unknown as {
      handleMacosReleaseWatcherUnavailable(generation: number, accelerator: string, diagnostics: string[]): void;
    }).handleMacosReleaseWatcherUnavailable(4, "CommandOrControl+Shift+Space", ["helper exited"]);
    await Promise.resolve();

    expect(globalShortcut.unregister).toHaveBeenCalledWith("CommandOrControl+Shift+Space");
    expect(handleRelease).toHaveBeenCalledOnce();
    expect(harness.controller).toMatchObject({
      hotkeyRegistered: false,
      hotkeyPushToTalkRelease: false,
      hotkeyTriggerDescription: undefined,
      hotkeyDiagnostics: ["helper exited", "Push-to-talk was disabled because macOS release detection stopped."]
    });
  });

  it("quiesces deferred macOS hotkey registration before final cleanup", async () => {
    const harness = createControllerHarness();
    const releaseRegistration = deferred<{
      registered: boolean;
      triggerDescription: string;
      diagnostics: string[];
    }>();
    const processPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const portalHotkeys = {
      register: vi.fn(async () => ({
        registered: false,
        diagnostics: [],
        actionResults: {
          activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
          "mode-selector": { registered: false, pushToTalkRelease: false, diagnostics: [] }
        }
      })),
      unregister: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined)
    };
    const nativeHotkeys = {
      register: vi.fn(async () => ({
        registered: false,
        backend: undefined,
        pushToTalkRelease: false,
        diagnostics: [],
        actionResults: {
          activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
          "mode-selector": { registered: false, pushToTalkRelease: false, diagnostics: [] }
        }
      })),
      unregister: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined)
    };
    const macosReleaseHotkeys = {
      register: vi.fn(() => releaseRegistration.promise),
      unregister: vi.fn()
    };

    harness.state.settings.activationMode = "push_to_talk";
    Object.assign(harness.controller, {
      automationPermissions: { status: vi.fn(() => ({ status: "trusted", diagnostics: [] })) },
      portalHotkeys,
      nativeHotkeys,
      macosReleaseHotkeys,
      hotkeyRegistrationGeneration: 0,
      hotkeyRegistrationQueue: Promise.resolve()
    });
    delete (harness.controller as unknown as Record<string, unknown>).registerHotkeys;

    const registerHotkeys = () =>
      (harness.controller as unknown as { registerHotkeys(): Promise<void> }).registerHotkeys();
    const registration = registerHotkeys();
    await vi.waitFor(() => expect(macosReleaseHotkeys.register).toHaveBeenCalledOnce());
    vi.mocked(globalShortcut.register).mockClear();
    vi.mocked(globalShortcut.unregisterAll).mockClear();
    macosReleaseHotkeys.unregister.mockClear();

    const disposal = harness.controller.dispose();
    const lateRegistration = registerHotkeys();
    await Promise.resolve();
    expect(macosReleaseHotkeys.register).toHaveBeenCalledOnce();
    expect(globalShortcut.unregisterAll).not.toHaveBeenCalled();
    expect(macosReleaseHotkeys.unregister).not.toHaveBeenCalled();

    releaseRegistration.resolve({
      registered: true,
      triggerDescription: "CommandOrControl+Shift+Space",
      diagnostics: []
    });
    await registration;
    await lateRegistration;
    await disposal;

    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(globalShortcut.unregisterAll).toHaveBeenCalled();
    expect(macosReleaseHotkeys.unregister).toHaveBeenCalled();
    processPlatform.mockRestore();
  });
});

describe("AppController STT setup", () => {
  it("waits for the managed runtime to close before replacing bundled STT setup", async () => {
    const harness = createControllerHarness();
    const runtimeStopped = deferred<void>();
    harness.stt.stopRuntime.mockReturnValueOnce(runtimeStopped.promise);
    vi.mocked(ipcMain.handle).mockClear();
    harness.controller.registerIpc();
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "stt-setup:setup-bundled");
    const setupHandler = registration?.[1] as
      | ((event: unknown, modelId: string) => Promise<AppStateSnapshot>)
      | undefined;
    if (!setupHandler) throw new Error("STT setup IPC handler was not registered.");

    const setup = setupHandler({}, "whisper-tiny-en");
    await Promise.resolve();

    expect(harness.stt.stopRuntime).toHaveBeenCalledOnce();
    expect(harness.sttSetup.setupBundledStt).not.toHaveBeenCalled();

    runtimeStopped.resolve();
    await setup;

    expect(harness.sttSetup.setupBundledStt).toHaveBeenCalledWith("whisper-tiny-en");
    expect(harness.stt.stopRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      harness.sttSetup.setupBundledStt.mock.invocationCallOrder[0]
    );
  });
});

describe("AppController shortcut fallback", () => {
  it("keeps a registered activation backend while resolving the mode selector independently", async () => {
    const nativeModeResult = {
      registered: true,
      pushToTalkRelease: false,
      triggerDescription: "ALT+SHIFT+k",
      diagnostics: []
    };
    const controller = Object.create(AppController.prototype) as {
      nativeHotkeys: { register: ReturnType<typeof vi.fn> };
      registerModeSelectorFallback(
        action: {
          id: "mode-selector";
          accelerator: string;
          description: string;
          activationMode: "toggle";
          onActivated: () => void;
          onDeactivated: () => void;
          onPressedWithoutRelease: () => void;
        },
        diagnostics: string[],
        tryNative: boolean
      ): Promise<typeof nativeModeResult>;
    };
    controller.nativeHotkeys = {
      register: vi.fn(async () => ({
        attempted: true,
        registered: true,
        backend: "gnome_custom_shortcut",
        pushToTalkRelease: false,
        diagnostics: [],
        actionResults: {
          activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
          "mode-selector": nativeModeResult
        }
      }))
    };
    vi.mocked(globalShortcut.register).mockClear();

    const result = await controller.registerModeSelectorFallback(
      {
        id: "mode-selector",
        accelerator: "Alt+Shift+K",
        description: "Show Murmur mode selector",
        activationMode: "toggle",
        onActivated: vi.fn(),
        onDeactivated: vi.fn(),
        onPressedWithoutRelease: vi.fn()
      },
      ["portal omitted mode selector"],
      true
    );

    expect(controller.nativeHotkeys.register).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ registered: true, triggerDescription: "ALT+SHIFT+k" });
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });
});

describe("AppController dictation ownership", () => {
  it("requests sensitive context only when both global and mode controls allow it", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    harness.state.settings.selectedTextCapture = "enabled";
    harness.state.modes[0].context = { app: true, selectedText: false, clipboardText: false };
    await harness.controller.startRecording("test");
    const operation = harness.controller.sessionOperation;
    expect(operation).not.toBeNull();

    await harness.controller.captureRecordingContext(operation!);

    const options = harness.contextCapture.mock.calls[0][0] as {
      resolveChannels(metadata: typeof capturedContext): { selectedText: boolean; clipboardText: boolean };
    };
    expect(options.resolveChannels(capturedContext)).toEqual({ selectedText: false, clipboardText: false });

    const globallyDisabled = createControllerHarness({ aiEnabled: false });
    globallyDisabled.state.settings.selectedTextCapture = "disabled";
    globallyDisabled.state.modes[0].context = { app: true, selectedText: true, clipboardText: true };
    await globallyDisabled.controller.startRecording("test");
    await globallyDisabled.controller.captureRecordingContext(globallyDisabled.controller.sessionOperation!);
    const disabledOptions = globallyDisabled.contextCapture.mock.calls[0][0] as typeof options;
    expect(disabledOptions.resolveChannels(capturedContext)).toEqual({ selectedText: false, clipboardText: true });
  });

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

  it("copies output without automation when an identically titled window in the same app becomes active", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const sessionId = await startAndStop(harness.controller);
    harness.setCurrentContext({ ...capturedContext, windowId: "window-2" });

    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.controller.ensureAutomationReadyForUserAction).not.toHaveBeenCalled();
    expect(harness.paste.copyText).toHaveBeenCalledWith("raw transcript", expect.any(AbortSignal));
    expect(harness.paste.insertText).not.toHaveBeenCalled();
    expect(harness.storage.addHistory).toHaveBeenCalledOnce();
    expect(harness.controller.session.status).toBe("complete");
    expect(harness.controller.session.error).toContain("original app or window is no longer active");
  });

  it("copies output without pasting when focus changes during the delivery-critical section", async () => {
    const harness = createControllerHarness({ aiEnabled: false });
    const sessionId = await startAndStop(harness.controller);
    harness.paste.insertText.mockImplementationOnce(async (_text, _signal, beforePaste) => {
      harness.setCurrentContext({
        ...capturedContext,
        appId: "dev.other.app",
        appName: "Other App",
        windowTitle: "Other Window"
      });
      const guardResult = await beforePaste?.();
      return guardResult && !guardResult.allowed
        ? { pasted: false, message: guardResult.message ?? "", clipboardRetained: true }
        : { pasted: true, message: "", clipboardRetained: false };
    });

    await harness.controller.completeRecording({ sessionId, audio: new ArrayBuffer(1), mimeType: "audio/wav" });

    expect(harness.paste.insertText).toHaveBeenCalledOnce();
    expect(harness.paste.copyText).not.toHaveBeenCalled();
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

    expect(harness.stt.clearLocalData).toHaveBeenCalledOnce();
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
    expect(harness.stt.clearLocalData).toHaveBeenCalledOnce();
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
    await harness.controller.dispose();
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
