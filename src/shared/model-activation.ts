import type {
  LlmProviderConfig,
  ModelCatalogItem,
  ModelProvider,
  TranscriptionProviderConfig
} from "./types";

const providerLabels: Record<ModelProvider, string> = {
  whisper_cpp: "whisper.cpp",
  nvidia: "NVIDIA",
  ollama: "Ollama",
  openai: "OpenAI",
  groq: "Groq",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter"
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

export function transcriptionProviderFromModel(
  item: ModelCatalogItem,
  providers: TranscriptionProviderConfig[] = []
): TranscriptionProviderConfig | null {
  const config = item.defaultProviderConfig;
  if (item.kind !== "voice" || !config?.sttProviderType) return null;

  const providerId = sttProviderId(item);
  const existing = providers.find((provider) => provider.id === providerId);
  return {
    id: existing?.id ?? providerId,
    type: config.sttProviderType,
    name: existing?.name || sttProviderName(item),
    baseUrl: config.baseUrl ?? existing?.baseUrl ?? "",
    endpointPath: config.endpointPath ?? existing?.endpointPath,
    apiKeySecretId: existing?.apiKeySecretId,
    apiKey: existing?.apiKey,
    isCloud: item.isCloud,
    isLocal: !item.isCloud,
    defaultModel: modelName(item) ?? existing?.defaultModel,
    defaultLanguage: existing?.defaultLanguage ?? "auto",
    streamingMode: existing?.streamingMode ?? "none",
    enabled: true
  };
}

export function llmProviderFromModel(item: ModelCatalogItem, providers: LlmProviderConfig[] = []): LlmProviderConfig | null {
  const config = item.defaultProviderConfig;
  if (item.kind !== "language" || !config?.llmProviderType) return null;

  const providerId = llmProviderId(item);
  const existing = providers.find((provider) => provider.id === providerId);
  return {
    id: existing?.id ?? providerId,
    type: config.llmProviderType,
    name: existing?.name || llmProviderName(item),
    baseUrl: config.baseUrl ?? existing?.baseUrl,
    apiKeySecretId: existing?.apiKeySecretId,
    apiKey: existing?.apiKey,
    isCloud: item.isCloud,
    defaultModel: modelName(item) ?? existing?.defaultModel,
    enabled: true
  };
}

export function sttProviderId(item: ModelCatalogItem): string {
  const type = item.defaultProviderConfig?.sttProviderType;
  if (type === "whisper_cpp") return "local-whisper-cpp";
  if (type === "sherpa_onnx") return "local-nvidia-parakeet-stt";
  if (type === "local_openai_compatible_stt") return "local-openai-stt";
  return `${item.id}-stt`;
}

export function llmProviderId(item: ModelCatalogItem): string {
  const type = item.defaultProviderConfig?.llmProviderType;
  if (type === "ollama") return "ollama";
  if (type === "lmstudio") return "lmstudio";
  if (type === "openai") return "openai-llm";
  if (type === "anthropic") return "anthropic";
  if (type === "google") return "google";
  if (type === "openrouter") return "openrouter";
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
  return `${providerLabel(item.provider)} language`;
}
