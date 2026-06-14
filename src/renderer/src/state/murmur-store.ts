import { create } from "zustand";
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
} from "../../../shared/types";
import { murmurClient } from "../lib/murmur-client";

type LoadStatus = "loading" | "ready" | "error";

interface MurmurStore {
  status: LoadStatus;
  snapshot: AppStateSnapshot | null;
  error: string | null;
  init: () => Promise<void>;
  dispose: () => void;
  refresh: () => Promise<void>;
  setSnapshot: (snapshot: AppStateSnapshot) => void;
  activateMode: (modeId: string) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setModes: (modes: ModeConfig[]) => Promise<void>;
  setSttProviders: (providers: TranscriptionProviderConfig[]) => Promise<void>;
  setLlmProviders: (providers: LlmProviderConfig[]) => Promise<void>;
  validateSttProvider: (provider: TranscriptionProviderConfig) => Promise<ProviderValidationResult>;
  validateLlmProvider: (provider: LlmProviderConfig) => Promise<ProviderValidationResult>;
  setAutoModeRules: (rules: AutoModeRule[]) => Promise<void>;
  setVocabulary: (entries: VocabularyEntry[]) => Promise<void>;
  setReplacements: (rules: ReplacementRule[]) => Promise<void>;
  getModelLibrary: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
  deleteDownloadedModel: (modelId: string) => Promise<void>;
  toggleFavoriteModel: (modelId: string) => Promise<void>;
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<void>;
  cancelDictation: () => Promise<void>;
  copyHistoryOutput: (text: string) => Promise<void>;
  repasteHistoryOutput: (text: string) => Promise<string>;
  deleteHistoryItem: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  reprocessHistoryItem: (id: string) => Promise<void>;
  clearLocalData: () => Promise<void>;
}

let unsubscribeState: (() => void) | null = null;
let unsubscribeModelProgress: (() => void) | null = null;

export const useMurmurStore = create<MurmurStore>()((set, get) => {
  const commit = async (operation: () => Promise<AppStateSnapshot>): Promise<void> => {
    try {
      const snapshot = await operation();
      set({ snapshot, status: "ready", error: null });
    } catch (error) {
      set({ status: get().snapshot ? "ready" : "error", error: errorMessage(error) });
      throw error;
    }
  };
  const commitLibrary = async (operation: () => Promise<ModelLibrarySnapshot>): Promise<void> => {
    try {
      const modelLibrary = await operation();
      set((current) => ({
        snapshot: current.snapshot ? { ...current.snapshot, modelLibrary } : current.snapshot,
        status: current.snapshot ? "ready" : current.status,
        error: null
      }));
    } catch (error) {
      set({ status: get().snapshot ? "ready" : "error", error: errorMessage(error) });
      throw error;
    }
  };

  return {
    status: "loading",
    snapshot: null,
    error: null,
    init: async () => {
      if (unsubscribeState) return;
      await commit(() => murmurClient.getState());
      unsubscribeState = murmurClient.onStateChanged((snapshot) => {
        set({ snapshot, status: "ready", error: null });
      });
      unsubscribeModelProgress = murmurClient.onModelDownloadProgress((download) => {
        set((current) => ({
          snapshot: current.snapshot ? upsertDownload(current.snapshot, download) : current.snapshot,
          status: current.snapshot ? "ready" : current.status,
          error: null
        }));
      });
    },
    dispose: () => {
      unsubscribeState?.();
      unsubscribeModelProgress?.();
      unsubscribeState = null;
      unsubscribeModelProgress = null;
    },
    refresh: () => commit(() => murmurClient.getState()),
    setSnapshot: (snapshot) => set({ snapshot, status: "ready", error: null }),
    activateMode: (modeId) => commit(() => murmurClient.activateMode(modeId)),
    updateSettings: (patch) => commit(() => murmurClient.updateSettings(patch)),
    setModes: (modes) => commit(() => murmurClient.setModes(modes)),
    setSttProviders: (providers) => commit(() => murmurClient.setSttProviders(providers)),
    setLlmProviders: (providers) => commit(() => murmurClient.setLlmProviders(providers)),
    validateSttProvider: (provider) => murmurClient.validateSttProvider(provider),
    validateLlmProvider: (provider) => murmurClient.validateLlmProvider(provider),
    setAutoModeRules: (rules) => commit(() => murmurClient.setAutoModeRules(rules)),
    setVocabulary: (entries) => commit(() => murmurClient.setVocabulary(entries)),
    setReplacements: (rules) => commit(() => murmurClient.setReplacements(rules)),
    getModelLibrary: () => commitLibrary(() => murmurClient.getModelLibrary()),
    downloadModel: (modelId) => commitLibrary(() => murmurClient.downloadModel(modelId)),
    deleteDownloadedModel: (modelId) => commitLibrary(() => murmurClient.deleteDownloadedModel(modelId)),
    toggleFavoriteModel: (modelId) => commitLibrary(() => murmurClient.toggleFavoriteModel(modelId)),
    startDictation: () => commit(() => murmurClient.startDictation()),
    stopDictation: () => commit(() => murmurClient.stopDictation()),
    cancelDictation: () => commit(() => murmurClient.cancelDictation()),
    copyHistoryOutput: async (text) => {
      await murmurClient.copyHistoryOutput(text);
    },
    repasteHistoryOutput: async (text) => {
      const result = await murmurClient.repasteHistoryOutput(text);
      return result.message;
    },
    deleteHistoryItem: (id) => commit(() => murmurClient.deleteHistoryItem(id)),
    clearHistory: () => commit(() => murmurClient.clearHistory()),
    reprocessHistoryItem: (id) => commit(() => murmurClient.reprocessHistoryItem(id)),
    clearLocalData: () => commit(() => murmurClient.clearLocalData())
  };
});

function upsertDownload(snapshot: AppStateSnapshot, download: ModelDownloadState): AppStateSnapshot {
  const downloads = snapshot.modelLibrary.downloads.filter((candidate) => candidate.modelId !== download.modelId);
  return {
    ...snapshot,
    modelLibrary: {
      ...snapshot.modelLibrary,
      downloads: [download, ...downloads]
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
