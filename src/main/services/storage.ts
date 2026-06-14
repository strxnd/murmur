import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
  AppSettings,
  AutoModeRule,
  DictationHistoryItem,
  DictationModeKind,
  LlmProviderConfig,
  ModelDownloadState,
  ModelLibrarySnapshot,
  ModeConfig,
  ModePresetId,
  ReleaseNote,
  ReplacementRule,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../../shared/types";

interface PersistedState {
  settings: AppSettings;
  modes: ModeConfig[];
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
  autoModeRules: AutoModeRule[];
  replacements: ReplacementRule[];
  vocabulary: VocabularyEntry[];
  history: DictationHistoryItem[];
  modelLibrary: ModelLibrarySnapshot;
  releaseNotes: ReleaseNote[];
}

const require = createRequire(import.meta.url);
const oldBuiltInModeIds = new Set(["voice_to_text", "message", "email", "meeting", "super", "custom"]);
const modePresetIds = new Set<ModePresetId>(["voice_to_text", "message", "mail", "note", "custom"]);
const customModeDefaults: ModeConfig = {
  id: "custom",
  kind: "custom",
  presetId: "custom",
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
  private jsonPath: string;
  private diagnostics: string[] = [];
  backend: "sqlite" | "json" = "json";

  constructor(private userDataPath: string) {
    this.jsonPath = join(userDataPath, "murmur-state.json");
    mkdirSync(userDataPath, { recursive: true });
    this.open();
  }

  getDiagnostics(): string[] {
    return this.diagnostics;
  }

  getState(): PersistedState {
    const state = this.readState();
    const modes = this.normalizeModes(state.modes);
    const settings = this.normalizeSettings(state.settings, modes);
    return {
      settings,
      modes,
      transcriptionProviders: state.transcriptionProviders?.length
        ? state.transcriptionProviders
        : clone(defaultTranscriptionProviders),
      llmProviders: state.llmProviders?.length ? state.llmProviders : clone(defaultLlmProviders),
      autoModeRules: this.normalizeAutoModeRules(state.autoModeRules ?? defaultAutoModeRules, modes),
      replacements: state.replacements ?? [],
      vocabulary: state.vocabulary ?? [],
      history: state.history ?? [],
      modelLibrary: this.normalizeModelLibrary(state.modelLibrary),
      releaseNotes: state.releaseNotes?.length ? state.releaseNotes : clone(defaultReleaseNotes)
    };
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
    state.transcriptionProviders = providers;
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
      downloads: [download, ...downloads]
    });
    this.writeState(state);
    return state;
  }

  deleteModelDownload(modelId: string): PersistedState {
    const state = this.getState();
    state.modelLibrary = this.normalizeModelLibrary({
      catalog: modelCatalog,
      downloads: state.modelLibrary.downloads.filter((download) => download.modelId !== modelId)
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
    state.history = state.history.filter((item) => item.id !== id);
    this.writeState(state);
    return state;
  }

  clearHistory(): PersistedState {
    const state = this.getState();
    state.history = [];
    this.writeState(state);
    return state;
  }

  clearLocalData(): PersistedState {
    const state: PersistedState = this.defaults();
    this.writeState(state);
    return state;
  }

  private open(): void {
    try {
      const { DatabaseSync } = require("node:sqlite");
      const dbPath = join(this.userDataPath, "murmur.sqlite");
      this.db = new DatabaseSync(dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
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
      this.diagnostics.push("Using node:sqlite storage.");
    } catch (error) {
      this.backend = "json";
      this.diagnostics.push(`SQLite unavailable; using JSON storage. ${String(error)}`);
      if (!existsSync(this.jsonPath)) {
        this.writeJson(this.defaults());
      }
    }
  }

  private readState(): PersistedState {
    if (this.backend === "sqlite" && this.db) {
      const kvRows = this.db.prepare("SELECT key, value FROM kv").all() as Array<{ key: string; value: string }>;
      const data = Object.fromEntries(kvRows.map((row) => [row.key, JSON.parse(row.value)]));
      const historyRows = this.db
        .prepare("SELECT data FROM dictations ORDER BY created_at DESC LIMIT 2000")
        .all() as Array<{ data: string }>;
      return {
        ...this.defaults(),
        ...data,
        history: historyRows.map((row) => JSON.parse(row.data))
      };
    }

    if (!existsSync(this.jsonPath)) {
      return this.defaults();
    }

    try {
      return { ...this.defaults(), ...JSON.parse(readFileSync(this.jsonPath, "utf8")) };
    } catch {
      return this.defaults();
    }
  }

  private writeState(state: PersistedState): void {
    if (this.backend === "sqlite" && this.db) {
      const withoutHistory = { ...state, history: undefined };
      const setKv = this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
      for (const [key, value] of Object.entries(withoutHistory)) {
        if (value !== undefined) setKv.run(key, JSON.stringify(value));
      }

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
      for (const item of state.history) {
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

    this.writeJson(state);
  }

  private writeJson(state: PersistedState): void {
    mkdirSync(dirname(this.jsonPath), { recursive: true });
    writeFileSync(this.jsonPath, JSON.stringify(state, null, 2));
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
      releaseNotes: clone(defaultReleaseNotes)
    };
  }

  private normalizeSettings(settings: AppSettings | undefined, modes: ModeConfig[]): AppSettings {
    const normalized = { ...defaultSettings, ...(settings ?? {}) };
    const modeIds = new Set(modes.map((mode) => mode.id));
    if (oldBuiltInModeIds.has(normalized.activeModeId) || !modeIds.has(normalized.activeModeId)) {
      normalized.activeModeId = "default";
    }
    normalized.typingBaselineWpm = Number.isFinite(normalized.typingBaselineWpm)
      ? Math.max(1, normalized.typingBaselineWpm)
      : defaultSettings.typingBaselineWpm;
    normalized.autoIncreaseMicVolume = Boolean(normalized.autoIncreaseMicVolume);
    return normalized;
  }

  private normalizeModes(modes: Array<Partial<ModeConfig>> | undefined): ModeConfig[] {
    if (!modes?.length) return clone(defaultModes);

    const defaultModeSource = modes.find((mode) => mode.id === "default" || mode.kind === "default");
    const customModes: ModeConfig[] = [];
    const seenCustomIds = new Set<string>();

    for (const mode of modes) {
      if (!isUsableModeId(mode.id) || mode.id === "default" || oldBuiltInModeIds.has(mode.id) || seenCustomIds.has(mode.id)) {
        continue;
      }
      seenCustomIds.add(mode.id);
      customModes.push(this.normalizeMode(mode, "custom"));
    }

    return [this.normalizeMode(defaultModeSource ?? defaultModes[0], "default"), ...customModes];
  }

  private normalizeMode(mode: Partial<ModeConfig> | undefined, kind: DictationModeKind): ModeConfig {
    const base = kind === "default" ? defaultModes[0] : customModeDefaults;
    const context = mode?.context ?? base.context;

    return {
      id: kind === "default" ? "default" : isUsableModeId(mode?.id) ? mode.id : base.id,
      kind,
      presetId: isModePresetId(mode?.presetId) ? mode.presetId : base.presetId,
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
    return rules.filter((rule) => !oldBuiltInModeIds.has(rule.modeId) && modeIds.has(rule.modeId));
  }

  private normalizeModelLibrary(modelLibrary: ModelLibrarySnapshot | undefined): ModelLibrarySnapshot {
    const catalogIds = new Set(modelCatalog.map((item) => item.id));
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
        }))
    };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isUsableModeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isModePresetId(value: unknown): value is ModePresetId {
  return typeof value === "string" && modePresetIds.has(value as ModePresetId);
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
