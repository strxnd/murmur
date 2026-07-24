import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AppSettings,
  AppStateSnapshot,
  AutomationPermissionReport,
  AutoModeRule,
  LlmProviderConfig,
  ModelDownloadState,
  ModelLibrarySnapshot,
  ModeSelectorStateSnapshot,
  ModeConfig,
  PillStateSnapshot,
  ProviderValidationResult,
  RecordingLevelPayload,
  RecordingStartPayload,
  SttRuntimeActionTarget,
  SttRuntimeInstallState,
  SttSetupSnapshot,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../shared/types";

const api = {
  getState: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("app:get-state"),
  getPillState: (): Promise<PillStateSnapshot> => ipcRenderer.invoke("app:get-pill-state"),
  getModeSelectorState: (): Promise<ModeSelectorStateSnapshot> => ipcRenderer.invoke("app:get-mode-selector-state"),
  getAutomationPermissionStatus: (): Promise<AutomationPermissionReport> => ipcRenderer.invoke("automation:permission-status"),
  requestAutomationPermission: (): Promise<AutomationPermissionReport> => ipcRenderer.invoke("automation:permission-request"),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppStateSnapshot> => ipcRenderer.invoke("settings:update", patch),
  beginHotkeyCapture: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("hotkeys:capture-start"),
  endHotkeyCapture: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("hotkeys:capture-end"),
  setModes: (modes: ModeConfig[]): Promise<AppStateSnapshot> => ipcRenderer.invoke("modes:set", modes),
  activateMode: (modeId: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("mode:activate", modeId),
  setSttProviders: (providers: TranscriptionProviderConfig[]): Promise<AppStateSnapshot> =>
    ipcRenderer.invoke("providers:set-stt", providers),
  setLlmProviders: (providers: LlmProviderConfig[]): Promise<AppStateSnapshot> =>
    ipcRenderer.invoke("providers:set-llm", providers),
  validateSttProvider: (provider: TranscriptionProviderConfig): Promise<ProviderValidationResult> =>
    ipcRenderer.invoke("provider:validate-stt", provider),
  validateLlmProvider: (provider: LlmProviderConfig): Promise<ProviderValidationResult> =>
    ipcRenderer.invoke("provider:validate-llm", provider),
  refreshCodex: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("codex:refresh"),
  startCodexLogin: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("codex:login-start"),
  cancelCodexLogin: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("codex:login-cancel"),
  logoutCodex: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("codex:logout"),
  setAutoModeRules: (rules: AutoModeRule[]): Promise<AppStateSnapshot> => ipcRenderer.invoke("rules:set-auto-mode", rules),
  setVocabulary: (vocabulary: VocabularyEntry[]): Promise<AppStateSnapshot> => ipcRenderer.invoke("vocabulary:set", vocabulary),
  getModelLibrary: (): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:get-library"),
  downloadModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:download", modelId),
  cancelModelDownload: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:cancel-download", modelId),
  activateModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:activate", modelId),
  deleteDownloadedModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:delete", modelId),
  toggleFavoriteModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:toggle-favorite", modelId),
  getSttSetup: (): Promise<SttSetupSnapshot> => ipcRenderer.invoke("stt-setup:get"),
  downloadSttRuntime: (target: SttRuntimeActionTarget): Promise<SttSetupSnapshot> => ipcRenderer.invoke("stt-runtime:download", target),
  repairSttRuntime: (target: SttRuntimeActionTarget): Promise<SttSetupSnapshot> => ipcRenderer.invoke("stt-runtime:repair", target),
  cancelSttRuntimeDownload: (target: SttRuntimeActionTarget): Promise<SttSetupSnapshot> =>
    ipcRenderer.invoke("stt-runtime:cancel-download", target),
  setupBundledStt: (modelId: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("stt-setup:setup-bundled", modelId),
  skipSttSetup: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("stt-setup:skip"),
  setRecordingCaptureReady: (ready: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke("recording:capture-ready", { ready }),
  startDictation: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("dictation:start"),
  stopDictation: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("dictation:stop"),
  cancelDictation: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("dictation:cancel"),
  completeRecording: (payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> =>
    ipcRenderer.invoke("dictation:complete-recording", payload),
  reportRecordingError: (payload: { sessionId: string; message: string }): Promise<AppStateSnapshot> =>
    ipcRenderer.invoke("dictation:recording-error", payload),
  publishRecordingLevel: (payload: RecordingLevelPayload): void => {
    ipcRenderer.send("recording:level", payload);
  },
  testPaste: (text: string): Promise<{ pasted: boolean; message: string }> => ipcRenderer.invoke("onboarding:test-paste", text),
  setOnboardingDictationScope: (active: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke("onboarding:dictation-scope", { active }),
  copyHistoryOutput: (text: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("history:copy", text),
  repasteHistoryOutput: (text: string): Promise<{ pasted: boolean; message: string }> =>
    ipcRenderer.invoke("history:repaste", text),
  deleteHistoryItem: (id: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("history:delete", id),
  clearHistory: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("history:clear"),
  reprocessHistoryItem: (id: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("history:reprocess", id),
  clearLocalData: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("data:clear-local"),
  hideModeSelector: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("mode-selector:hide"),
  selectModeFromSelector: (modeId: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("mode-selector:select-mode", modeId),
  moveModeSelectorSelection: (delta: number): Promise<ModeSelectorStateSnapshot> => ipcRenderer.invoke("mode-selector:move-selection", delta),
  onStateChanged: (callback: (state: AppStateSnapshot) => void) => {
    const listener = (_event: IpcRendererEvent, state: AppStateSnapshot): void => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => {
      ipcRenderer.removeListener("state:changed", listener);
    };
  },
  onPillStateChanged: (callback: (state: PillStateSnapshot) => void) => {
    const listener = (_event: IpcRendererEvent, state: PillStateSnapshot): void => callback(state);
    ipcRenderer.on("pill-state:changed", listener);
    return () => {
      ipcRenderer.removeListener("pill-state:changed", listener);
    };
  },
  onModeSelectorStateChanged: (callback: (state: ModeSelectorStateSnapshot) => void) => {
    const listener = (_event: IpcRendererEvent, state: ModeSelectorStateSnapshot): void => callback(state);
    ipcRenderer.on("mode-selector-state:changed", listener);
    return () => {
      ipcRenderer.removeListener("mode-selector-state:changed", listener);
    };
  },
  onRecordingStart: (callback: (payload: RecordingStartPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: RecordingStartPayload): void => callback(payload);
    ipcRenderer.on("recording:start", listener);
    return () => {
      ipcRenderer.removeListener("recording:start", listener);
    };
  },
  onRecordingStop: (callback: (payload: { sessionId: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { sessionId: string }): void => callback(payload);
    ipcRenderer.on("recording:stop", listener);
    return () => {
      ipcRenderer.removeListener("recording:stop", listener);
    };
  },
  onRecordingCancel: (callback: (payload: { sessionId: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { sessionId: string }): void => callback(payload);
    ipcRenderer.on("recording:cancel", listener);
    return () => {
      ipcRenderer.removeListener("recording:cancel", listener);
    };
  },
  onRecordingLevel: (callback: (payload: RecordingLevelPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: RecordingLevelPayload): void => callback(payload);
    ipcRenderer.on("recording:level", listener);
    return () => {
      ipcRenderer.removeListener("recording:level", listener);
    };
  },
  onTranscriptDelta: (callback: (delta: string) => void) => {
    const listener = (_event: IpcRendererEvent, delta: string): void => callback(delta);
    ipcRenderer.on("dictation:transcript-delta", listener);
    return () => {
      ipcRenderer.removeListener("dictation:transcript-delta", listener);
    };
  },
  onModelDownloadProgress: (callback: (state: ModelDownloadState) => void) => {
    const listener = (_event: IpcRendererEvent, state: ModelDownloadState): void => callback(state);
    ipcRenderer.on("models:download-progress", listener);
    return () => {
      ipcRenderer.removeListener("models:download-progress", listener);
    };
  },
  onSttRuntimeProgress: (callback: (state: SttRuntimeInstallState) => void) => {
    const listener = (_event: IpcRendererEvent, state: SttRuntimeInstallState): void => callback(state);
    ipcRenderer.on("stt-runtime:progress", listener);
    return () => {
      ipcRenderer.removeListener("stt-runtime:progress", listener);
    };
  }
};

export type MurmurApi = typeof api;
export type PreloadRendererRole = "main" | "pill" | "mode-selector";

const auxiliaryOnlyApiKeys = {
  pill: ["getPillState", "onPillStateChanged"],
  "mode-selector": [
    "getModeSelectorState",
    "hideModeSelector",
    "selectModeFromSelector",
    "moveModeSelectorSelection",
    "onModeSelectorStateChanged"
  ]
} as const satisfies Record<Exclude<PreloadRendererRole, "main">, ReadonlyArray<keyof MurmurApi>>;

const mainExcludedApiKeys = new Set<keyof MurmurApi>(Object.values(auxiliaryOnlyApiKeys).flat());
const auxiliaryApiKeys: Record<Exclude<PreloadRendererRole, "main">, ReadonlyArray<keyof MurmurApi>> = {
  pill: [...auxiliaryOnlyApiKeys.pill, "onRecordingLevel"],
  "mode-selector": auxiliaryOnlyApiKeys["mode-selector"]
};

export function rendererRoleFromArguments(args: string[]): PreloadRendererRole {
  const argument = args.find((value) => value.startsWith("--murmur-renderer-role="));
  const role = argument?.slice("--murmur-renderer-role=".length);
  return role === "pill" || role === "mode-selector" ? role : "main";
}

export function selectPreloadApi(role: PreloadRendererRole): Partial<MurmurApi> {
  const keys =
    role === "main"
      ? (Object.keys(api) as Array<keyof MurmurApi>).filter((key) => !mainExcludedApiKeys.has(key))
      : auxiliaryApiKeys[role];
  return Object.fromEntries(keys.map((key) => [key, api[key]])) as Partial<MurmurApi>;
}

contextBridge.exposeInMainWorld("murmur", selectPreloadApi(rendererRoleFromArguments(process.argv)));
