import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  defaultAutoModeRules,
  defaultLlmProviders,
  defaultModelLibrary,
  defaultModes,
  defaultReleaseNotes,
  defaultSettings,
  defaultTranscriptionProviders
} from "../../shared/defaults";
import { modelCatalog } from "../../shared/model-catalog";
import type {
  ActivationMode,
  AppSettings,
  AutoModeRule,
  DictationHistoryItem,
  DictationModeKind,
  LlmProviderConfig,
  LlmProviderType,
  ModelCatalogItem,
  ModelKind,
  ModelDownloadState,
  ModelLibrarySnapshot,
  ModelProvider,
  ModeConfig,
  ModeIconKey,
  ReleaseNote,
  RecordingPillPosition,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../../shared/types";
import { ensureOwnerOnlyDirectory, ensureOwnerOnlyFile, ownerOnlyFileMode, type AppPaths } from "./app-paths";
import { ProviderSecretStore, secretIdForProvider, type ProviderSecretCodec, type ProviderSecretKind } from "./provider-secrets";

interface PersistedConfigState {
  settings: AppSettings;
  modes: ModeConfig[];
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
  autoModeRules: AutoModeRule[];
  vocabulary: VocabularyEntry[];
  modelLibrary: ModelLibrarySnapshot;
  releaseNotes: ReleaseNote[];
}

interface PersistedState extends PersistedConfigState {
  history: DictationHistoryItem[];
}

type LegacyModeConfig = Omit<Partial<ModeConfig>, "kind"> & {
  kind?: DictationModeKind | "default";
  presetId?: string;
};

type LegacySettings = Partial<Omit<AppSettings, "selectedTextCapture">> & {
  toggleHotkey?: string;
  pushToTalkHotkey?: string;
  cancelHotkey?: string;
  gpuRuntimeInstallPromptDismissedAt?: string;
  pasteMethod?: "clipboard_restore" | "clipboard_only";
  selectedTextCapture?: "disabled" | "enabled" | "clipboard_restore";
};

type LegacyAutoModeRule = Omit<AutoModeRule, "match"> & {
  match?: AutoModeRule["match"] & {
    domain?: string;
    domainWildcard?: string;
  };
};

type LegacyDictationHistoryItem = DictationHistoryItem & {
  browserDomain?: string;
};

const removedSoundVolumeSettingKey = ["auto", "Increase", "Mic", "Volume"].join("");
const require = createRequire(import.meta.url);
const retentionDayMs = 24 * 60 * 60 * 1000;
const removedLegacyModeIds = new Set(["meeting", "super", "custom"]);
const legacyModeIdMap = new Map([["email", "mail"]]);
const modeIconKeys = new Set<ModeIconKey>(["mic", "message-square", "mail", "notebook-pen", "sliders-horizontal"]);
const legacyPresetIconKeys = new Map<string, ModeIconKey>([
  ["voice_to_text", "mic"],
  ["message", "message-square"],
  ["mail", "mail"],
  ["note", "notebook-pen"],
  ["custom", "sliders-horizontal"]
]);
const builtInModeDefaults = defaultModes.filter((mode) => mode.kind === "built_in");
const builtInModeIds = new Set(builtInModeDefaults.map((mode) => mode.id));
const removedReleaseNoteIds = new Set(["initial-prototype"]);
const activationModes = new Set<ActivationMode>(["toggle", "push_to_talk"]);
const recordingPillPositions = new Set<RecordingPillPosition>(["bottom_left", "bottom_center", "bottom_right"]);
const appSettingKeys = [
  "theme",
  "textRetentionDays",
  "selectedTextCapture",
  "activeModeId",
  "activationMode",
  "activationHotkey",
  "modeSelectorHotkey",
  "recordingPillPosition",
  "preferredAudioInputId",
  "typingBaselineWpm",
  "trayCloseNoticeShownAt",
  "accelerationRuntimeInstallPromptDismissedAt",
  "sttSetupSkippedAt",
  "sttSetupCompletedAt",
  "onboardingSkippedAt",
  "onboardingCompletedAt"
] satisfies Array<keyof AppSettings>;
const customModeDefaults: ModeConfig = {
  id: "mode",
  kind: "custom",
  iconKey: "sliders-horizontal",
  name: "New mode",
  description: "",
  aiEnabled: true,
  writingStyle: "",
  instructionPrompt: "",
  examples: [],
  language: "auto",
  context: {
    app: true,
    selectedText: true,
    clipboardText: true
  }
};

export class StorageService {
  private db: any | null = null;
  private backendDiagnostic = "";
  private providerSecrets: ProviderSecretStore;
  backend: "sqlite" | "json" = "json";

  constructor(
    private paths: AppPaths,
    private loadSqlite: () => { DatabaseSync: new (path: string) => any } = () => require("node:sqlite"),
    providerSecretCodec?: ProviderSecretCodec
  ) {
    this.providerSecrets = new ProviderSecretStore(paths.providerSecretsPath, providerSecretCodec);
    ensureOwnerOnlyDirectory(paths.configDir);
    ensureOwnerOnlyDirectory(paths.dataDir);
    ensureOwnerOnlyDirectory(paths.cacheDir);
    ensureOwnerOnlyDirectory(paths.tempDir);
    ensureOwnerOnlyDirectory(paths.audioDir);
    this.open();
    this.migrateProviderSecrets();
  }

  getDiagnostics(): string[] {
    return this.backendDiagnostic ? [this.backendDiagnostic] : [];
  }

  getState(): PersistedState {
    const state = this.normalizeState(this.readState());
    const retention = this.applyTextRetention(state);
    if (retention.removed.length > 0) {
      return this.writeState(retention.state, retention.removed);
    }
    return retention.state;
  }

  private normalizeState(state: Partial<PersistedState>): PersistedState {
    const modes = this.normalizeModes(state.modes);
    const settings = this.normalizeSettings(state.settings, modes);
    return {
      settings,
      modes,
      transcriptionProviders: this.redactTranscriptionProviderSecrets(this.normalizeTranscriptionProviders(state.transcriptionProviders)),
      llmProviders: this.redactLlmProviderSecrets(this.normalizeLlmProviders(state.llmProviders)),
      autoModeRules: this.normalizeAutoModeRules(state.autoModeRules ?? defaultAutoModeRules, modes),
      vocabulary: state.vocabulary ?? [],
      history: this.normalizeHistory(state.history),
      modelLibrary: this.normalizeModelLibrary(state.modelLibrary),
      releaseNotes: this.normalizeReleaseNotes(state.releaseNotes)
    };
  }

  getSettings(): AppSettings {
    const config = this.readConfig();
    const modes = this.normalizeModes(config.modes);
    return this.normalizeSettings(config.settings, modes);
  }

  updateSettings(patch: Partial<AppSettings>): PersistedState {
    const state = this.getState();
    state.settings = { ...state.settings, ...patch };
    return this.writeState(state);
  }

  setModes(modes: ModeConfig[]): PersistedState {
    const state = this.getState();
    state.modes = modes;
    return this.writeState(state);
  }

  setTranscriptionProviders(providers: TranscriptionProviderConfig[]): PersistedState {
    const state = this.getState();
    state.transcriptionProviders = this.redactTranscriptionProviderSecrets(this.normalizeTranscriptionProviders(providers));
    this.providerSecrets.pruneKind(
      "stt",
      new Set(state.transcriptionProviders.map((provider) => provider.apiKeySecretId ?? secretIdForProvider("stt", provider.id)))
    );
    return this.writeState(state);
  }

  setLlmProviders(providers: LlmProviderConfig[]): PersistedState {
    const state = this.getState();
    state.llmProviders = this.redactLlmProviderSecrets(this.normalizeLlmProviders(providers));
    this.providerSecrets.pruneKind(
      "llm",
      new Set(state.llmProviders.map((provider) => provider.apiKeySecretId ?? secretIdForProvider("llm", provider.id)))
    );
    return this.writeState(state);
  }

  resolveTranscriptionProviderSecret(provider: TranscriptionProviderConfig): TranscriptionProviderConfig {
    return this.resolveProviderSecret("stt", provider);
  }

  resolveLlmProviderSecret(provider: LlmProviderConfig): LlmProviderConfig {
    return this.resolveProviderSecret("llm", provider);
  }

  setAutoModeRules(rules: AutoModeRule[]): PersistedState {
    const state = this.getState();
    state.autoModeRules = rules;
    return this.writeState(state);
  }

  setVocabulary(entries: VocabularyEntry[]): PersistedState {
    const state = this.getState();
    state.vocabulary = entries;
    return this.writeState(state);
  }

  setModelLibrary(modelLibrary: ModelLibrarySnapshot): PersistedState {
    const state = this.getState();
    state.modelLibrary = this.normalizeModelLibrary(modelLibrary);
    return this.writeState(state);
  }

  upsertModelDownload(download: ModelDownloadState): PersistedState {
    const state = this.getState();
    const downloads = state.modelLibrary.downloads.filter((candidate) => candidate.modelId !== download.modelId);
    state.modelLibrary = this.normalizeModelLibrary({
      catalog: state.modelLibrary.catalog,
      downloads: [download, ...downloads],
      activeModelIds: state.modelLibrary.activeModelIds
    });
    return this.writeState(state);
  }

  deleteModelDownload(modelId: string): PersistedState {
    const state = this.getState();
    state.modelLibrary = this.normalizeModelLibrary({
      catalog: state.modelLibrary.catalog,
      downloads: state.modelLibrary.downloads.filter((download) => download.modelId !== modelId),
      activeModelIds: state.modelLibrary.activeModelIds
    });
    return this.writeState(state);
  }

  setActiveModel(kind: ModelKind, modelId: string | undefined): PersistedState {
    const state = this.getState();
    state.modelLibrary = this.normalizeModelLibrary({
      ...state.modelLibrary,
      activeModelIds: {
        ...state.modelLibrary.activeModelIds,
        [kind]: modelId
      }
    });
    return this.writeState(state);
  }

  addHistory(item: DictationHistoryItem): PersistedState {
    const state = this.getState();
    state.history = [item, ...state.history].slice(0, 2000);
    return this.writeState(state);
  }

  updateHistoryItem(id: string, patch: Partial<DictationHistoryItem>): PersistedState {
    const state = this.getState();
    state.history = state.history.map((item) => (item.id === id ? { ...item, ...patch } : item));
    return this.writeState(state);
  }

  deleteHistory(id: string): PersistedState {
    const state = this.getState();
    const deleted = state.history.find((item) => item.id === id);
    state.history = state.history.filter((item) => item.id !== id);
    return this.writeState(state, deleted ? [deleted] : []);
  }

  clearHistory(): PersistedState {
    const state = this.getState();
    const removed = state.history;
    state.history = [];
    return this.writeState(state, removed);
  }

  clearLocalData(): PersistedState {
    const state: PersistedState = this.defaults();
    this.closeDatabase();
    rmSync(this.paths.configPath, { force: true });
    this.providerSecrets.clear();
    rmSync(this.paths.historyDbPath, { force: true });
    rmSync(this.paths.historyJsonPath, { force: true });
    rmSync(this.paths.audioDir, { recursive: true, force: true });
    ensureOwnerOnlyDirectory(this.paths.audioDir);
    this.open();
    return this.writeState(state);
  }

  private open(): void {
    this.closeDatabase();
    try {
      const { DatabaseSync } = this.loadSqlite();
      this.db = new DatabaseSync(this.paths.historyDbPath);
      ensureOwnerOnlyFile(this.paths.historyDbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dictations (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          mode_name TEXT,
          app_name TEXT,
          window_title TEXT,
          raw_transcript TEXT,
          processed_output TEXT,
          data TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS dictations_fts USING fts5(
          id UNINDEXED,
          raw_transcript,
          processed_output,
          mode_name,
          app_name,
          window_title
        );
      `);
      this.backend = "sqlite";
      this.backendDiagnostic = "History storage is ready.";
    } catch {
      this.db = null;
      this.backend = "json";
      this.backendDiagnostic = "History storage is using JSON fallback because SQLite is unavailable.";
      if (!existsSync(this.paths.historyJsonPath)) {
        this.writeHistoryJson([]);
      }
    }
  }

  private readState(): PersistedState {
    return {
      ...this.defaults(),
      ...this.readConfig(),
      history: this.readHistory()
    };
  }

  private readConfig(): Partial<PersistedConfigState> {
    if (!existsSync(this.paths.configPath)) {
      return {};
    }

    try {
      return JSON.parse(readFileSync(this.paths.configPath, "utf8")) as Partial<PersistedConfigState>;
    } catch {
      return {};
    }
  }

  private readHistory(): DictationHistoryItem[] {
    if (this.backend === "sqlite" && this.db) {
      const historyRows = this.db
        .prepare("SELECT data FROM dictations ORDER BY created_at DESC LIMIT 2000")
        .all() as Array<{ data: string }>;
      return historyRows.map((row) => JSON.parse(row.data) as DictationHistoryItem);
    }

    if (!existsSync(this.paths.historyJsonPath)) {
      return [];
    }

    try {
      const data = JSON.parse(readFileSync(this.paths.historyJsonPath, "utf8")) as unknown;
      if (Array.isArray(data)) return data as DictationHistoryItem[];
      if (data && typeof data === "object" && Array.isArray((data as { history?: unknown }).history)) {
        return (data as { history: DictationHistoryItem[] }).history;
      }
      return [];
    } catch {
      return [];
    }
  }

  private writeState(state: PersistedState, removedAfterWrite: DictationHistoryItem[] = []): PersistedState {
    const retention = this.applyTextRetention(state);
    this.writeConfig(toConfigState(retention.state));
    this.writeHistory(retention.state.history);
    for (const item of [...removedAfterWrite, ...retention.removed]) {
      this.deleteRetainedAudio(item.audioPath);
    }
    return retention.state;
  }

  private writeConfig(state: PersistedConfigState): void {
    ensureOwnerOnlyDirectory(dirname(this.paths.configPath));
    writeJsonAtomic(this.paths.configPath, state);
    ensureOwnerOnlyFile(this.paths.configPath);
  }

  private writeHistory(history: DictationHistoryItem[]): void {
    if (this.backend === "sqlite" && this.db) {
      this.db.exec("BEGIN IMMEDIATE;");
      try {
        this.db.exec("DELETE FROM dictations; DELETE FROM dictations_fts;");
        const insert = this.db.prepare(`
          INSERT INTO dictations
          (id, created_at, mode_name, app_name, window_title, raw_transcript, processed_output, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertFts = this.db.prepare(`
          INSERT INTO dictations_fts
          (id, raw_transcript, processed_output, mode_name, app_name, window_title)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of history) {
          insert.run(
            item.id,
            item.createdAt,
            item.modeName,
            item.appName ?? "",
            item.windowTitle ?? "",
            item.rawTranscript,
            item.processedOutput,
            JSON.stringify(item)
          );
          insertFts.run(
            item.id,
            item.rawTranscript,
            item.processedOutput,
            item.modeName,
            item.appName ?? "",
            item.windowTitle ?? ""
          );
        }
        this.db.exec("COMMIT;");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // Preserve the original write failure.
        }
        throw error;
      }
      return;
    }

    this.writeHistoryJson(history);
  }

  private writeHistoryJson(history: DictationHistoryItem[]): void {
    ensureOwnerOnlyDirectory(dirname(this.paths.historyJsonPath));
    writeJsonAtomic(this.paths.historyJsonPath, history);
    ensureOwnerOnlyFile(this.paths.historyJsonPath);
  }

  private migrateProviderSecrets(): void {
    const config = this.readConfig();
    const modes = this.normalizeModes(config.modes);
    const nextConfig: PersistedConfigState = {
      settings: this.normalizeSettings(config.settings, modes),
      modes,
      transcriptionProviders: this.redactTranscriptionProviderSecrets(this.normalizeTranscriptionProviders(config.transcriptionProviders)),
      llmProviders: this.redactLlmProviderSecrets(this.normalizeLlmProviders(config.llmProviders)),
      autoModeRules: this.normalizeAutoModeRules(config.autoModeRules ?? defaultAutoModeRules, modes),
      vocabulary: config.vocabulary ?? [],
      modelLibrary: this.normalizeModelLibrary(config.modelLibrary),
      releaseNotes: this.normalizeReleaseNotes(config.releaseNotes)
    };

    if (config.transcriptionProviders || config.llmProviders) {
      this.writeConfig(nextConfig);
    }
  }

  private redactTranscriptionProviderSecrets(providers: TranscriptionProviderConfig[]): TranscriptionProviderConfig[] {
    return providers.map((provider) => this.redactProviderSecret("stt", provider));
  }

  private redactLlmProviderSecrets(providers: LlmProviderConfig[]): LlmProviderConfig[] {
    return providers.map((provider) => this.redactProviderSecret("llm", provider));
  }

  private redactProviderSecret<T extends TranscriptionProviderConfig | LlmProviderConfig>(kind: ProviderSecretKind, provider: T): T {
    const secretId = provider.apiKeySecretId ?? secretIdForProvider(kind, provider.id);
    const apiKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : undefined;

    if (apiKey) {
      this.providerSecrets.set(secretId, apiKey);
      const redacted = { ...provider, apiKeySecretId: secretId };
      delete redacted.apiKey;
      return redacted;
    }

    if (provider.apiKey === "" && !provider.apiKeySecretId) {
      this.providerSecrets.delete(secretId);
    }

    const redacted = { ...provider };
    delete redacted.apiKey;
    return redacted;
  }

  private resolveProviderSecret<T extends TranscriptionProviderConfig | LlmProviderConfig>(kind: ProviderSecretKind, provider: T): T {
    if (provider.apiKey?.trim()) return provider;
    const apiKey = this.providerSecrets.get(provider.apiKeySecretId ?? secretIdForProvider(kind, provider.id));
    return apiKey ? { ...provider, apiKey } : provider;
  }

  private closeDatabase(): void {
    if (!this.db) return;
    try {
      this.db.close?.();
    } finally {
      this.db = null;
    }
  }

  private deleteRetainedAudio(audioPath: string | null): void {
    if (!audioPath || !isPathBelow(audioPath, this.paths.audioDir)) return;
    try {
      rmSync(audioPath, { force: true });
    } catch {
      // Legacy linked audio cleanup should not block history mutations.
    }
  }

  private applyTextRetention(state: PersistedState): { state: PersistedState; removed: DictationHistoryItem[] } {
    const { retained, removed } = retainHistoryItems(state.history, state.settings.textRetentionDays);
    if (removed.length === 0) return { state, removed };
    return {
      state: {
        ...state,
        history: retained
      },
      removed
    };
  }

  private defaults(): PersistedState {
    return {
      settings: clone(defaultSettings),
      modes: clone(defaultModes),
      transcriptionProviders: clone(defaultTranscriptionProviders),
      llmProviders: clone(defaultLlmProviders),
      autoModeRules: clone(defaultAutoModeRules),
      vocabulary: [],
      history: [],
      modelLibrary: clone(defaultModelLibrary),
      releaseNotes: this.normalizeReleaseNotes(defaultReleaseNotes)
    };
  }

  private normalizeSettings(settings: LegacySettings | undefined, modes: ModeConfig[]): AppSettings {
    const legacySettings: LegacySettings & Record<string, unknown> = { ...(settings ?? {}) };
    delete legacySettings[removedSoundVolumeSettingKey];
    const { toggleHotkey } = legacySettings;
    const currentSettings = pickKnownSettings(legacySettings);
    const normalized: AppSettings = {
      ...defaultSettings,
      ...currentSettings,
      activationMode: activationModes.has(currentSettings.activationMode as ActivationMode)
        ? (currentSettings.activationMode as ActivationMode)
        : defaultSettings.activationMode,
      activationHotkey: currentSettings.activationHotkey ?? toggleHotkey ?? defaultSettings.activationHotkey,
      recordingPillPosition: recordingPillPositions.has(currentSettings.recordingPillPosition as RecordingPillPosition)
        ? (currentSettings.recordingPillPosition as RecordingPillPosition)
        : defaultSettings.recordingPillPosition,
      selectedTextCapture: currentSettings.selectedTextCapture === "disabled" ? "disabled" : "enabled",
      trayCloseNoticeShownAt:
        typeof currentSettings.trayCloseNoticeShownAt === "string" ? currentSettings.trayCloseNoticeShownAt : undefined,
      accelerationRuntimeInstallPromptDismissedAt:
        typeof currentSettings.accelerationRuntimeInstallPromptDismissedAt === "string"
          ? currentSettings.accelerationRuntimeInstallPromptDismissedAt
          : typeof legacySettings.gpuRuntimeInstallPromptDismissedAt === "string"
            ? legacySettings.gpuRuntimeInstallPromptDismissedAt
          : undefined
    };
    const modeIds = new Set(modes.map((mode) => mode.id));
    normalized.activeModeId = legacyModeIdMap.get(normalized.activeModeId) ?? normalized.activeModeId;
    if (!modeIds.has(normalized.activeModeId)) {
      normalized.activeModeId = "default";
    }
    normalized.typingBaselineWpm = Number.isFinite(normalized.typingBaselineWpm)
      ? Math.max(1, normalized.typingBaselineWpm)
      : defaultSettings.typingBaselineWpm;
    normalized.textRetentionDays = Number.isFinite(normalized.textRetentionDays)
      ? Math.max(0, Math.floor(normalized.textRetentionDays))
      : defaultSettings.textRetentionDays;
    return normalized;
  }

  private normalizeModes(modes: LegacyModeConfig[] | undefined): ModeConfig[] {
    if (!modes?.length) return clone(defaultModes);

    const normalizedModes = builtInModeDefaults.map((mode) => this.normalizeMode(mode, "built_in", mode));

    const customModes: ModeConfig[] = [];
    const seenCustomIds = new Set<string>();

    for (const mode of modes) {
      if (!isUsableModeId(mode.id)) {
        continue;
      }
      const normalizedId = legacyModeIdMap.get(mode.id) ?? mode.id;
      if (
        mode.id === "default" ||
        mode.kind === "default" ||
        builtInModeIds.has(normalizedId) ||
        removedLegacyModeIds.has(mode.id) ||
        seenCustomIds.has(mode.id)
      ) {
        continue;
      }
      seenCustomIds.add(mode.id);
      customModes.push(this.normalizeMode(mode, "custom", customModeDefaults));
    }

    return [...normalizedModes, ...customModes];
  }

  private normalizeMode(mode: LegacyModeConfig | undefined, kind: DictationModeKind, base: ModeConfig): ModeConfig {
    const context = mode?.context ?? base.context;

    return {
      id: kind === "built_in" ? base.id : isUsableModeId(mode?.id) ? mode.id : base.id,
      kind,
      iconKey: this.normalizeModeIconKey(mode, base.iconKey),
      name: isNonEmptyString(mode?.name) ? mode.name : base.name,
      description: typeof mode?.description === "string" ? mode.description : base.description,
      aiEnabled: typeof mode?.aiEnabled === "boolean" ? mode.aiEnabled : base.aiEnabled,
      writingStyle: typeof mode?.writingStyle === "string" ? mode.writingStyle : base.writingStyle,
      instructionPrompt: typeof mode?.instructionPrompt === "string" ? mode.instructionPrompt : base.instructionPrompt,
      examples: normalizeExamples(mode?.examples),
      language: isNonEmptyString(mode?.language) ? mode.language : base.language,
      context: {
        app: typeof context.app === "boolean" ? context.app : base.context.app,
        selectedText: typeof context.selectedText === "boolean" ? context.selectedText : base.context.selectedText,
        clipboardText: typeof context.clipboardText === "boolean" ? context.clipboardText : base.context.clipboardText
      }
    };
  }

  private normalizeAutoModeRules(rules: LegacyAutoModeRule[], modes: ModeConfig[]): AutoModeRule[] {
    const modeIds = new Set(modes.map((mode) => mode.id));
    return rules
      .map((rule) => ({
        ...rule,
        modeId: legacyModeIdMap.get(rule.modeId) ?? rule.modeId,
        match: {
          appId: rule.match?.appId,
          appName: rule.match?.appName,
          windowTitleIncludes: rule.match?.windowTitleIncludes
        }
      }))
      .filter((rule) => !removedLegacyModeIds.has(rule.modeId) && modeIds.has(rule.modeId))
      .filter((rule) => Boolean(rule.match.appId || rule.match.appName || rule.match.windowTitleIncludes));
  }

  private normalizeModeIconKey(mode: LegacyModeConfig | undefined, fallback: ModeIconKey): ModeIconKey {
    if (isModeIconKey(mode?.iconKey)) return mode.iconKey;
    return legacyPresetIconKeys.get(mode?.presetId ?? "") ?? fallback;
  }

  private normalizeTranscriptionProviders(
    providers: Array<Partial<TranscriptionProviderConfig>> | undefined
  ): TranscriptionProviderConfig[] {
    if (!providers?.length) return clone(defaultTranscriptionProviders);

    const defaultIds = new Set(defaultTranscriptionProviders.map((provider) => provider.id));
    const byId = new Map(providers.filter((provider) => isNonEmptyString(provider.id)).map((provider) => [provider.id!, provider]));
    const legacyWhisper = byId.get("local-whisper-cpp");

    const normalizedDefaults = defaultTranscriptionProviders.map((defaultProvider) => {
      const existing = byId.get(defaultProvider.id);

      if (defaultProvider.id === "local-whisper-cpp" && existing && isLegacyDefaultWhisperProvider(existing)) {
        return clone(defaultProvider);
      }

      if (defaultProvider.id === "external-whisper-cpp" && !existing && legacyWhisper && isLegacyExternalWhisperProvider(legacyWhisper)) {
        return normalizeTranscriptionProvider(defaultProvider, {
          ...legacyWhisper,
          id: "external-whisper-cpp",
          name: defaultProvider.name
        });
      }

      return normalizeTranscriptionProvider(defaultProvider, existing);
    });

    const customProviders = providers
      .filter((provider) => isNonEmptyString(provider.id) && !defaultIds.has(provider.id))
      .map((provider) => normalizeTranscriptionProvider(undefined, provider));

    return [...normalizedDefaults, ...customProviders];
  }

  private normalizeLlmProviders(providers: Array<Partial<LlmProviderConfig>> | undefined): LlmProviderConfig[] {
    if (!providers?.length) return clone(defaultLlmProviders);

    const defaultIds = new Set(defaultLlmProviders.map((provider) => provider.id));
    const usableProviders = providers.filter((provider) => !isRemovedLlmProvider(provider));
    const byId = new Map(usableProviders.filter((provider) => isNonEmptyString(provider.id)).map((provider) => [provider.id!, provider]));
    const normalizedDefaults = defaultLlmProviders.map((defaultProvider) => {
      const existing = byId.get(defaultProvider.id);
      if (defaultProvider.id === "lmstudio" && existing && isLegacyDisabledLmStudioProvider(existing)) {
        return clone(defaultProvider);
      }
      return normalizeLlmProvider(defaultProvider, existing);
    });
    const customProviders = usableProviders
      .filter((provider) => isNonEmptyString(provider.id) && !defaultIds.has(provider.id))
      .map((provider) => normalizeLlmProvider(undefined, provider));

    return [...normalizedDefaults, ...customProviders];
  }

  private normalizeModelLibrary(modelLibrary: ModelLibrarySnapshot | undefined): ModelLibrarySnapshot {
    const catalog = normalizedModelCatalog(modelLibrary?.catalog);
    const catalogById = new Map(catalog.map((item) => [item.id, item]));
    const catalogIds = new Set(catalogById.keys());
    const activeModelIds: ModelLibrarySnapshot["activeModelIds"] = {};
    const activeVoiceModelId = modelLibrary?.activeModelIds?.voice;
    const activeLanguageModelId = modelLibrary?.activeModelIds?.language;

    if (activeVoiceModelId && catalogById.get(activeVoiceModelId)?.kind === "voice") {
      activeModelIds.voice = activeVoiceModelId;
    }
    if (activeLanguageModelId && catalogById.get(activeLanguageModelId)?.kind === "language") {
      activeModelIds.language = activeLanguageModelId;
    }

    return {
      catalog,
      downloads: (modelLibrary?.downloads ?? [])
        .filter((download) => catalogIds.has(download.modelId))
        .map((download) => ({
          modelId: download.modelId,
          status: download.status ?? "not_downloaded",
          progressBytes: download.progressBytes ?? 0,
          totalBytes: download.totalBytes,
          localPath: download.localPath,
          error: download.error,
          downloadedAt: download.downloadedAt,
          favorite: Boolean(download.favorite)
        })),
      activeModelIds
    };
  }

  private normalizeHistory(history: LegacyDictationHistoryItem[] | undefined): DictationHistoryItem[] {
    return (history ?? []).map((item) => {
      const normalized: DictationHistoryItem = {
        id: item.id,
        audioPath: item.audioPath,
        rawTranscript: item.rawTranscript,
        processedOutput: item.processedOutput,
        modeId: item.modeId,
        modeName: item.modeName,
        transcriptionProviderId: item.transcriptionProviderId,
        transcriptionProviderType: item.transcriptionProviderType,
        transcriptionModel: item.transcriptionModel,
        transcriptionProviderCloud: item.transcriptionProviderCloud,
        transcriptionStreamingMode: item.transcriptionStreamingMode,
        transcriptionAccelerator: item.transcriptionAccelerator,
        llmProviderId: item.llmProviderId,
        llmProviderType: item.llmProviderType,
        llmModel: item.llmModel,
        llmProviderCloud: item.llmProviderCloud,
        appName: item.appName,
        appId: item.appId,
        windowTitle: item.windowTitle,
        createdAt: item.createdAt,
        recordingStartedAt: item.recordingStartedAt,
        recordingStoppedAt: item.recordingStoppedAt,
        recordingDurationMs: item.recordingDurationMs,
        rawWordCount: item.rawWordCount,
        processedWordCount: item.processedWordCount
      };
      return normalized;
    });
  }

  private normalizeReleaseNotes(releaseNotes: ReleaseNote[] | undefined): ReleaseNote[] {
    const source = releaseNotes?.length ? releaseNotes : defaultReleaseNotes;
    return source.filter((note) => !removedReleaseNoteIds.has(note.id)).map((note) => ({ ...note }));
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function retainHistoryItems(
  history: DictationHistoryItem[],
  textRetentionDays: number
): { retained: DictationHistoryItem[]; removed: DictationHistoryItem[] } {
  if (!Number.isFinite(textRetentionDays)) return { retained: history, removed: [] };
  if (textRetentionDays === 0) return { retained: [], removed: history };

  const cutoff = Date.now() - Math.floor(textRetentionDays) * retentionDayMs;
  const retained: DictationHistoryItem[] = [];
  const removed: DictationHistoryItem[] = [];

  for (const item of history) {
    const createdAtMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs >= cutoff) {
      retained.push(item);
    } else {
      removed.push(item);
    }
  }

  return { retained, removed };
}

function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  let fd: number | null = null;

  try {
    ensureOwnerOnlyDirectory(dir);
    fd = openSync(tempPath, "w", ownerOnlyFileMode);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, path);
    fsyncDirectory(dir);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Preserve the original write failure.
      }
    }
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function fsyncDirectory(path: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Directory fsync is a durability improvement where supported; rename atomicity is still preserved.
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function toConfigState(state: PersistedState): PersistedConfigState {
  return {
    settings: state.settings,
    modes: state.modes,
    transcriptionProviders: state.transcriptionProviders,
    llmProviders: state.llmProviders,
    autoModeRules: state.autoModeRules,
    vocabulary: state.vocabulary,
    modelLibrary: state.modelLibrary,
    releaseNotes: state.releaseNotes
  };
}

function isPathBelow(path: string, parent: string): boolean {
  const relativePath = relative(resolve(parent), resolve(path));
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function pickKnownSettings(settings: LegacySettings & Record<string, unknown>): Partial<AppSettings> {
  const knownSettings: Record<string, unknown> = {};
  for (const key of appSettingKeys) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      knownSettings[key] = settings[key];
    }
  }
  return knownSettings as Partial<AppSettings>;
}

function isUsableModeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isModeIconKey(value: unknown): value is ModeIconKey {
  return typeof value === "string" && modeIconKeys.has(value as ModeIconKey);
}

const sttProviderTypes = new Set<TranscriptionProviderConfig["type"]>([
  "whisper_cpp",
  "sherpa_onnx",
  "local_openai_compatible_stt",
  "cloud_openai",
  "cloud_openai_compatible_stt"
]);
const llmProviderTypes = new Set<LlmProviderType>([
  "ollama",
  "lmstudio",
  "llama_cpp_openai",
  "openai",
  "anthropic",
  "google",
  "custom_openai_compatible"
]);
const modelProviders = new Set<ModelProvider>([
  "whisper_cpp",
  "nvidia",
  "ollama",
  "lmstudio",
  "openai",
  "openai_compatible",
  "anthropic",
  "google"
]);
const removedLlmProviderIds = new Set(["openrouter", "groq"]);
const removedLlmProviderTypes = new Set(["openrouter", "groq"]);
const removedLlmProviderNames = new Set(["openrouter", "groq"]);
const sttStreamingModes = new Set<TranscriptionProviderConfig["streamingMode"]>(["none", "completed_audio_sse", "live_realtime"]);
const legacyWhisperBaseUrl = "http://127.0.0.1:8080";

function normalizeTranscriptionProvider(
  defaultProvider: TranscriptionProviderConfig | undefined,
  provider: Partial<TranscriptionProviderConfig> | undefined
): TranscriptionProviderConfig {
  const source = { ...(defaultProvider ?? {}), ...(provider ?? {}) };
  const type = sttProviderTypes.has(source.type as TranscriptionProviderConfig["type"])
    ? (source.type as TranscriptionProviderConfig["type"])
    : (defaultProvider?.type ?? "local_openai_compatible_stt");
  const streamingMode = sttStreamingModes.has(source.streamingMode as TranscriptionProviderConfig["streamingMode"])
    ? (source.streamingMode as TranscriptionProviderConfig["streamingMode"])
    : (defaultProvider?.streamingMode ?? "none");

  return {
    id: isNonEmptyString(source.id) ? source.id : (defaultProvider?.id ?? "custom-stt"),
    type,
    name: isNonEmptyString(source.name) ? source.name : (defaultProvider?.name ?? "Custom STT"),
    baseUrl: isNonEmptyString(source.baseUrl) ? source.baseUrl : (defaultProvider?.baseUrl ?? ""),
    endpointPath: isNonEmptyString(source.endpointPath) ? source.endpointPath : defaultProvider?.endpointPath,
    apiKeySecretId: isNonEmptyString(source.apiKeySecretId) ? source.apiKeySecretId : defaultProvider?.apiKeySecretId,
    apiKey: typeof source.apiKey === "string" ? source.apiKey : defaultProvider?.apiKey,
    isCloud: typeof source.isCloud === "boolean" ? source.isCloud : Boolean(defaultProvider?.isCloud),
    isLocal: typeof source.isLocal === "boolean" ? source.isLocal : !Boolean(defaultProvider?.isCloud),
    defaultModel: isNonEmptyString(source.defaultModel) ? source.defaultModel : defaultProvider?.defaultModel,
    defaultLanguage: isNonEmptyString(source.defaultLanguage) ? source.defaultLanguage : defaultProvider?.defaultLanguage,
    streamingMode,
    enabled: typeof source.enabled === "boolean" ? source.enabled : Boolean(defaultProvider?.enabled)
  };
}

function isLegacyDefaultWhisperProvider(provider: Partial<TranscriptionProviderConfig>): boolean {
  return (
    provider.type === "whisper_cpp" &&
    provider.baseUrl === legacyWhisperBaseUrl &&
    (provider.name === undefined || provider.name === "Local whisper.cpp server") &&
    (provider.endpointPath === undefined || provider.endpointPath === "/inference")
  );
}

function isLegacyExternalWhisperProvider(provider: Partial<TranscriptionProviderConfig>): boolean {
  return provider.type === "whisper_cpp" && isNonEmptyString(provider.baseUrl) && provider.baseUrl !== "murmur://runtime/whisper.cpp";
}

function normalizeLlmProvider(
  defaultProvider: LlmProviderConfig | undefined,
  provider: Partial<LlmProviderConfig> | undefined
): LlmProviderConfig {
  const source = { ...(defaultProvider ?? {}), ...(provider ?? {}) };
  const type = llmProviderTypes.has(source.type as LlmProviderType)
    ? (source.type as LlmProviderType)
    : (defaultProvider?.type ?? "custom_openai_compatible");
  const isOpenAiCompatible = type === "custom_openai_compatible";

  return {
    id: isNonEmptyString(source.id) ? source.id : (defaultProvider?.id ?? "custom-llm"),
    type,
    name: isNonEmptyString(source.name) ? source.name : (defaultProvider?.name ?? "Custom LLM"),
    baseUrl: isNonEmptyString(source.baseUrl) ? source.baseUrl : defaultProvider?.baseUrl,
    apiKeySecretId: isNonEmptyString(source.apiKeySecretId) ? source.apiKeySecretId : defaultProvider?.apiKeySecretId,
    apiKey: typeof source.apiKey === "string" ? source.apiKey : defaultProvider?.apiKey,
    isCloud: typeof source.isCloud === "boolean" ? source.isCloud : Boolean(defaultProvider?.isCloud),
    defaultModel: isOpenAiCompatible ? undefined : isNonEmptyString(source.defaultModel) ? source.defaultModel : defaultProvider?.defaultModel,
    models: isOpenAiCompatible ? normalizeProviderModelIds([source.models, source.defaultModel]) : undefined,
    enabled: typeof source.enabled === "boolean" ? source.enabled : Boolean(defaultProvider?.enabled)
  };
}

function isLegacyDisabledLmStudioProvider(provider: Partial<LlmProviderConfig>): boolean {
  return (
    provider.id === "lmstudio" &&
    provider.type === "lmstudio" &&
    (provider.name === undefined || provider.name === "LM Studio") &&
    (provider.baseUrl === undefined || provider.baseUrl === "http://127.0.0.1:1234/v1") &&
    (provider.defaultModel === undefined || provider.defaultModel === "local-model") &&
    provider.enabled === false &&
    (provider.apiKey === undefined || provider.apiKey === "")
  );
}

function isRemovedLlmProvider(provider: Partial<LlmProviderConfig>): boolean {
  return (
    removedLlmProviderIds.has(String(provider.id ?? "").toLowerCase()) ||
    removedLlmProviderTypes.has(String(provider.type ?? "").toLowerCase()) ||
    removedLlmProviderNames.has(String(provider.name ?? "").toLowerCase())
  );
}

function normalizedModelCatalog(catalog: Array<Partial<ModelCatalogItem>> | undefined): ModelCatalogItem[] {
  const normalized = [...modelCatalog];
  const seenIds = new Set(normalized.map((item) => item.id));

  for (const item of catalog ?? []) {
    const discovered = normalizeDiscoveredModelCatalogItem(item);
    if (!discovered || seenIds.has(discovered.id)) continue;
    seenIds.add(discovered.id);
    normalized.push(discovered);
  }

  return normalized;
}

function normalizeDiscoveredModelCatalogItem(item: Partial<ModelCatalogItem>): ModelCatalogItem | null {
  const provider = item.provider;
  if (!isNonEmptyString(item.id) || item.kind !== "language" || !isDynamicModelProvider(provider)) return null;
  const discovery = item.discovery;
  if (!discovery || !isNonEmptyString(discovery.providerId)) return null;
  const model = item.defaultProviderConfig?.model;
  const llmProviderType = item.defaultProviderConfig?.llmProviderType;
  if (!isNonEmptyString(model)) return null;
  if (!llmProviderType || !llmProviderTypes.has(llmProviderType)) return null;

  return {
    id: item.id,
    name: isNonEmptyString(item.name) ? item.name : model,
    kind: "language",
    provider,
    description: isNonEmptyString(item.description) ? item.description : `${providerDisplayName(provider)} language model.`,
    isCloud: Boolean(item.isCloud),
    isOffline: Boolean(item.isOffline),
    tags: normalizeTags(item.tags, ["llm", "local", provider, "discovered"]),
    downloadStrategy: "none",
    discovery: {
      providerId: discovery.providerId,
      lastSeenAt: isNonEmptyString(discovery.lastSeenAt) ? discovery.lastSeenAt : undefined,
      reachable: Boolean(discovery.reachable),
      message: isNonEmptyString(discovery.message) ? discovery.message : undefined
    },
    defaultProviderConfig: {
      providerId: isNonEmptyString(item.defaultProviderConfig?.providerId)
        ? item.defaultProviderConfig.providerId
        : discovery.providerId,
      llmProviderType,
      baseUrl: isNonEmptyString(item.defaultProviderConfig?.baseUrl) ? item.defaultProviderConfig.baseUrl : undefined,
      model
    }
  };
}

function isDynamicModelProvider(provider: unknown): provider is ModelProvider {
  return typeof provider === "string" && modelProviders.has(provider as ModelProvider);
}

function normalizeTags(tags: unknown, fallback: string[]): string[] {
  const normalized = Array.isArray(tags) ? tags.filter((tag): tag is string => isNonEmptyString(tag)) : [];
  return normalized.length > 0 ? normalized : fallback;
}

function providerDisplayName(provider: ModelProvider): string {
  if (provider === "ollama") return "Ollama";
  if (provider === "lmstudio") return "LM Studio";
  if (provider === "openai_compatible") return "OpenAI-compatible";
  return provider;
}

function normalizeProviderModelIds(values: unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const models = Array.isArray(value) ? value : [value];
    for (const model of models) {
      if (!isNonEmptyString(model)) continue;
      const trimmed = model.trim();
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return normalized;
}

function normalizeExamples(examples: unknown): ModeConfig["examples"] {
  if (!Array.isArray(examples)) return [];
  return examples.map((example) => {
    const candidate = example as { input?: unknown; output?: unknown };
    return {
      input: typeof candidate.input === "string" ? candidate.input : "",
      output: typeof candidate.output === "string" ? candidate.output : ""
    };
  });
}
