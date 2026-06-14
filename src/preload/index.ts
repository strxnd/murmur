import type { IpcRendererEvent } from "electron";
import type {
  AppSettings,
  AppStateSnapshot,
  AutoModeRule,
  LlmProviderConfig,
  ModelDownloadState,
  ModelLibrarySnapshot,
  ModeConfig,
  ProviderValidationResult,
  ReplacementRule,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../shared/types";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = {
  getState: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("app:get-state"),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppStateSnapshot> => ipcRenderer.invoke("settings:update", patch),
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
  setAutoModeRules: (rules: AutoModeRule[]): Promise<AppStateSnapshot> => ipcRenderer.invoke("rules:set-auto-mode", rules),
  setReplacements: (replacements: ReplacementRule[]): Promise<AppStateSnapshot> =>
    ipcRenderer.invoke("replacements:set", replacements),
  setVocabulary: (vocabulary: VocabularyEntry[]): Promise<AppStateSnapshot> => ipcRenderer.invoke("vocabulary:set", vocabulary),
  getModelLibrary: (): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:get-library"),
  downloadModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:download", modelId),
  deleteDownloadedModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:delete", modelId),
  toggleFavoriteModel: (modelId: string): Promise<ModelLibrarySnapshot> => ipcRenderer.invoke("models:toggle-favorite", modelId),
  startDictation: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("dictation:start"),
  stopDictation: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("dictation:stop"),
  cancelDictation: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("dictation:cancel"),
  completeRecording: (payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> =>
    ipcRenderer.invoke("dictation:complete-recording", payload),
  copyHistoryOutput: (text: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("history:copy", text),
  repasteHistoryOutput: (text: string): Promise<{ pasted: boolean; message: string }> =>
    ipcRenderer.invoke("history:repaste", text),
  deleteHistoryItem: (id: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("history:delete", id),
  clearHistory: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("history:clear"),
  reprocessHistoryItem: (id: string): Promise<AppStateSnapshot> => ipcRenderer.invoke("history:reprocess", id),
  clearLocalData: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("data:clear-local"),
  onStateChanged: (callback: (state: AppStateSnapshot) => void) => {
    const listener = (_event: IpcRendererEvent, state: AppStateSnapshot): void => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => {
      ipcRenderer.removeListener("state:changed", listener);
    };
  },
  onRecordingStart: (callback: (payload: { sessionId: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { sessionId: string }): void => callback(payload);
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
  }
};

contextBridge.exposeInMainWorld("murmur", api);

export type MurmurApi = typeof api;
