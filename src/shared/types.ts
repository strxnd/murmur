export type DictationModeKind = "default" | "custom";
export type ModePresetId = "voice_to_text" | "message" | "mail" | "note" | "custom";

export type SttStreamingMode = "none" | "completed_audio_sse" | "live_realtime";
export type ActivationMode = "toggle" | "push_to_talk";

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

export interface SttRuntimeAvailability {
  id: SttRuntimeId;
  label: string;
  status: RuntimeAvailabilityStatus;
  platformKey: string;
  binaryPath?: string;
  source?: "env" | "resources" | "vendor" | "legacy_vendor";
  version?: string;
  message: string;
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
  presetId: ModePresetId;
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
  preferredAudioInputId?: string;
  typingBaselineWpm: number;
  autoIncreaseMicVolume: boolean;
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
  session: DictationSession;
  capabilities: CapabilityReport;
}

export interface CapabilityReport {
  sttRuntimes: Record<SttRuntimeId, SttRuntimeAvailability>;
  hotkeys: {
    backend: "electron_global_shortcut";
    pushToTalkRelease: boolean;
    registered: boolean;
    diagnostics: string[];
  };
  context: {
    backend: "hyprctl_clipboard_fallback";
    appMetadata: boolean;
    focusedText: boolean;
    selectedText: boolean;
    browserDomain: boolean;
    diagnostics: string[];
  };
  paste: {
    backend: "ydotool_clipboard" | "clipboard_only";
    automationAvailable: boolean;
    diagnostics: string[];
  };
  storage: {
    backend: "sqlite" | "json";
    diagnostics: string[];
  };
  sound: {
    backend: "wpctl_pactl";
    wpctlAvailable: boolean;
    pactlAvailable: boolean;
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
