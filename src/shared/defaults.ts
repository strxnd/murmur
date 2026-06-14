import type {
  AppSettings,
  AutoModeRule,
  DictationSession,
  LlmProviderConfig,
  ModelLibrarySnapshot,
  ModeConfig,
  TranscriptionProviderConfig
} from "./types";
import { defaultReleaseNotes } from "./release-notes";
import { modelCatalog } from "./model-catalog";

export const defaultSettings: AppSettings = {
  theme: "dark",
  launchAtLogin: false,
  localOnly: false,
  retainAudio: false,
  audioRetentionDays: 7,
  textRetentionDays: 90,
  selectedTextCapture: "clipboard_restore",
  pasteMethod: "clipboard_restore",
  activeModeId: "default",
  activationMode: "toggle",
  activationHotkey: "CommandOrControl+Alt+Space",
  recordingPillPosition: "bottom_center",
  typingBaselineWpm: 40
};

export const defaultSession: DictationSession = {
  id: "idle",
  status: "idle",
  modeId: defaultSettings.activeModeId,
  cloudStt: false,
  cloudLlm: false,
  streamingMode: "none"
};

export const defaultModes: ModeConfig[] = [
  {
    id: "default",
    kind: "default",
    presetId: "custom",
    name: "Default",
    aiEnabled: true,
    instructionPrompt:
      "Use application, selected text, focused field, and clipboard context to produce text that fits the user's current task. If the transcript is a command about selected text, transform only that selected text. Otherwise, produce polished dictation for the active app.",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: true, clipboardText: true }
  }
];

export const defaultTranscriptionProviders: TranscriptionProviderConfig[] = [
  {
    id: "local-whisper-cpp",
    type: "whisper_cpp",
    name: "Bundled whisper.cpp",
    baseUrl: "murmur://runtime/whisper.cpp",
    endpointPath: "/inference",
    isCloud: false,
    isLocal: true,
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: false
  },
  {
    id: "external-whisper-cpp",
    type: "whisper_cpp",
    name: "External whisper.cpp server",
    baseUrl: "http://127.0.0.1:8080",
    endpointPath: "/inference",
    isCloud: false,
    isLocal: true,
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: false
  },
  {
    id: "local-nvidia-parakeet-stt",
    type: "sherpa_onnx",
    name: "Bundled NVIDIA Parakeet STT",
    baseUrl: "murmur://runtime/sherpa-onnx",
    isCloud: false,
    isLocal: true,
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: false
  },
  {
    id: "local-openai-stt",
    type: "local_openai_compatible_stt",
    name: "Local OpenAI-compatible STT",
    baseUrl: "http://127.0.0.1:8000/v1",
    endpointPath: "/audio/transcriptions",
    isCloud: false,
    isLocal: true,
    defaultModel: "Systran/faster-whisper-large-v3",
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: false
  },
  {
    id: "openai-stt",
    type: "cloud_openai",
    name: "OpenAI transcription",
    baseUrl: "https://api.openai.com/v1",
    endpointPath: "/audio/transcriptions",
    isCloud: true,
    isLocal: false,
    defaultModel: "gpt-4o-mini-transcribe",
    defaultLanguage: "auto",
    streamingMode: "completed_audio_sse",
    enabled: false
  },
  {
    id: "groq-stt",
    type: "cloud_groq",
    name: "Groq Whisper",
    baseUrl: "https://api.groq.com/openai/v1",
    endpointPath: "/audio/transcriptions",
    isCloud: true,
    isLocal: false,
    defaultModel: "whisper-large-v3-turbo",
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: false
  }
];

export const defaultLlmProviders: LlmProviderConfig[] = [
  {
    id: "ollama",
    type: "ollama",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    isCloud: false,
    defaultModel: "llama3.1",
    enabled: true
  },
  {
    id: "lmstudio",
    type: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    isCloud: false,
    defaultModel: "local-model",
    enabled: false
  },
  {
    id: "openai-llm",
    type: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    isCloud: true,
    defaultModel: "gpt-4.1-mini",
    enabled: false
  },
  {
    id: "anthropic",
    type: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    isCloud: true,
    defaultModel: "claude-sonnet-4-5",
    enabled: false
  },
  {
    id: "google",
    type: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    isCloud: true,
    defaultModel: "gemini-2.5-flash",
    enabled: false
  },
  {
    id: "openrouter",
    type: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    isCloud: true,
    defaultModel: "openai/gpt-4.1-mini",
    enabled: false
  }
];

export const defaultAutoModeRules: AutoModeRule[] = [];

export const defaultModelLibrary: ModelLibrarySnapshot = {
  catalog: modelCatalog,
  downloads: [],
  activeModelIds: {}
};

export { defaultReleaseNotes };
