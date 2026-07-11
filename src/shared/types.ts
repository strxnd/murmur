export type DictationModeKind = "built_in" | "custom";
export type ModeIconKey = "mic" | "message-square" | "mail" | "notebook-pen" | "sliders-horizontal";

export type SttStreamingMode = "none" | "completed_audio_sse" | "live_realtime";
export type ActivationMode = "toggle" | "push_to_talk";
export type RecordingPillPosition = "bottom_left" | "bottom_center" | "bottom_right";
export type GlobalShortcutActionId = "activation" | "mode-selector";

export type TranscriptionProviderType =
  | "whisper_cpp"
  | "sherpa_onnx"
  | "local_openai_compatible_stt"
  | "cloud_openai"
  | "cloud_openai_compatible_stt";

export type LlmProviderType =
  | "ollama"
  | "lmstudio"
  | "llama_cpp_openai"
  | "openai"
  | "anthropic"
  | "google"
  | "custom_openai_compatible";

export type ModelKind = "voice" | "language";

export type ModelDiscoveryOrigin = "discovered" | "manual";

export type ModelProvider =
  | "whisper_cpp"
  | "nvidia"
  | "ollama"
  | "lmstudio"
  | "openai"
  | "openai_compatible"
  | "anthropic"
  | "google";

export type ModelDownloadStrategy = "direct_file" | "archive" | "ollama_pull" | "none";
export type ModelDownloadStatus = "not_downloaded" | "downloading" | "downloaded" | "error";
export type SttRuntimeId = "whisper.cpp" | "sherpa-onnx";
export type SttRuntimeAccelerator = "cpu" | "cuda";
export type SttRuntimeVariantKey = string;
export type SttRuntimeActionTarget =
  | SttRuntimeVariantKey
  | {
      id: SttRuntimeId;
      accelerator: SttRuntimeAccelerator;
      variantKey?: SttRuntimeVariantKey;
    };
export type RuntimeAvailabilityStatus = "available" | "missing" | "unsupported";
export type SttRuntimeInstallStatus =
  | "ready"
  | "not_installed"
  | "downloading"
  | "installing"
  | "repairable"
  | "error"
  | "unsupported";
export type SttRuntimeSource = "env" | "resources" | "cache" | "vendor";

export interface SttRuntimeAvailability {
  id: SttRuntimeId;
  variantKey: SttRuntimeVariantKey;
  accelerator: SttRuntimeAccelerator;
  label: string;
  status: RuntimeAvailabilityStatus;
  platformKey: string;
  binaryPath?: string;
  source?: SttRuntimeSource;
  version?: string;
  abi?: string;
  message: string;
}

export interface SttRuntimeInstallState {
  id: SttRuntimeId;
  variantKey: SttRuntimeVariantKey;
  accelerator: SttRuntimeAccelerator;
  label: string;
  platformKey: string;
  requiredVersion: string;
  installedVersion?: string;
  status: SttRuntimeInstallStatus;
  source?: SttRuntimeSource;
  binaryPath?: string;
  rootDir?: string;
  abi?: string;
  progressBytes: number;
  totalBytes?: number;
  error?: string;
  message: string;
  canDownload: boolean;
  canRepair: boolean;
}

export interface SttSetupSnapshot {
  skipped: boolean;
  completed: boolean;
  needsSetup: boolean;
  runtimes: Record<SttRuntimeVariantKey, SttRuntimeInstallState>;
}

export interface ContextSnapshot {
  appName?: string;
  appId?: string;
  windowTitle?: string;
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
  description: string;
  aiEnabled: boolean;
  writingStyle: string;
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
  downloadStrategy: ModelDownloadStrategy;
  downloadUrl?: string;
  filename?: string;
  extractDir?: string;
  sha256?: string;
  ollamaModel?: string;
  discovery?: {
    origin: ModelDiscoveryOrigin;
    providerId: string;
    lastSeenAt?: string;
    reachable: boolean;
    message?: string;
  };
  defaultProviderConfig?: {
    providerId?: string;
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
  models?: string[];
  enabled: boolean;
}

export interface AutoModeRule {
  id: string;
  name: string;
  modeId: string;
  priority: number;
  enabled: boolean;
  match: {
    appId?: string;
    appName?: string;
    windowTitleIncludes?: string;
  };
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
  textRetentionDays: number;
  selectedTextCapture: "disabled" | "enabled";
  activeModeId: string;
  activationMode: ActivationMode;
  activationHotkey: string;
  modeSelectorHotkey: string;
  recordingPillPosition: RecordingPillPosition;
  preferredAudioInputId?: string;
  typingBaselineWpm: number;
  trayCloseNoticeShownAt?: string;
  accelerationRuntimeInstallPromptDismissedAt?: string;
  sttSetupSkippedAt?: string;
  sttSetupCompletedAt?: string;
  onboardingSkippedAt?: string;
  onboardingCompletedAt?: string;
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
  transcriptionAccelerator?: SttRuntimeAccelerator;
  llmProviderId?: string;
  llmProviderType?: string;
  llmModel?: string;
  llmProviderCloud: boolean;
  appName?: string;
  appId?: string;
  windowTitle?: string;
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
  accelerator?: SttRuntimeAccelerator;
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

export interface ModeSelectorStateSnapshot {
  theme: AppSettings["theme"];
  modes: ModeConfig[];
  activeModeId: string;
  session: DictationSession;
}

export interface HotkeyActionCapability {
  registered: boolean;
  triggerDescription?: string;
  diagnostics: string[];
}

export interface GpuProbeAdapterReport {
  available: boolean;
  devices: string[];
  diagnostics: string[];
}

export interface AccelerationProbeReport {
  nvidia: GpuProbeAdapterReport;
  diagnostics: string[];
}

export type AutomationPermissionStatus =
  | "not_required"
  | "not_determined_or_denied"
  | "trusted"
  | "trusted_but_helper_failed";

export interface AutomationPermissionReport {
  status: AutomationPermissionStatus;
  permissionRequired: boolean;
  canPrompt: boolean;
  diagnostics: string[];
}

export interface CapabilityReport {
  sttRuntimes: Record<SttRuntimeVariantKey, SttRuntimeAvailability>;
  stt: {
    diagnostics: string[];
    accelerationProbe: AccelerationProbeReport;
  };
  hotkeys: {
    backend:
      | "xdg_desktop_portal"
      | "gnome_custom_shortcut"
      | "kde_kglobalaccel"
      | "hyprland_bind"
      | "macos_event_tap"
      | "electron_global_shortcut";
    pushToTalkRelease: boolean;
    registered: boolean;
    triggerDescription?: string;
    diagnostics: string[];
    modeSelector: HotkeyActionCapability;
  };
  context: {
    backend: "desktop_metadata" | "clipboard_fallback";
    appMetadata: boolean;
    selectedText: boolean;
    diagnostics: string[];
  };
  automation: AutomationPermissionReport;
  paste: {
    backend:
      | "linux_native_helper"
      | "macos_accessibility_helper"
      | "wtype"
      | "xdotool"
      | "ydotool"
      | "xdg_remote_desktop_keyboard"
      | "clipboard_only";
    automationAvailable: boolean;
    permissionRequired: boolean;
    diagnostics: string[];
    availableBackends?: Array<
      "linux_native_helper" | "macos_accessibility_helper" | "wtype" | "xdotool" | "ydotool" | "xdg_remote_desktop_keyboard" | "clipboard_only"
    >;
    attemptedBackends?: Array<
      "linux_native_helper" | "macos_accessibility_helper" | "wtype" | "xdotool" | "ydotool" | "xdg_remote_desktop_keyboard" | "clipboard_only"
    >;
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
