import { describe, expect, it } from "vitest";
import { defaultLlmProviders, defaultTranscriptionProviders } from "./defaults";
import { modelCatalog } from "./model-catalog";
import {
  buildProviderSetupDraft,
  currentProviderSetupApiKey,
  resolveProviderSetupTarget
} from "./model-provider-setup";
import type { ModelCatalogItem } from "./types";

describe("resolveProviderSetupTarget", () => {
  it("resolves supported API catalog models", () => {
    expect(resolveProviderSetupTarget(model("openai-gpt-4o-transcribe"))).toMatchObject({
      kind: "stt",
      providerId: "openai-stt",
      providerName: "OpenAI",
      sharedCredentialGroup: "openai"
    });
    expect(resolveProviderSetupTarget(model("openai-gpt-5-5"))).toMatchObject({
      kind: "llm",
      providerId: "openai-llm",
      providerName: "OpenAI",
      sharedCredentialGroup: "openai"
    });
    expect(resolveProviderSetupTarget(model("anthropic-claude-sonnet-4-6"))).toMatchObject({
      kind: "llm",
      providerId: "anthropic",
      providerName: "Anthropic"
    });
    expect(resolveProviderSetupTarget(model("google-gemini-3-5-flash"))).toMatchObject({
      kind: "llm",
      providerId: "google",
      providerName: "Google"
    });
  });

  it("does not resolve downloaded local models", () => {
    expect(resolveProviderSetupTarget(model("whisper-tiny-en"))).toBeNull();
    expect(resolveProviderSetupTarget(model("nvidia-parakeet-tdt-ctc-110m"))).toBeNull();
  });
});

describe("buildProviderSetupDraft", () => {
  it("builds an STT validation provider and saved provider array", () => {
    const draft = buildProviderSetupDraft({
      item: model("openai-gpt-4o-transcribe"),
      apiKey: "  sk-test  ",
      transcriptionProviders: defaultTranscriptionProviders,
      llmProviders: defaultLlmProviders
    });

    expect(draft?.validation.kind).toBe("stt");
    expect(draft?.validation.provider).toMatchObject({
      id: "openai-stt",
      type: "cloud_openai",
      apiKey: "sk-test",
      defaultModel: "gpt-4o-transcribe",
      enabled: true
    });
    expect(draft?.transcriptionProviders.find((provider) => provider.id === "openai-stt")).toMatchObject({
      apiKey: "sk-test",
      defaultModel: "gpt-4o-transcribe",
      enabled: true
    });
  });

  it("builds an LLM validation provider and saved provider array", () => {
    const draft = buildProviderSetupDraft({
      item: model("anthropic-claude-sonnet-4-6"),
      apiKey: "sk-ant-test",
      transcriptionProviders: defaultTranscriptionProviders,
      llmProviders: defaultLlmProviders
    });

    expect(draft?.validation.kind).toBe("llm");
    expect(draft?.validation.provider).toMatchObject({
      id: "anthropic",
      type: "anthropic",
      apiKey: "sk-ant-test",
      defaultModel: "claude-sonnet-4-6",
      enabled: true
    });
    expect(draft?.llmProviders.find((provider) => provider.id === "anthropic")).toMatchObject({
      apiKey: "sk-ant-test",
      defaultModel: "claude-sonnet-4-6",
      enabled: true
    });
  });

  it("stores one OpenAI key on both OpenAI provider records", () => {
    const draft = buildProviderSetupDraft({
      item: model("openai-gpt-5-5"),
      apiKey: "sk-openai-test",
      transcriptionProviders: defaultTranscriptionProviders,
      llmProviders: defaultLlmProviders
    });

    expect(draft?.validation.kind).toBe("llm");
    expect(draft?.validation.provider).toMatchObject({
      id: "openai-llm",
      apiKey: "sk-openai-test",
      defaultModel: "gpt-5.5",
      enabled: true
    });
    expect(draft?.transcriptionProviders.find((provider) => provider.id === "openai-stt")).toMatchObject({
      apiKey: "sk-openai-test",
      defaultModel: "gpt-4o-transcribe",
      enabled: true
    });
    expect(draft?.llmProviders.find((provider) => provider.id === "openai-llm")).toMatchObject({
      apiKey: "sk-openai-test",
      defaultModel: "gpt-5.5",
      enabled: true
    });
  });

  it("keeps non-target providers unchanged", () => {
    const draft = buildProviderSetupDraft({
      item: model("google-gemini-3-5-flash"),
      apiKey: "google-test",
      transcriptionProviders: defaultTranscriptionProviders,
      llmProviders: defaultLlmProviders
    });

    expect(draft?.transcriptionProviders).toEqual(defaultTranscriptionProviders);
    expect(draft?.llmProviders.find((provider) => provider.id === "anthropic")).toEqual(
      defaultLlmProviders.find((provider) => provider.id === "anthropic")
    );
  });
});

describe("currentProviderSetupApiKey", () => {
  it("prefills OpenAI setup from either OpenAI provider record", () => {
    const sttProviders = defaultTranscriptionProviders.map((provider) =>
      provider.id === "openai-stt" ? { ...provider, apiKey: "" } : provider
    );
    const llmProviders = defaultLlmProviders.map((provider) =>
      provider.id === "openai-llm" ? { ...provider, apiKey: "sk-existing" } : provider
    );

    expect(currentProviderSetupApiKey(model("openai-gpt-4o-transcribe"), sttProviders, llmProviders)).toBe("sk-existing");
  });
});

function model(id: string): ModelCatalogItem {
  const item = modelCatalog.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing catalog model ${id}.`);
  return item;
}
