import type {
  AppSettings,
  AutoModeRule,
  DictationSession,
  LlmProviderConfig,
  ModelLibrarySnapshot,
  ModeConfig,
  ModePreset,
  TranscriptionProviderConfig
} from "./types";
import { defaultReleaseNotes } from "./release-notes";
import { modelCatalog } from "./model-catalog";

export const defaultSettings: AppSettings = {
  theme: "dark",
  textRetentionDays: 90,
  selectedTextCapture: "enabled",
  activeModeId: "default",
  activationMode: "toggle",
  activationHotkey: "Alt+Space",
  modeSelectorHotkey: "Alt+Shift+K",
  recordingPillPosition: "bottom_center",
  typingBaselineWpm: 40
};

export const maxRecordingDurationMs = 10 * 60 * 1000;

export const defaultSession: DictationSession = {
  id: "idle",
  status: "idle",
  modeId: defaultSettings.activeModeId,
  cloudStt: false,
  cloudLlm: false,
  streamingMode: "none"
};

export const modePresets: ModePreset[] = [
  {
    id: "default",
    iconKey: "sliders-horizontal",
    name: "Default",
    description: "Adapts dictation to the active app, selected text, and clipboard so the result is ready for the current task.",
    aiEnabled: true,
    writingStyle: "",
    instructionPrompt:
      "Use application, selected text, and clipboard context to produce text that fits the user's current task. If the transcript is a command about selected text, transform only that selected text. Otherwise, produce polished dictation for the active app.",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: true, clipboardText: true }
  },
  {
    id: "voice_to_text",
    iconKey: "mic",
    name: "Voice to text",
    description: "Keeps speech close to the transcript with light cleanup for punctuation, casing, and obvious recognition mistakes.",
    aiEnabled: false,
    writingStyle: "",
    instructionPrompt:
      "Return the transcript as directly as possible. Preserve the user's words and only correct clear transcription mistakes, punctuation, and casing.",
    examples: [],
    language: "auto",
    context: { app: false, selectedText: false, clipboardText: false }
  },
  {
    id: "message",
    iconKey: "message-square",
    name: "Message",
    description: "Turns speech into a concise chat or direct message that sounds natural and is ready to send.",
    aiEnabled: true,
    writingStyle: "",
    instructionPrompt:
      "Write a concise chat or direct message that fits the current conversation. Keep it natural, clear, and ready to send.",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: true, clipboardText: false }
  },
  {
    id: "mail",
    iconKey: "mail",
    name: "Mail",
    description: "Drafts or revises email text with a professional tone and useful email structure.",
    aiEnabled: true,
    writingStyle: "",
    instructionPrompt:
      "Draft or revise email text with a clear subject-aware structure, professional tone, and appropriate greeting and sign-off when useful.",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: true, clipboardText: true }
  },
  {
    id: "note",
    iconKey: "notebook-pen",
    name: "Note",
    description: "Organizes speech into structured notes with concise headings, bullets, and action items when useful.",
    aiEnabled: true,
    writingStyle: "",
    instructionPrompt:
      "Turn the transcript into structured notes. Use concise headings, bullets, and action items when they make the content easier to scan.",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: false, clipboardText: false }
  },
  {
    id: "custom",
    iconKey: "sliders-horizontal",
    name: "Custom",
    description: "Start with a blank mode and configure every detail yourself.",
    aiEnabled: true,
    writingStyle: "",
    instructionPrompt: "",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: true, clipboardText: true }
  }
];

export const defaultModes: ModeConfig[] = modePresets
  .filter((preset) => preset.id !== "custom")
  .map((preset) => ({ ...preset, examples: [...preset.examples], context: { ...preset.context } }));

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
    enabled: true
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
    defaultModel: "claude-sonnet-4-6",
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
    id: "codex",
    type: "codex",
    name: "Codex",
    isCloud: true,
    defaultModel: "gpt-5.6-luna",
    enabled: true
  }
];

export const defaultAutoModeRules: AutoModeRule[] = [];

export const defaultModelLibrary: ModelLibrarySnapshot = {
  catalog: modelCatalog,
  downloads: [],
  activeModelIds: {}
};

export { defaultReleaseNotes };
