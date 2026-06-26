export type DictationModeKind = "built_in" | "custom";
export type ModeIconKey = "mic" | "message-square" | "mail" | "notebook-pen" | "sliders-horizontal";

export type SttStreamingMode = "none" | "completed_audio_sse" | "live_realtime";
export type ActivationMode = "toggle" | "push_to_talk";
export type RecordingPillPosition = "bottom_left" | "bottom_center" | "bottom_right";

export type TranscriptionProviderType =
  | "whisper_cpp"
  | "sherpa_onnx"
  | "local_openai_compatible_stt"
  | "cloud_openai"
  | "cloud_groq"
  | "cloud_openai_compatible_stt";

export type LlmProviderType =
  | "ollama"
  | "lmstudio"
  | "llama_cpp_openai"
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "custom_openai_compatible";

export type ModelKind = "voice" | "language";

export type ModelProvider =
  | "whisper_cpp"
  | "nvidia"
  | "ollama"
  | "openai"
  | "groq"
  | "anthropic"
  | "google"
  | "openrouter";

export type ModelDownloadStrategy = "direct_file" | "archive" | "ollama_pull" | "none";
export type ModelDownloadStatus = "not_downloaded" | "downloading" | "downloaded" | "error";
export type SttRuntimeId = "whisper.cpp" | "sherpa-onnx";
export type RuntimeAvailabilityStatus = "available" | "missing" | "unsupported";
export type SttPreferredLanguageScope = "multilingual" | "english";
export type SttRuntimeInstallStatus =
  | "ready"
  | "not_installed"
  | "downloading"
  | "installing"
  | "repairable"
  | "error"
  | "unsupported";
export type SttRuntimeSource = "env" | "resources" | "cache" | "vendor" | "legacy_vendor";

export interface SttRuntimeAvailability {
  id: SttRuntimeId;
  label: string;
  status: RuntimeAvailabilityStatus;
  platformKey: string;
  binaryPath?: string;
  source?: SttRuntimeSource;
  version?: string;
  message: string;
}

export interface SttRuntimeInstallState {
  id: SttRuntimeId;
  label: string;
  platformKey: string;
  requiredVersion: string;
  installedVersion?: string;
  status: SttRuntimeInstallStatus;
  source?: SttRuntimeSource;
  binaryPath?: string;
  rootDir?: string;
  progressBytes: number;
  totalBytes?: number;
  error?: string;
  message: string;
  canDownload: boolean;
  canRepair: boolean;
}

export interface SttBenchmarkResult {
  modelId: string;
  audioDurationMs: number;
  elapsedMs: number;
  realtimeFactor: number;
  totalMemoryBytes: number;
  cpuThreadCount: number;
  createdAt: string;
}

export interface SttModelRecommendation {
  recommendedModelId: string;
  fallbackModelId: string;
  reason: string;
  benchmark?: SttBenchmarkResult;
  alternatives: Array<{ modelId: string; reason: string }>;
}

export interface SttSetupSnapshot {
  skipped: boolean;
  completed: boolean;
  needsSetup: boolean;
  runtimes: Record<SttRuntimeId, SttRuntimeInstallState>;
  recommendation?: SttModelRecommendation;
}

export interface ContextSnapshot {
  appName?: string;
  appId?: string;
  windowTitle?: string;
  browserUrl?: string;
  browserDomain?: string;
  focusedRole?: string;
  focusedText?: string;
  selectedText?: string;
  clipboardText?: string;
  capturedAt: string;
  sourceQuality: "full" | "partial" | "fallback" | "unavailable";
  diagnostics: string[];
}

export interface ModeConfig {
  id: string;
  kind: DictationModeKind;
  iconKey: ModeIconKey;
  name: string;
  aiEnabled: boolean;
  instructionPrompt: string;
  examples: Array<{ input: string; output: string }>;
  language?: string | "auto";
  context: {
    app: boolean;
    selectedText: boolean;
    clipboardText: boolean;
  };
}

export interface ReleaseNote {
  id: string;
  date: string;
  heading: string;
  summary?: string;
}

export interface ModelCatalogItem {
  id: string;
  name: string;
  kind: ModelKind;
  provider: ModelProvider;
  description?: string;
  sizeBytes?: number;
  isCloud: boolean;
  isOffline: boolean;
  tags: string[];
  downloadStrategy: ModelDownloadStrategy;
  downloadUrl?: string;
  filename?: string;
  extractDir?: string;
  ollamaModel?: string;
  defaultProviderConfig?: {
    sttProviderType?: TranscriptionProviderType;
    llmProviderType?: LlmProviderType;
    baseUrl?: string;
    endpointPath?: string;
    model?: string;
  };
}

export interface ModelDownloadState {
  modelId: string;
  status: ModelDownloadStatus;
  progressBytes: number;
  totalBytes?: number;
  localPath?: string;
  error?: string;
  downloadedAt?: string;
  favorite: boolean;
}

export interface ModelLibrarySnapshot {
  catalog: ModelCatalogItem[];
  downloads: ModelDownloadState[];
  activeModelIds: Partial<Record<ModelKind, string>>;
}

export interface TranscriptionProviderConfig {
  id: string;
  type: TranscriptionProviderType;
  name: string;
  baseUrl: string;
  endpointPath?: string;
  apiKeySecretId?: string;
  apiKey?: string;
  isCloud: boolean;
  isLocal: boolean;
  defaultModel?: string;
  defaultLanguage?: string | "auto";
  streamingMode: SttStreamingMode;
  enabled: boolean;
}

export interface LlmProviderConfig {
  id: string;
  type: LlmProviderType;
  name: string;
  baseUrl?: string;
  apiKeySecretId?: string;
  apiKey?: string;
  isCloud: boolean;
  defaultModel?: string;
  enabled: boolean;
}

export interface AutoModeRule {
  id: string;
  name: string;
  modeId: string;
  priority: number;
  enabled: boolean;
  match: {
    domain?: string;
    domainWildcard?: string;
    appId?: string;
    appName?: string;
    windowTitleIncludes?: string;
  };
}

export interface ReplacementRule {
  id: string;
  source: string;
  target: string;
  category?: string;
  caseSensitive: boolean;
  regex: boolean;
  runBeforeLlm: boolean;
  runAfterLlm: boolean;
  enabled: boolean;
  notes?: string;
}

export interface VocabularyEntry {
  id: string;
  term: string;
  pronunciation?: string;
  category?: string;
  enabled: boolean;
  notes?: string;
}

export interface AppSettings {
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  localOnly: boolean;
  retainAudio: boolean;
  audioRetentionDays: number;
  textRetentionDays: number;
  selectedTextCapture: "disabled" | "clipboard_restore";
  pasteMethod: "clipboard_restore" | "clipboard_only";
  activeModeId: string;
  activationMode: ActivationMode;
  activationHotkey: string;
  recordingPillPosition: RecordingPillPosition;
  preferredAudioInputId?: string;
  typingBaselineWpm: number;
  trayCloseNoticeShownAt?: string;
  sttSetupSkippedAt?: string;
  sttSetupCompletedAt?: string;
  sttPreferredLanguageScope: SttPreferredLanguageScope;
}

export interface DictationHistoryItem {
  id: string;
  audioPath: string | null;
  rawTranscript: string;
  processedOutput: string;
  modeId: string;
  modeName: string;
  transcriptionProviderId?: string;
  transcriptionProviderType?: string;
  transcriptionModel?: string;
  transcriptionProviderCloud: boolean;
  transcriptionStreamingMode: SttStreamingMode;
  llmProviderId?: string;
  llmProviderType?: string;
  llmModel?: string;
  llmProviderCloud: boolean;
  appName?: string;
  appId?: string;
  windowTitle?: string;
  browserDomain?: string;
  createdAt: string;
  recordingStartedAt?: string;
  recordingStoppedAt?: string;
  recordingDurationMs?: number;
  rawWordCount?: number;
  processedWordCount?: number;
}

export interface DictationSession {
  id: string;
  status: "idle" | "recording" | "transcribing" | "processing" | "pasting" | "complete" | "cancelled" | "error";
  modeId: string;
  startedAt?: string;
  transcriptPreview?: string;
  error?: string;
  cloudStt: boolean;
  cloudLlm: boolean;
  streamingMode: SttStreamingMode;
}

export interface RecordingLevelPayload {
  sessionId: string;
  level: number;
}

export interface RecordingStartPayload {
  sessionId: string;
  preferredAudioInputId?: string;
}

export interface TranscriptionResult {
  text: string;
  providerId: string;
  model?: string;
  streamingMode: SttStreamingMode;
}

export interface ProcessedResult {
  text: string;
  providerId?: string;
  model?: string;
}

export interface AppStateSnapshot {
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
  sttSetup: SttSetupSnapshot;
  session: DictationSession;
  capabilities: CapabilityReport;
}

export interface PillStateSnapshot {
  session: DictationSession;
  theme: AppSettings["theme"];
}

export interface CapabilityReport {
  sttRuntimes: Record<SttRuntimeId, SttRuntimeAvailability>;
  stt: {
    diagnostics: string[];
  };
  hotkeys: {
    backend: "xdg_desktop_portal" | "gnome_custom_shortcut" | "kde_kglobalaccel" | "hyprland_bind" | "electron_global_shortcut";
    pushToTalkRelease: boolean;
    registered: boolean;
    triggerDescription?: string;
    diagnostics: string[];
  };
  context: {
    backend: "desktop_metadata" | "clipboard_fallback";
    appMetadata: boolean;
    focusedText: boolean;
    selectedText: boolean;
    browserDomain: boolean;
    diagnostics: string[];
  };
  paste: {
    backend: "linux_native_helper" | "wtype" | "xdotool" | "ydotool" | "xdg_remote_desktop_keyboard" | "clipboard_only";
    automationAvailable: boolean;
    permissionRequired: boolean;
    diagnostics: string[];
    availableBackends?: Array<"linux_native_helper" | "wtype" | "xdotool" | "ydotool" | "xdg_remote_desktop_keyboard" | "clipboard_only">;
    attemptedBackends?: Array<"linux_native_helper" | "wtype" | "xdotool" | "ydotool" | "xdg_remote_desktop_keyboard" | "clipboard_only">;
    missingTools?: string[];
    setupHints?: string[];
  };
  storage: {
    backend: "sqlite" | "json";
    diagnostics: string[];
  };
}

export interface ProviderValidationResult {
  ok: boolean;
  message: string;
  capabilities?: Partial<{
    fileTranscription: boolean;
    completedAudioStreaming: boolean;
    liveRealtimeStreaming: boolean;
    modelDiscovery: boolean;
  }>;
}
