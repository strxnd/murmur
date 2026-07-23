import type {
  LlmProviderConfig,
  ModelCatalogItem,
  ModelProvider,
  ProviderRuntimeSnapshot,
  TranscriptionProviderConfig
} from "./types";

interface CloudCredentialGate {
  isCloud: boolean;
  apiKey?: string;
  hasStoredSecret?: boolean;
}

const providerLabels: Record<ModelProvider, string> = {
  whisper_cpp: "whisper.cpp",
  nvidia: "NVIDIA",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
  anthropic: "Anthropic",
  google: "Google",
  codex: "Codex"
};

export function providerLabel(provider: ModelProvider): string {
  return providerLabels[provider];
}

export function canActivateModel(item: ModelCatalogItem): boolean {
  const config = item.defaultProviderConfig;
  return item.kind === "voice" ? Boolean(config?.sttProviderType) : Boolean(config?.llmProviderType);
}

export function modelName(item: ModelCatalogItem): string | undefined {
  return item.defaultProviderConfig?.model ?? item.ollamaModel ?? item.extractDir ?? item.filename;
}

export function hasUsableCloudCredentials(provider: CloudCredentialGate): boolean {
  return !provider.isCloud || hasNonEmptyString(provider.apiKey) || provider.hasStoredSecret === true;
}

export function isTranscriptionProviderUsable(provider: TranscriptionProviderConfig): boolean {
  if (!provider.enabled) return false;
  if (!hasUsableCloudCredentials(provider)) return false;
  return hasNonEmptyString(provider.baseUrl);
}

export function isLlmProviderUsable(provider: LlmProviderConfig, providerRuntime?: ProviderRuntimeSnapshot): boolean {
  if (!provider.enabled) return false;
  if (provider.type === "codex") {
    return providerRuntime?.codex.status === "connected" && providerRuntime.codex.modelAvailable;
  }
  if (!hasUsableCloudCredentials(provider)) return false;
  if (provider.type === "ollama") return true;
  return hasNonEmptyString(provider.baseUrl);
}

export function isModelProviderUsable(
  item: ModelCatalogItem,
  state: {
    transcriptionProviders: TranscriptionProviderConfig[];
    llmProviders: LlmProviderConfig[];
    providerRuntime?: ProviderRuntimeSnapshot;
  }
): boolean {
  if (item.kind === "voice") {
    const providerId = sttProviderId(item);
    if (!state.transcriptionProviders.some((provider) => provider.id === providerId)) return false;
    const provider = transcriptionProviderFromModel(item, state.transcriptionProviders);
    return Boolean(provider && isTranscriptionProviderUsable(provider));
  }

  const providerId = item.defaultProviderConfig?.providerId ?? item.discovery?.providerId ?? llmProviderId(item);
  if (!state.llmProviders.some((provider) => provider.id === providerId)) return false;
  const provider = llmProviderFromModel(item, state.llmProviders);
  return Boolean(provider && isLlmProviderUsable(provider, state.providerRuntime));
}

export function transcriptionProviderFromModel(
  item: ModelCatalogItem,
  providers: TranscriptionProviderConfig[] = []
): TranscriptionProviderConfig | null {
  const config = item.defaultProviderConfig;
  if (item.kind !== "voice" || !config?.sttProviderType) return null;

  const providerId = sttProviderId(item);
  const existing = providers.find((provider) => provider.id === providerId);
  if (existing) {
    return {
      ...existing,
      defaultModel: modelName(item) ?? existing.defaultModel
    };
  }

  return {
    id: providerId,
    type: config.sttProviderType,
    name: sttProviderName(item),
    baseUrl: config.baseUrl ?? "",
    endpointPath: config.endpointPath,
    isCloud: item.isCloud,
    isLocal: !item.isCloud,
    defaultModel: modelName(item),
    defaultLanguage: "auto",
    streamingMode: "none",
    enabled: true
  };
}

export function llmProviderFromModel(item: ModelCatalogItem, providers: LlmProviderConfig[] = []): LlmProviderConfig | null {
  const config = item.defaultProviderConfig;
  if (item.kind !== "language" || !config?.llmProviderType) return null;

  const providerId = config.providerId ?? item.discovery?.providerId ?? llmProviderId(item);
  const existing = providers.find((provider) => provider.id === providerId);
  if (existing) {
    return {
      ...existing,
      defaultModel: modelName(item) ?? existing.defaultModel
    };
  }

  return {
    id: providerId,
    type: config.llmProviderType,
    name: llmProviderName(item),
    baseUrl: config.baseUrl,
    isCloud: item.isCloud,
    defaultModel: modelName(item),
    enabled: true
  };
}

export function sttProviderId(item: ModelCatalogItem): string {
  const type = item.defaultProviderConfig?.sttProviderType;
  if (type === "whisper_cpp") return "local-whisper-cpp";
  if (type === "sherpa_onnx") return "local-nvidia-parakeet-stt";
  if (type === "local_openai_compatible_stt") return "local-openai-stt";
  if (type === "cloud_openai") return "openai-stt";
  return `${item.id}-stt`;
}

export function llmProviderId(item: ModelCatalogItem): string {
  const type = item.defaultProviderConfig?.llmProviderType;
  if (type === "ollama") return "ollama";
  if (type === "lmstudio") return "lmstudio";
  if (type === "openai") return "openai-llm";
  if (type === "anthropic") return "anthropic";
  if (type === "google") return "google";
  if (type === "codex") return "codex";
  if (type === "llama_cpp_openai") return "llama-cpp-openai";
  return `${item.id}-llm`;
}

function sttProviderName(item: ModelCatalogItem): string {
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return "Local whisper.cpp";
  if (item.defaultProviderConfig?.sttProviderType === "sherpa_onnx") return "Local NVIDIA Parakeet STT";
  return `${providerLabel(item.provider)} transcription`;
}

function llmProviderName(item: ModelCatalogItem): string {
  if (item.defaultProviderConfig?.llmProviderType === "ollama") return "Ollama";
  if (item.defaultProviderConfig?.llmProviderType === "lmstudio") return "LM Studio";
  return `${providerLabel(item.provider)} language`;
}

function hasNonEmptyString(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
