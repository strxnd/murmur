import {
  llmProviderFromModel,
  modelName,
  providerLabel,
  transcriptionProviderFromModel
} from "./model-activation";
import { modelCatalog } from "./model-catalog";
import type { LlmProviderConfig, ModelCatalogItem, TranscriptionProviderConfig } from "./types";

export type ProviderSetupKind = "stt" | "llm";

export interface ProviderSetupTarget {
  kind: ProviderSetupKind;
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  sharedCredentialGroup?: "openai";
}

export interface ProviderSetupDraft {
  target: ProviderSetupTarget;
  validation:
    | { kind: "stt"; provider: TranscriptionProviderConfig }
    | { kind: "llm"; provider: LlmProviderConfig };
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
}

const setupLlmProviderTypes = new Set(["openai", "anthropic", "google"]);

export function resolveProviderSetupTarget(item: ModelCatalogItem): ProviderSetupTarget | null {
  if (!item.isCloud || item.downloadStrategy !== "none") return null;

  if (item.kind === "voice" && item.provider === "openai" && item.defaultProviderConfig?.sttProviderType === "cloud_openai") {
    const provider = transcriptionProviderFromModel(item);
    if (!provider) return null;
    return {
      kind: "stt",
      modelId: item.id,
      modelName: modelName(item) ?? item.name,
      providerId: provider.id,
      providerName: providerLabel(item.provider),
      sharedCredentialGroup: "openai"
    };
  }

  if (
    item.kind === "language" &&
    item.defaultProviderConfig?.llmProviderType &&
    setupLlmProviderTypes.has(item.defaultProviderConfig.llmProviderType)
  ) {
    const provider = llmProviderFromModel(item);
    if (!provider) return null;
    return {
      kind: "llm",
      modelId: item.id,
      modelName: modelName(item) ?? item.name,
      providerId: provider.id,
      providerName: providerLabel(item.provider),
      sharedCredentialGroup: item.defaultProviderConfig.llmProviderType === "openai" ? "openai" : undefined
    };
  }

  return null;
}

export function currentProviderSetupApiKey(
  item: ModelCatalogItem,
  transcriptionProviders: TranscriptionProviderConfig[],
  llmProviders: LlmProviderConfig[]
): string {
  const target = resolveProviderSetupTarget(item);
  if (!target) return "";

  if (target.sharedCredentialGroup === "openai") {
    return (
      firstNonEmpty(
        transcriptionProviders.find((provider) => provider.id === "openai-stt")?.apiKey,
        llmProviders.find((provider) => provider.id === "openai-llm")?.apiKey
      ) ?? ""
    );
  }

  if (target.kind === "stt") {
    return transcriptionProviders.find((provider) => provider.id === target.providerId)?.apiKey ?? "";
  }

  return llmProviders.find((provider) => provider.id === target.providerId)?.apiKey ?? "";
}

export function buildProviderSetupDraft({
  item,
  apiKey,
  transcriptionProviders,
  llmProviders
}: {
  item: ModelCatalogItem;
  apiKey: string;
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
}): ProviderSetupDraft | null {
  const target = resolveProviderSetupTarget(item);
  if (!target) return null;

  const trimmedApiKey = apiKey.trim();
  let nextTranscriptionProviders = transcriptionProviders;
  let nextLlmProviders = llmProviders;

  const validation =
    target.kind === "stt"
      ? ({ kind: "stt", provider: withSttApiKey(requireSttProvider(item, nextTranscriptionProviders), trimmedApiKey) } as const)
      : ({ kind: "llm", provider: withLlmApiKey(requireLlmProvider(item, nextLlmProviders), trimmedApiKey) } as const);

  if (target.sharedCredentialGroup === "openai") {
    const openaiSttModel = modelCatalog.find(
      (candidate) => candidate.kind === "voice" && candidate.provider === "openai" && candidate.defaultProviderConfig?.sttProviderType === "cloud_openai"
    );
    const openaiLlmModel = modelCatalog.find(
      (candidate) => candidate.kind === "language" && candidate.provider === "openai" && candidate.defaultProviderConfig?.llmProviderType === "openai"
    );

    if (openaiSttModel) {
      nextTranscriptionProviders = upsertTranscriptionProvider(
        nextTranscriptionProviders,
        withSttApiKey(requireSttProvider(openaiSttModel, nextTranscriptionProviders), trimmedApiKey)
      );
    }
    if (openaiLlmModel) {
      nextLlmProviders = upsertLlmProvider(
        nextLlmProviders,
        withLlmApiKey(requireLlmProvider(openaiLlmModel, nextLlmProviders), trimmedApiKey)
      );
    }
  } else if (validation.kind === "stt") {
    nextTranscriptionProviders = upsertTranscriptionProvider(nextTranscriptionProviders, validation.provider);
  } else {
    nextLlmProviders = upsertLlmProvider(nextLlmProviders, validation.provider);
  }

  return {
    target,
    validation,
    transcriptionProviders: nextTranscriptionProviders,
    llmProviders: nextLlmProviders
  };
}

function requireSttProvider(item: ModelCatalogItem, providers: TranscriptionProviderConfig[]): TranscriptionProviderConfig {
  const provider = transcriptionProviderFromModel(item, providers);
  if (!provider) throw new Error(`Model ${item.id} does not map to an STT provider.`);
  return provider;
}

function requireLlmProvider(item: ModelCatalogItem, providers: LlmProviderConfig[]): LlmProviderConfig {
  const provider = llmProviderFromModel(item, providers);
  if (!provider) throw new Error(`Model ${item.id} does not map to an LLM provider.`);
  return provider;
}

function withSttApiKey(provider: TranscriptionProviderConfig, apiKey: string): TranscriptionProviderConfig {
  return {
    ...provider,
    apiKey,
    enabled: true
  };
}

function withLlmApiKey(provider: LlmProviderConfig, apiKey: string): LlmProviderConfig {
  return {
    ...provider,
    apiKey,
    enabled: true
  };
}

function upsertTranscriptionProvider(
  providers: TranscriptionProviderConfig[],
  provider: TranscriptionProviderConfig
): TranscriptionProviderConfig[] {
  const index = providers.findIndex((candidate) => candidate.id === provider.id);
  if (index === -1) return [...providers, provider];
  return providers.map((candidate) => (candidate.id === provider.id ? provider : candidate));
}

function upsertLlmProvider(providers: LlmProviderConfig[], provider: LlmProviderConfig): LlmProviderConfig[] {
  const index = providers.findIndex((candidate) => candidate.id === provider.id);
  if (index === -1) return [...providers, provider];
  return providers.map((candidate) => (candidate.id === provider.id ? provider : candidate));
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}
