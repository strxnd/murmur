import type {
  AppSettings,
  AppStateSnapshot,
  AutoModeRule,
  LlmProviderConfig,
  ModelDownloadState,
  ModelLibrarySnapshot,
  ModeConfig,
  PillStateSnapshot,
  ProviderValidationResult,
  RecordingLevelPayload,
  RecordingStartPayload,
  SttRuntimeId,
  SttRuntimeInstallState,
  SttSetupSnapshot,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../../../shared/types";
import {
  appStateSnapshotSchema,
  completeRecordingPayloadSchema,
  copyResultSchema,
  modelDownloadStateSchema,
  modelLibrarySnapshotSchema,
  pasteResultSchema,
  pillStateSnapshotSchema,
  providerValidationResultSchema,
  sttRuntimeInstallStateSchema,
  sttSetupSnapshotSchema
} from "../../../shared/schemas";

export const murmurClient = {
  getState: (): Promise<AppStateSnapshot> => window.murmur.getState().then(parseState),
  getPillState: (): Promise<PillStateSnapshot> => window.murmur.getPillState().then(parsePillState),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppStateSnapshot> => window.murmur.updateSettings(patch).then(parseState),
  beginHotkeyCapture: (): Promise<void> => window.murmur.beginHotkeyCapture().then(() => undefined),
  endHotkeyCapture: (): Promise<void> => window.murmur.endHotkeyCapture().then(() => undefined),
  setModes: (modes: ModeConfig[]): Promise<AppStateSnapshot> => window.murmur.setModes(modes).then(parseState),
  activateMode: (modeId: string): Promise<AppStateSnapshot> => window.murmur.activateMode(modeId).then(parseState),
  setSttProviders: (providers: TranscriptionProviderConfig[]): Promise<AppStateSnapshot> => window.murmur.setSttProviders(providers).then(parseState),
  setLlmProviders: (providers: LlmProviderConfig[]): Promise<AppStateSnapshot> => window.murmur.setLlmProviders(providers).then(parseState),
  validateSttProvider: (provider: TranscriptionProviderConfig): Promise<ProviderValidationResult> =>
    window.murmur.validateSttProvider(provider).then(parseProviderValidation),
  validateLlmProvider: (provider: LlmProviderConfig): Promise<ProviderValidationResult> =>
    window.murmur.validateLlmProvider(provider).then(parseProviderValidation),
  setAutoModeRules: (rules: AutoModeRule[]): Promise<AppStateSnapshot> => window.murmur.setAutoModeRules(rules).then(parseState),
  setVocabulary: (vocabulary: VocabularyEntry[]): Promise<AppStateSnapshot> => window.murmur.setVocabulary(vocabulary).then(parseState),
  getModelLibrary: (): Promise<ModelLibrarySnapshot> => window.murmur.getModelLibrary().then(parseModelLibrary),
  downloadModel: (modelId: string): Promise<ModelLibrarySnapshot> => window.murmur.downloadModel(modelId).then(parseModelLibrary),
  cancelModelDownload: (modelId: string): Promise<ModelLibrarySnapshot> => window.murmur.cancelModelDownload(modelId).then(parseModelLibrary),
  activateModel: (modelId: string): Promise<ModelLibrarySnapshot> => window.murmur.activateModel(modelId).then(parseModelLibrary),
  deleteDownloadedModel: (modelId: string): Promise<ModelLibrarySnapshot> =>
    window.murmur.deleteDownloadedModel(modelId).then(parseModelLibrary),
  toggleFavoriteModel: (modelId: string): Promise<ModelLibrarySnapshot> =>
    window.murmur.toggleFavoriteModel(modelId).then(parseModelLibrary),
  getSttSetup: (): Promise<SttSetupSnapshot> => window.murmur.getSttSetup().then(parseSttSetup),
  downloadSttRuntime: (runtimeId: SttRuntimeId): Promise<SttSetupSnapshot> =>
    window.murmur.downloadSttRuntime(runtimeId).then(parseSttSetup),
  repairSttRuntime: (runtimeId: SttRuntimeId): Promise<SttSetupSnapshot> =>
    window.murmur.repairSttRuntime(runtimeId).then(parseSttSetup),
  cancelSttRuntimeDownload: (runtimeId: SttRuntimeId): Promise<SttSetupSnapshot> =>
    window.murmur.cancelSttRuntimeDownload(runtimeId).then(parseSttSetup),
  setupBundledStt: (modelId: string): Promise<AppStateSnapshot> => window.murmur.setupBundledStt(modelId).then(parseState),
  skipSttSetup: (): Promise<AppStateSnapshot> => window.murmur.skipSttSetup().then(parseState),
  startDictation: (): Promise<AppStateSnapshot> => window.murmur.startDictation().then(parseState),
  stopDictation: (): Promise<AppStateSnapshot> => window.murmur.stopDictation().then(parseState),
  cancelDictation: (): Promise<AppStateSnapshot> => window.murmur.cancelDictation().then(parseState),
  completeRecording: (payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> =>
    window.murmur.completeRecording(completeRecordingPayloadSchema.parse(payload)).then(parseState),
  reportRecordingError: (payload: { sessionId: string; message: string }): Promise<AppStateSnapshot> =>
    window.murmur.reportRecordingError(payload).then(parseState),
  publishRecordingLevel: (payload: RecordingLevelPayload): void => {
    window.murmur.publishRecordingLevel(payload);
  },
  testPaste: (text: string): Promise<{ pasted: boolean; message: string }> =>
    window.murmur.testPaste(text).then((value) => pasteResultSchema.parse(value)),
  copyHistoryOutput: (text: string): Promise<{ ok: boolean }> => window.murmur.copyHistoryOutput(text).then((value) => copyResultSchema.parse(value)),
  repasteHistoryOutput: (text: string): Promise<{ pasted: boolean; message: string }> =>
    window.murmur.repasteHistoryOutput(text).then((value) => pasteResultSchema.parse(value)),
  deleteHistoryItem: (id: string): Promise<AppStateSnapshot> => window.murmur.deleteHistoryItem(id).then(parseState),
  clearHistory: (): Promise<AppStateSnapshot> => window.murmur.clearHistory().then(parseState),
  reprocessHistoryItem: (id: string): Promise<AppStateSnapshot> => window.murmur.reprocessHistoryItem(id).then(parseState),
  clearLocalData: (): Promise<AppStateSnapshot> => window.murmur.clearLocalData().then(parseState),
  onStateChanged: (callback: (state: AppStateSnapshot) => void): (() => void) =>
    window.murmur.onStateChanged((state) => callback(parseState(state))),
  onPillStateChanged: (callback: (state: PillStateSnapshot) => void): (() => void) =>
    window.murmur.onPillStateChanged((state) => callback(parsePillState(state))),
  onRecordingStart: (callback: (payload: RecordingStartPayload) => void): (() => void) => window.murmur.onRecordingStart(callback),
  onRecordingStop: (callback: (payload: { sessionId: string }) => void): (() => void) => window.murmur.onRecordingStop(callback),
  onRecordingCancel: (callback: (payload: { sessionId: string }) => void): (() => void) => window.murmur.onRecordingCancel(callback),
  onRecordingLevel: (callback: (payload: RecordingLevelPayload) => void): (() => void) => window.murmur.onRecordingLevel(callback),
  onTranscriptDelta: (callback: (delta: string) => void): (() => void) => window.murmur.onTranscriptDelta(callback),
  onModelDownloadProgress: (callback: (state: ModelDownloadState) => void): (() => void) =>
    window.murmur.onModelDownloadProgress((state) => callback(modelDownloadStateSchema.parse(state) as ModelDownloadState)),
  onSttRuntimeProgress: (callback: (state: SttRuntimeInstallState) => void): (() => void) =>
    window.murmur.onSttRuntimeProgress((state) => callback(sttRuntimeInstallStateSchema.parse(state) as SttRuntimeInstallState))
};

function parseState(value: unknown): AppStateSnapshot {
  return appStateSnapshotSchema.parse(value) as AppStateSnapshot;
}

function parsePillState(value: unknown): PillStateSnapshot {
  return pillStateSnapshotSchema.parse(value) as PillStateSnapshot;
}

function parseProviderValidation(value: unknown): ProviderValidationResult {
  return providerValidationResultSchema.parse(value) as ProviderValidationResult;
}

function parseModelLibrary(value: unknown): ModelLibrarySnapshot {
  return modelLibrarySnapshotSchema.parse(value) as ModelLibrarySnapshot;
}

function parseSttSetup(value: unknown): SttSetupSnapshot {
  return sttSetupSnapshotSchema.parse(value) as SttSetupSnapshot;
}
