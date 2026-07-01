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
  "lmstudio",
  "ollama",
  "custom_openai_compatible"
] as const satisfies ReadonlyArray<LlmProviderType>;

const defaultSttIds = new Set(defaultTranscriptionProviders.map((provider) => provider.id));
const defaultLlmIds = new Set(defaultLlmProviders.map((provider) => provider.id));

export const cloudCredentialProviderIds = ["openai", "anthropic", "google"] as const;
export type CloudCredentialProviderId = (typeof cloudCredentialProviderIds)[number];

export interface CloudCredentialProviderDefinition {
  id: CloudCredentialProviderId;
  name: string;
  usage: string;
  sttProviderIds: readonly string[];
  llmProviderIds: readonly string[];
}

export const cloudCredentialProviders = [
  {
    id: "openai",
    name: "OpenAI",
    usage: "Voice and language",
    sttProviderIds: ["openai-stt"],
    llmProviderIds: ["openai-llm"]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    usage: "Language",
    sttProviderIds: [],
    llmProviderIds: ["anthropic"]
  },
  {
    id: "google",
    name: "Google Gemini",
    usage: "Language",
    sttProviderIds: [],
    llmProviderIds: ["google"]
  }
] as const satisfies ReadonlyArray<CloudCredentialProviderDefinition>;

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

export function isCloudCredentialTranscriptionProvider(provider: Pick<TranscriptionProviderConfig, "id">): boolean {
  return cloudCredentialProviders.some((definition) => (definition.sttProviderIds as readonly string[]).includes(provider.id));
}

export function isCloudCredentialLlmProvider(provider: Pick<LlmProviderConfig, "id">): boolean {
  return cloudCredentialProviders.some((definition) => (definition.llmProviderIds as readonly string[]).includes(provider.id));
}

export function cloudCredentialApiKey(providerId: CloudCredentialProviderId, values: ProvidersFormValues): string {
  const definition = cloudCredentialProvider(providerId);
  return (
    firstNonEmpty(
      ...definition.sttProviderIds.map((id) => values.transcriptionProviders.find((provider) => provider.id === id)?.apiKey),
      ...definition.llmProviderIds.map((id) => values.llmProviders.find((provider) => provider.id === id)?.apiKey)
    ) ?? ""
  );
}

export function cloudCredentialConfigured(providerId: CloudCredentialProviderId, values: ProvidersFormValues): boolean {
  const definition = cloudCredentialProvider(providerId);
  return Boolean(
    firstNonEmpty(
      ...definition.sttProviderIds.flatMap((id) => {
        const provider = values.transcriptionProviders.find((candidate) => candidate.id === id);
        return [provider?.apiKey, provider?.apiKeySecretId];
      }),
      ...definition.llmProviderIds.flatMap((id) => {
        const provider = values.llmProviders.find((candidate) => candidate.id === id);
        return [provider?.apiKey, provider?.apiKeySecretId];
      })
    )
  );
}

export function applyCloudCredentialApiKey(
  values: ProvidersFormValues,
  providerId: CloudCredentialProviderId,
  apiKey: string
): ProvidersFormValues {
  const definition = cloudCredentialProvider(providerId);
  const enabled = apiKey.trim().length > 0;
  let transcriptionProviders = values.transcriptionProviders;
  let llmProviders = values.llmProviders;

  for (const sttProviderId of definition.sttProviderIds) {
    transcriptionProviders = upsertTranscriptionCredential(transcriptionProviders, sttProviderId, apiKey, enabled);
  }
  for (const llmProviderId of definition.llmProviderIds) {
    llmProviders = upsertLlmCredential(llmProviders, llmProviderId, apiKey, enabled);
  }

  return {
    transcriptionProviders,
    llmProviders
  };
}

export function cloudCredentialValidationProviders(
  providerId: CloudCredentialProviderId,
  values: ProvidersFormValues
): {
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
} {
  const definition = cloudCredentialProvider(providerId);
  const apiKey = cloudCredentialApiKey(providerId, values);
  const ensuredValues = apiKey.trim().length > 0 ? applyCloudCredentialApiKey(values, providerId, apiKey) : cloneProvidersFormValues(values);

  return {
    transcriptionProviders: definition.sttProviderIds
      .map((id) => ensuredValues.transcriptionProviders.find((provider) => provider.id === id))
      .filter(isDefined),
    llmProviders: definition.llmProviderIds
      .map((id) => ensuredValues.llmProviders.find((provider) => provider.id === id))
      .filter(isDefined)
  };
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
      models: [],
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
    custom_openai_compatible: "OpenAI-compatible"
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
    return { name: "Ollama", baseUrl: "http://127.0.0.1:11434", isCloud: false, defaultModel: "llama3.1", models: undefined };
  }
  if (type === "lmstudio") {
    return { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", isCloud: false, defaultModel: "local-model", models: undefined };
  }
  return { name: "OpenAI-compatible LLM", baseUrl: "", isCloud: true, defaultModel: undefined, models: [] };
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
  const isOpenAiCompatible = provider.type === "custom_openai_compatible";
  return {
    ...provider,
    name: provider.name.trim(),
    baseUrl: trimmedOptional(provider.baseUrl),
    apiKey: provider.apiKey?.trim() ?? "",
    apiKeySecretId: trimmedOptional(provider.apiKeySecretId),
    defaultModel: isOpenAiCompatible ? undefined : trimmedOptional(provider.defaultModel),
    models: isOpenAiCompatible ? normalizeModelIds([...(provider.models ?? []), provider.defaultModel]) : undefined
  };
}

function normalizeModelIds(models: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const model of models) {
    if (typeof model !== "string") continue;
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function trimmedOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cloudCredentialProvider(providerId: CloudCredentialProviderId): CloudCredentialProviderDefinition {
  const definition = cloudCredentialProviders.find((provider) => provider.id === providerId);
  if (!definition) throw new Error(`Unknown cloud credential provider ${providerId}.`);
  return definition;
}

function upsertTranscriptionCredential(
  providers: TranscriptionProviderConfig[],
  providerId: string,
  apiKey: string,
  enabled: boolean
): TranscriptionProviderConfig[] {
  const existing = providers.find((provider) => provider.id === providerId);
  const defaultProvider = defaultTranscriptionProviders.find((provider) => provider.id === providerId);
  if (!existing && !defaultProvider) throw new Error(`Missing default STT provider ${providerId}.`);

  const nextProvider = {
    ...(defaultProvider ?? existing!),
    ...existing,
    apiKey,
    apiKeySecretId: enabled ? existing?.apiKeySecretId : undefined,
    enabled
  };

  if (existing) {
    return providers.map((provider) => (provider.id === providerId ? nextProvider : provider));
  }

  return [...providers, nextProvider];
}

function upsertLlmCredential(
  providers: LlmProviderConfig[],
  providerId: string,
  apiKey: string,
  enabled: boolean
): LlmProviderConfig[] {
  const existing = providers.find((provider) => provider.id === providerId);
  const defaultProvider = defaultLlmProviders.find((provider) => provider.id === providerId);
  if (!existing && !defaultProvider) throw new Error(`Missing default LLM provider ${providerId}.`);

  const nextProvider = {
    ...(defaultProvider ?? existing!),
    ...existing,
    apiKey,
    apiKeySecretId: enabled ? existing?.apiKeySecretId : undefined,
    enabled
  };

  if (existing) {
    return providers.map((provider) => (provider.id === providerId ? nextProvider : provider));
  }

  return [...providers, nextProvider];
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
