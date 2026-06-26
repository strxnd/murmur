import { defaultLlmProviders, defaultTranscriptionProviders } from "../../../shared/defaults";
import type {
  LlmProviderConfig,
  LlmProviderType,
  TranscriptionProviderConfig,
  TranscriptionProviderType
} from "../../../shared/types";

export interface ProvidersFormValues {
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
}

export const customTranscriptionProviderTypes = [
  "whisper_cpp",
  "local_openai_compatible_stt",
  "cloud_openai",
  "cloud_openai_compatible_stt"
] as const satisfies ReadonlyArray<TranscriptionProviderType>;

export const customLlmProviderTypes = [
  "ollama",
  "lmstudio",
  "llama_cpp_openai",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "custom_openai_compatible"
] as const satisfies ReadonlyArray<LlmProviderType>;

const defaultSttIds = new Set(defaultTranscriptionProviders.map((provider) => provider.id));
const defaultLlmIds = new Set(defaultLlmProviders.map((provider) => provider.id));

export function cloneProvidersFormValues(values: ProvidersFormValues): ProvidersFormValues {
  return JSON.parse(JSON.stringify(values)) as ProvidersFormValues;
}

export function providersFormValuesFromState(values: ProvidersFormValues): ProvidersFormValues {
  return cloneProvidersFormValues(values);
}

export function normalizeProvidersFormValues(values: ProvidersFormValues): ProvidersFormValues {
  return {
    transcriptionProviders: values.transcriptionProviders.map(normalizeTranscriptionProviderDraft),
    llmProviders: values.llmProviders.map(normalizeLlmProviderDraft)
  };
}

export function hasProvidersFormChanges(values: ProvidersFormValues, persistedValues: ProvidersFormValues): boolean {
  return !sameValue(normalizeProvidersFormValues(values), normalizeProvidersFormValues(persistedValues));
}

export function isDefaultTranscriptionProvider(provider: Pick<TranscriptionProviderConfig, "id">): boolean {
  return defaultSttIds.has(provider.id);
}

export function isDefaultLlmProvider(provider: Pick<LlmProviderConfig, "id">): boolean {
  return defaultLlmIds.has(provider.id);
}

export function createCustomTranscriptionProvider(
  id: string,
  type: (typeof customTranscriptionProviderTypes)[number] = "cloud_openai_compatible_stt"
): TranscriptionProviderConfig {
  return applyTranscriptionProviderType(
    {
      id,
      type,
      name: "",
      baseUrl: "",
      endpointPath: "",
      apiKey: "",
      isCloud: true,
      isLocal: false,
      defaultModel: "",
      defaultLanguage: "auto",
      streamingMode: "completed_audio_sse",
      enabled: false
    },
    type
  );
}

export function createCustomLlmProvider(
  id: string,
  type: (typeof customLlmProviderTypes)[number] = "custom_openai_compatible"
): LlmProviderConfig {
  return applyLlmProviderType(
    {
      id,
      type,
      name: "",
      baseUrl: "",
      apiKey: "",
      isCloud: true,
      defaultModel: "",
      enabled: false
    },
    type
  );
}

export function applyTranscriptionProviderType(
  provider: TranscriptionProviderConfig,
  type: (typeof customTranscriptionProviderTypes)[number]
): TranscriptionProviderConfig {
  const preset = transcriptionProviderTypePreset(type);
  return {
    ...provider,
    ...preset,
    type,
    enabled: provider.enabled,
    apiKey: provider.apiKey ?? "",
    defaultLanguage: provider.defaultLanguage || "auto"
  };
}

export function applyLlmProviderType(provider: LlmProviderConfig, type: (typeof customLlmProviderTypes)[number]): LlmProviderConfig {
  const preset = llmProviderTypePreset(type);
  return {
    ...provider,
    ...preset,
    type,
    enabled: provider.enabled,
    apiKey: provider.apiKey ?? ""
  };
}

export function transcriptionProviderTypeLabel(type: TranscriptionProviderType): string {
  const labels: Record<TranscriptionProviderType, string> = {
    whisper_cpp: "whisper.cpp",
    sherpa_onnx: "Sherpa ONNX",
    local_openai_compatible_stt: "Local OpenAI-compatible STT",
    cloud_openai: "OpenAI STT",
    cloud_openai_compatible_stt: "Cloud OpenAI-compatible STT"
  };
  return labels[type];
}

export function llmProviderTypeLabel(type: LlmProviderType): string {
  const labels: Record<LlmProviderType, string> = {
    ollama: "Ollama",
    lmstudio: "LM Studio",
    llama_cpp_openai: "llama.cpp OpenAI-compatible",
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google Gemini",
    openrouter: "OpenRouter",
    custom_openai_compatible: "Custom OpenAI-compatible"
  };
  return labels[type];
}

function transcriptionProviderTypePreset(type: (typeof customTranscriptionProviderTypes)[number]): Partial<TranscriptionProviderConfig> {
  if (type === "whisper_cpp") {
    return {
      name: "Custom whisper.cpp server",
      baseUrl: "http://127.0.0.1:8080",
      endpointPath: "/inference",
      isCloud: false,
      isLocal: true,
      defaultModel: undefined,
      streamingMode: "none"
    };
  }

  if (type === "local_openai_compatible_stt") {
    return {
      name: "Local OpenAI-compatible STT",
      baseUrl: "http://127.0.0.1:8000/v1",
      endpointPath: "/audio/transcriptions",
      isCloud: false,
      isLocal: true,
      defaultModel: undefined,
      streamingMode: "none"
    };
  }

  if (type === "cloud_openai") {
    return {
      name: "OpenAI transcription",
      baseUrl: "https://api.openai.com/v1",
      endpointPath: "/audio/transcriptions",
      isCloud: true,
      isLocal: false,
      defaultModel: "gpt-4o-mini-transcribe",
      streamingMode: "completed_audio_sse"
    };
  }

  return {
    name: "Cloud OpenAI-compatible STT",
    baseUrl: "",
    endpointPath: "/audio/transcriptions",
    isCloud: true,
    isLocal: false,
    defaultModel: undefined,
    streamingMode: "completed_audio_sse"
  };
}

function llmProviderTypePreset(type: (typeof customLlmProviderTypes)[number]): Partial<LlmProviderConfig> {
  if (type === "ollama") {
    return { name: "Ollama", baseUrl: "http://127.0.0.1:11434", isCloud: false, defaultModel: "llama3.1" };
  }
  if (type === "lmstudio") {
    return { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", isCloud: false, defaultModel: "local-model" };
  }
  if (type === "llama_cpp_openai") {
    return { name: "llama.cpp OpenAI-compatible", baseUrl: "http://127.0.0.1:8080/v1", isCloud: false, defaultModel: undefined };
  }
  if (type === "openai") {
    return { name: "OpenAI", baseUrl: "https://api.openai.com/v1", isCloud: true, defaultModel: "gpt-4.1-mini" };
  }
  if (type === "anthropic") {
    return { name: "Anthropic", baseUrl: "https://api.anthropic.com", isCloud: true, defaultModel: "claude-sonnet-4-6" };
  }
  if (type === "google") {
    return { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", isCloud: true, defaultModel: "gemini-2.5-flash" };
  }
  if (type === "openrouter") {
    return { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", isCloud: true, defaultModel: undefined };
  }
  return { name: "Custom OpenAI-compatible LLM", baseUrl: "", isCloud: true, defaultModel: undefined };
}

function normalizeTranscriptionProviderDraft(provider: TranscriptionProviderConfig): TranscriptionProviderConfig {
  return {
    ...provider,
    name: provider.name.trim(),
    baseUrl: provider.baseUrl.trim(),
    endpointPath: trimmedOptional(provider.endpointPath),
    apiKey: provider.apiKey?.trim() ?? "",
    apiKeySecretId: trimmedOptional(provider.apiKeySecretId),
    defaultModel: trimmedOptional(provider.defaultModel),
    defaultLanguage: trimmedOptional(provider.defaultLanguage) ?? "auto",
    isLocal: !provider.isCloud || provider.isLocal
  };
}

function normalizeLlmProviderDraft(provider: LlmProviderConfig): LlmProviderConfig {
  return {
    ...provider,
    name: provider.name.trim(),
    baseUrl: trimmedOptional(provider.baseUrl),
    apiKey: provider.apiKey?.trim() ?? "",
    apiKeySecretId: trimmedOptional(provider.apiKeySecretId),
    defaultModel: trimmedOptional(provider.defaultModel)
  };
}

function trimmedOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
