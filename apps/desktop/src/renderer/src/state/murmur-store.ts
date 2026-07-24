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
  SttRuntimeActionTarget,
  SttRuntimeInstallState,
  SttSetupSnapshot,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../../../shared/types";
import { murmurClient } from "../lib/murmur-client";

type LoadStatus = "loading" | "ready" | "error";

export interface ActionError {
  id: string;
  message: string;
}

interface MurmurStore {
  status: LoadStatus;
  snapshot: AppStateSnapshot | null;
  error: string | null;
  actionError: ActionError | null;
  clearActionError: () => void;
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
  refreshCodex: () => Promise<void>;
  startCodexLogin: () => Promise<void>;
  cancelCodexLogin: () => Promise<void>;
  logoutCodex: () => Promise<void>;
  setAutoModeRules: (rules: AutoModeRule[]) => Promise<void>;
  setVocabulary: (entries: VocabularyEntry[]) => Promise<void>;
  getModelLibrary: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
  cancelModelDownload: (modelId: string) => Promise<void>;
  activateModel: (modelId: string) => Promise<void>;
  deleteDownloadedModel: (modelId: string) => Promise<void>;
  toggleFavoriteModel: (modelId: string) => Promise<void>;
  getSttSetup: () => Promise<void>;
  downloadSttRuntime: (target: SttRuntimeActionTarget) => Promise<void>;
  repairSttRuntime: (target: SttRuntimeActionTarget) => Promise<void>;
  cancelSttRuntimeDownload: (target: SttRuntimeActionTarget) => Promise<void>;
  setupBundledStt: (modelId: string) => Promise<void>;
  skipSttSetup: () => Promise<void>;
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<void>;
  cancelDictation: () => Promise<void>;
  testPaste: (text: string) => Promise<{ pasted: boolean; message: string }>;
  copyHistoryOutput: (text: string) => Promise<void>;
  repasteHistoryOutput: (text: string) => Promise<string>;
  deleteHistoryItem: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  reprocessHistoryItem: (id: string) => Promise<void>;
  clearLocalData: () => Promise<void>;
}

interface StoreInitialization {
  generation: number;
  promise: Promise<void>;
  cancel: () => void;
}

let storeGeneration = 0;
let activeStoreSubscriptions: (() => void) | null = null;
let storeInitialization: StoreInitialization | null = null;

export const useMurmurStore = create<MurmurStore>()((set, get) => {
  const actionErrorFrom = (error: unknown): ActionError => ({
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    message: errorMessage(error)
  });

  const commit = async (operation: () => Promise<AppStateSnapshot>): Promise<void> => {
    try {
      const snapshot = await operation();
      set({ snapshot, status: "ready", error: null, actionError: null });
    } catch (error) {
      const actionError = actionErrorFrom(error);
      set({ status: get().snapshot ? "ready" : "error", error: actionError.message, actionError });
      throw error;
    }
  };
  const commitLibrary = async (operation: () => Promise<ModelLibrarySnapshot>): Promise<void> => {
    try {
      const modelLibrary = await operation();
      set((current) => ({
        snapshot: current.snapshot ? { ...current.snapshot, modelLibrary } : current.snapshot,
        status: current.snapshot ? "ready" : current.status,
        error: null,
        actionError: null
      }));
    } catch (error) {
      const actionError = actionErrorFrom(error);
      set({ status: get().snapshot ? "ready" : "error", error: actionError.message, actionError });
      throw error;
    }
  };
  const commitSttSetup = async (operation: () => Promise<SttSetupSnapshot>): Promise<void> => {
    try {
      const sttSetup = await operation();
      set((current) => ({
        snapshot: current.snapshot ? { ...current.snapshot, sttSetup } : current.snapshot,
        status: current.snapshot ? "ready" : current.status,
        error: null,
        actionError: null
      }));
    } catch (error) {
      const actionError = actionErrorFrom(error);
      set({ status: get().snapshot ? "ready" : "error", error: actionError.message, actionError });
      throw error;
    }
  };
  const runAction = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      const result = await operation();
      set({ actionError: null, error: null });
      return result;
    } catch (error) {
      const actionError = actionErrorFrom(error);
      set({ status: get().snapshot ? "ready" : "error", error: actionError.message, actionError });
      throw error;
    }
  };

  return {
    status: "loading",
    snapshot: null,
    error: null,
    actionError: null,
    clearActionError: () => set({ actionError: null, error: get().snapshot ? null : get().error }),
    init: () => {
      if (activeStoreSubscriptions) return Promise.resolve();
      if (storeInitialization?.generation === storeGeneration) return storeInitialization.promise;

      const generation = storeGeneration;
      let stateEventCount = 0;
      let cancelled = false;
      const unsubscribers = [
        murmurClient.onStateChanged((snapshot) => {
          stateEventCount += 1;
          if (generation === storeGeneration && !cancelled) set({ snapshot, status: "ready", error: null });
        }),
        murmurClient.onModelDownloadProgress((download) => {
          if (generation !== storeGeneration || cancelled) return;
          set((current) => ({
            snapshot: current.snapshot ? upsertDownload(current.snapshot, download) : current.snapshot,
            status: current.snapshot ? "ready" : current.status,
            error: null
          }));
        }),
        murmurClient.onSttRuntimeProgress((runtime) => {
          if (generation !== storeGeneration || cancelled) return;
          set((current) => ({
            snapshot: current.snapshot ? upsertRuntimeState(current.snapshot, runtime) : current.snapshot,
            status: current.snapshot ? "ready" : current.status,
            error: null
          }));
        })
      ];
      const cancel = (): void => {
        if (cancelled) return;
        cancelled = true;
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
      const eventCountBeforeFetch = stateEventCount;
      const promise = murmurClient
        .getState()
        .then((snapshot) => {
          if (generation !== storeGeneration || cancelled) return;
          if (stateEventCount === eventCountBeforeFetch) set({ snapshot, status: "ready", error: null, actionError: null });
          activeStoreSubscriptions = cancel;
        })
        .catch((error) => {
          if (generation !== storeGeneration || cancelled) return;
          const actionError = actionErrorFrom(error);
          set({ status: get().snapshot ? "ready" : "error", error: actionError.message, actionError });
          cancel();
        })
        .finally(() => {
          if (storeInitialization?.promise === promise) storeInitialization = null;
        });
      storeInitialization = { generation, promise, cancel };
      return promise;
    },
    dispose: () => {
      storeGeneration += 1;
      storeInitialization?.cancel();
      storeInitialization = null;
      activeStoreSubscriptions?.();
      activeStoreSubscriptions = null;
    },
    refresh: () => commit(() => murmurClient.getState()),
    setSnapshot: (snapshot) => set({ snapshot, status: "ready", error: null, actionError: null }),
    activateMode: (modeId) => commit(() => murmurClient.activateMode(modeId)),
    updateSettings: (patch) => commit(() => murmurClient.updateSettings(patch)),
    setModes: (modes) => commit(() => murmurClient.setModes(modes)),
    setSttProviders: (providers) => commit(() => murmurClient.setSttProviders(providers)),
    setLlmProviders: (providers) => commit(() => murmurClient.setLlmProviders(providers)),
    validateSttProvider: (provider) => runAction(() => murmurClient.validateSttProvider(provider)),
    validateLlmProvider: (provider) => runAction(() => murmurClient.validateLlmProvider(provider)),
    refreshCodex: () => commit(() => murmurClient.refreshCodex()),
    startCodexLogin: () => commit(() => murmurClient.startCodexLogin()),
    cancelCodexLogin: () => commit(() => murmurClient.cancelCodexLogin()),
    logoutCodex: () => commit(() => murmurClient.logoutCodex()),
    setAutoModeRules: (rules) => commit(() => murmurClient.setAutoModeRules(rules)),
    setVocabulary: (entries) => commit(() => murmurClient.setVocabulary(entries)),
    getModelLibrary: () => commitLibrary(() => murmurClient.getModelLibrary()),
    downloadModel: (modelId) => commitLibrary(() => murmurClient.downloadModel(modelId)),
    cancelModelDownload: (modelId) => commitLibrary(() => murmurClient.cancelModelDownload(modelId)),
    activateModel: (modelId) => commitLibrary(() => murmurClient.activateModel(modelId)),
    deleteDownloadedModel: (modelId) => commitLibrary(() => murmurClient.deleteDownloadedModel(modelId)),
    toggleFavoriteModel: (modelId) => commitLibrary(() => murmurClient.toggleFavoriteModel(modelId)),
    getSttSetup: () => commitSttSetup(() => murmurClient.getSttSetup()),
    downloadSttRuntime: (runtimeId) => commitSttSetup(() => murmurClient.downloadSttRuntime(runtimeId)),
    repairSttRuntime: (runtimeId) => commitSttSetup(() => murmurClient.repairSttRuntime(runtimeId)),
    cancelSttRuntimeDownload: (runtimeId) => commitSttSetup(() => murmurClient.cancelSttRuntimeDownload(runtimeId)),
    setupBundledStt: (modelId) => commit(() => murmurClient.setupBundledStt(modelId)),
    skipSttSetup: () => commit(() => murmurClient.skipSttSetup()),
    startDictation: () => commit(() => murmurClient.startDictation()),
    stopDictation: () => commit(() => murmurClient.stopDictation()),
    cancelDictation: () => commit(() => murmurClient.cancelDictation()),
    testPaste: async (text) => {
      return runAction(async () => {
        const result = await murmurClient.testPaste(text);
        await get().refresh();
        return result;
      });
    },
    copyHistoryOutput: async (text) => {
      await runAction(() => murmurClient.copyHistoryOutput(text).then(() => undefined));
    },
    repasteHistoryOutput: async (text) => {
      return runAction(async () => {
        const result = await murmurClient.repasteHistoryOutput(text);
        return result.message;
      });
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

function upsertRuntimeState(snapshot: AppStateSnapshot, runtime: SttRuntimeInstallState): AppStateSnapshot {
  const runtimes = {
    ...snapshot.sttSetup.runtimes,
    [runtime.variantKey]: runtime
  };
  if (runtime.accelerator === "cpu") {
    runtimes[runtime.id] = runtime;
  }

  return {
    ...snapshot,
    sttSetup: {
      ...snapshot.sttSetup,
      runtimes
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
