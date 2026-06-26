import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
  ModelKind,
  ModelDownloadState,
  ModelLibrarySnapshot,
  ModeConfig,
  ModeIconKey,
  ReleaseNote,
  ReplacementRule,
  RecordingPillPosition,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../../shared/types";
import type { AppPaths } from "./app-paths";

interface PersistedConfigState {
  settings: AppSettings;
  modes: ModeConfig[];
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
  autoModeRules: AutoModeRule[];
  replacements: ReplacementRule[];
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

interface LegacySettings extends Partial<AppSettings> {
  toggleHotkey?: string;
  pushToTalkHotkey?: string;
  cancelHotkey?: string;
}

const removedSoundVolumeSettingKey = ["auto", "Increase", "Mic", "Volume"].join("");
const require = createRequire(import.meta.url);
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
  "launchAtLogin",
  "localOnly",
  "retainAudio",
  "audioRetentionDays",
  "textRetentionDays",
  "selectedTextCapture",
  "pasteMethod",
  "activeModeId",
  "activationMode",
  "activationHotkey",
  "recordingPillPosition",
  "preferredAudioInputId",
  "typingBaselineWpm",
  "trayCloseNoticeShownAt",
  "sttSetupSkippedAt",
  "sttSetupCompletedAt"
] satisfies Array<keyof AppSettings>;
const customModeDefaults: ModeConfig = {
  id: "mode",
  kind: "custom",
  iconKey: "sliders-horizontal",
  name: "New mode",
  aiEnabled: true,
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
  backend: "sqlite" | "json" = "json";

  constructor(
    private paths: AppPaths,
    private loadSqlite: () => { DatabaseSync: new (path: string) => any } = () => require("node:sqlite")
  ) {
    mkdirSync(paths.configDir, { recursive: true });
    mkdirSync(paths.dataDir, { recursive: true });
    mkdirSync(paths.cacheDir, { recursive: true });
    mkdirSync(paths.tempDir, { recursive: true });
    mkdirSync(paths.audioDir, { recursive: true });
    this.open();
  }

  getDiagnostics(): string[] {
    return this.backendDiagnostic ? [this.backendDiagnostic] : [];
  }

  getState(): PersistedState {
    const state = this.readState();
    const modes = this.normalizeModes(state.modes);
    const settings = this.normalizeSettings(state.settings, modes);
    return {
      settings,
      modes,
      transcriptionProviders: this.normalizeTranscriptionProviders(state.transcriptionProviders),
      llmProviders: state.llmProviders?.length ? state.llmProviders : clone(defaultLlmProviders),
      autoModeRules: this.normalizeAutoModeRules(state.autoModeRules ?? defaultAutoModeRules, modes),
      replacements: state.replacements ?? [],
      vocabulary: state.vocabulary ?? [],
      history: state.history ?? [],
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
    this.writeState(state);
    return state;
  }

  setModes(modes: ModeConfig[]): PersistedState {
    const state = this.getState();
    state.modes = modes;
    this.writeState(state);
    return state;
  }

  setTranscriptionProviders(providers: TranscriptionProviderConfig[]): PersistedState {
    const state = this.getState();
    state.transcriptionProviders = this.normalizeTranscriptionProviders(providers);
    this.writeState(state);
    return state;
  }

  setLlmProviders(providers: LlmProviderConfig[]): PersistedState {
    const state = this.getState();
    state.llmProviders = providers;
    this.writeState(state);
    return state;
  }

  setAutoModeRules(rules: AutoModeRule[]): PersistedState {
    const state = this.getState();
    state.autoModeRules = rules;
    this.writeState(state);
    return state;
  }

  setReplacements(rules: ReplacementRule[]): PersistedState {
    const state = this.getState();
    state.replacements = rules;
    this.writeState(state);
    return state;
  }

  setVocabulary(entries: VocabularyEntry[]): PersistedState {
    const state = this.getState();
    state.vocabulary = entries;
    this.writeState(state);
    return state;
  }

  setModelLibrary(modelLibrary: ModelLibrarySnapshot): PersistedState {
    const state = this.getState();
    state.modelLibrary = this.normalizeModelLibrary(modelLibrary);
    this.writeState(state);
    return state;
  }

  upsertModelDownload(download: ModelDownloadState): PersistedState {
    const state = this.getState();
    const downloads = state.modelLibrary.downloads.filter((candidate) => candidate.modelId !== download.modelId);
    state.modelLibrary = this.normalizeModelLibrary({
      catalog: modelCatalog,
      downloads: [download, ...downloads],
      activeModelIds: state.modelLibrary.activeModelIds
    });
    this.writeState(state);
    return state;
  }

  deleteModelDownload(modelId: string): PersistedState {
    const state = this.getState();
    state.modelLibrary = this.normalizeModelLibrary({
      catalog: modelCatalog,
      downloads: state.modelLibrary.downloads.filter((download) => download.modelId !== modelId),
      activeModelIds: state.modelLibrary.activeModelIds
    });
    this.writeState(state);
    return state;
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
    this.writeState(state);
    return state;
  }

  addHistory(item: DictationHistoryItem): PersistedState {
    const state = this.getState();
    state.history = [item, ...state.history].slice(0, 2000);
    this.writeState(state);
    return state;
  }

  updateHistoryItem(id: string, patch: Partial<DictationHistoryItem>): PersistedState {
    const state = this.getState();
    state.history = state.history.map((item) => (item.id === id ? { ...item, ...patch } : item));
    this.writeState(state);
    return state;
  }

  deleteHistory(id: string): PersistedState {
    const state = this.getState();
    const deleted = state.history.find((item) => item.id === id);
    if (deleted) this.deleteRetainedAudio(deleted.audioPath);
    state.history = state.history.filter((item) => item.id !== id);
    this.writeState(state);
    return state;
  }

  clearHistory(): PersistedState {
    const state = this.getState();
    for (const item of state.history) {
      this.deleteRetainedAudio(item.audioPath);
    }
    state.history = [];
    this.writeState(state);
    return state;
  }

  clearLocalData(): PersistedState {
    const state: PersistedState = this.defaults();
    this.closeDatabase();
    rmSync(this.paths.configPath, { force: true });
    rmSync(this.paths.historyDbPath, { force: true });
    rmSync(this.paths.historyJsonPath, { force: true });
    rmSync(this.paths.audioDir, { recursive: true, force: true });
    mkdirSync(this.paths.audioDir, { recursive: true });
    this.open();
    this.writeState(state);
    return state;
  }

  private open(): void {
    this.closeDatabase();
    try {
      const { DatabaseSync } = this.loadSqlite();
      this.db = new DatabaseSync(this.paths.historyDbPath);
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

  private writeState(state: PersistedState): void {
    this.writeConfig(toConfigState(state));
    this.writeHistory(state.history);
  }

  private writeConfig(state: PersistedConfigState): void {
    mkdirSync(dirname(this.paths.configPath), { recursive: true });
    writeFileSync(this.paths.configPath, JSON.stringify(state, null, 2));
  }

  private writeHistory(history: DictationHistoryItem[]): void {
    if (this.backend === "sqlite" && this.db) {
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
      return;
    }

    this.writeHistoryJson(history);
  }

  private writeHistoryJson(history: DictationHistoryItem[]): void {
    mkdirSync(dirname(this.paths.historyJsonPath), { recursive: true });
    writeFileSync(this.paths.historyJsonPath, JSON.stringify(history, null, 2));
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
      // Retained audio cleanup should not block history mutations.
    }
  }

  private defaults(): PersistedState {
    return {
      settings: clone(defaultSettings),
      modes: clone(defaultModes),
      transcriptionProviders: clone(defaultTranscriptionProviders),
      llmProviders: clone(defaultLlmProviders),
      autoModeRules: clone(defaultAutoModeRules),
      replacements: [],
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
      selectedTextCapture: currentSettings.selectedTextCapture === "disabled" ? "disabled" : "clipboard_restore",
      pasteMethod: "clipboard_restore",
      trayCloseNoticeShownAt:
        typeof currentSettings.trayCloseNoticeShownAt === "string" ? currentSettings.trayCloseNoticeShownAt : undefined
    };
    const modeIds = new Set(modes.map((mode) => mode.id));
    normalized.activeModeId = legacyModeIdMap.get(normalized.activeModeId) ?? normalized.activeModeId;
    if (!modeIds.has(normalized.activeModeId)) {
      normalized.activeModeId = "default";
    }
    normalized.typingBaselineWpm = Number.isFinite(normalized.typingBaselineWpm)
      ? Math.max(1, normalized.typingBaselineWpm)
      : defaultSettings.typingBaselineWpm;
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
      aiEnabled: typeof mode?.aiEnabled === "boolean" ? mode.aiEnabled : base.aiEnabled,
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

  private normalizeAutoModeRules(rules: AutoModeRule[], modes: ModeConfig[]): AutoModeRule[] {
    const modeIds = new Set(modes.map((mode) => mode.id));
    return rules
      .map((rule) => ({ ...rule, modeId: legacyModeIdMap.get(rule.modeId) ?? rule.modeId }))
      .filter((rule) => !removedLegacyModeIds.has(rule.modeId) && modeIds.has(rule.modeId));
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

  private normalizeModelLibrary(modelLibrary: ModelLibrarySnapshot | undefined): ModelLibrarySnapshot {
    const catalogIds = new Set(modelCatalog.map((item) => item.id));
    const activeModelIds: ModelLibrarySnapshot["activeModelIds"] = {};
    const activeVoiceModelId = modelLibrary?.activeModelIds?.voice;
    const activeLanguageModelId = modelLibrary?.activeModelIds?.language;

    if (activeVoiceModelId && catalogIds.has(activeVoiceModelId)) {
      activeModelIds.voice = activeVoiceModelId;
    }
    if (activeLanguageModelId && catalogIds.has(activeLanguageModelId)) {
      activeModelIds.language = activeLanguageModelId;
    }

    return {
      catalog: modelCatalog,
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

  private normalizeReleaseNotes(releaseNotes: ReleaseNote[] | undefined): ReleaseNote[] {
    const source = releaseNotes?.length ? releaseNotes : defaultReleaseNotes;
    return source.filter((note) => !removedReleaseNoteIds.has(note.id)).map((note) => ({ ...note }));
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toConfigState(state: PersistedState): PersistedConfigState {
  return {
    settings: state.settings,
    modes: state.modes,
    transcriptionProviders: state.transcriptionProviders,
    llmProviders: state.llmProviders,
    autoModeRules: state.autoModeRules,
    replacements: state.replacements,
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
