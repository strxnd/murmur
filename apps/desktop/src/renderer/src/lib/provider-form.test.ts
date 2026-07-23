import { describe, expect, it } from "vitest";
import { defaultLlmProviders, defaultTranscriptionProviders } from "../../../shared/defaults";
import {
  applyCloudCredentialApiKey,
  applyLlmProviderType,
  applyTranscriptionProviderType,
  cloudCredentialApiKey,
  cloudCredentialConfigured,
  cloudCredentialValidationProviders,
  createCustomLlmProvider,
  createCustomTranscriptionProvider,
  customLlmProviderTypes,
  customTranscriptionProviderTypes,
  hasCloudCredentialChanges,
  hasUnconfirmedProviderCredentialIntent,
  invalidateStoredCredentialIntent,
  isCloudCredentialLlmProvider,
  isCloudCredentialTranscriptionProvider,
  isDefaultLlmProvider,
  isDefaultTranscriptionProvider,
  normalizeProvidersFormValues
} from "./provider-form";

describe("provider form helpers", () => {
  it("creates custom STT providers with cloud OpenAI-compatible defaults", () => {
    const provider = createCustomTranscriptionProvider("custom-stt");

    expect(provider).toMatchObject({
      id: "custom-stt",
      type: "cloud_openai_compatible_stt",
      name: "Cloud OpenAI-compatible STT",
      baseUrl: "",
      endpointPath: "/audio/transcriptions",
      isCloud: true,
      isLocal: false,
      streamingMode: "completed_audio_sse",
      enabled: false
    });
  });

  it("does not offer bundled-only Sherpa ONNX for custom STT providers", () => {
    expect(customTranscriptionProviderTypes).not.toContain("sherpa_onnx");
  });

  it("applies local STT type presets and preserves enablement", () => {
    const provider = createCustomTranscriptionProvider("custom-stt");
    const nextProvider = applyTranscriptionProviderType({ ...provider, enabled: true }, "local_openai_compatible_stt");

    expect(nextProvider).toMatchObject({
      type: "local_openai_compatible_stt",
      name: "Local OpenAI-compatible STT",
      baseUrl: "http://127.0.0.1:8000/v1",
      endpointPath: "/audio/transcriptions",
      isCloud: false,
      isLocal: true,
      streamingMode: "none",
      enabled: true
    });
  });

  it("creates custom LLM providers with custom OpenAI-compatible defaults", () => {
    const provider = createCustomLlmProvider("custom-llm");

    expect(provider).toMatchObject({
      id: "custom-llm",
      type: "custom_openai_compatible",
      name: "OpenAI-compatible LLM",
      baseUrl: "",
      isCloud: true,
      models: [],
      enabled: false
    });
  });

  it("only offers local and OpenAI-compatible custom LLM provider types", () => {
    expect(customLlmProviderTypes).toEqual(["lmstudio", "ollama", "custom_openai_compatible"]);
  });

  it("applies LLM type presets and preserves API keys", () => {
    const provider = createCustomLlmProvider("custom-llm");
    const nextProvider = applyLlmProviderType({ ...provider, apiKey: "sk-test" }, "lmstudio");

    expect(nextProvider).toMatchObject({
      type: "lmstudio",
      name: "LM Studio",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "sk-test",
      isCloud: false
    });
  });

  it("drops unsupported Ollama API credentials when applying and normalizing", () => {
    const provider = createCustomLlmProvider("custom-llm");
    const nextProvider = applyLlmProviderType(
      { ...provider, apiKey: "sk-test", apiKeySecretId: "provider-secret:llm:custom-llm" },
      "ollama"
    );

    expect(nextProvider).toMatchObject({
      type: "ollama",
      apiKey: "",
      isCloud: false
    });
    expect(nextProvider.apiKeySecretId).toBeUndefined();

    const normalized = normalizeProvidersFormValues({
      transcriptionProviders: [],
      llmProviders: [
        {
          ...nextProvider,
          apiKey: " lingering-key ",
          apiKeySecretId: "provider-secret:llm:custom-llm"
        }
      ]
    });

    expect(normalized.llmProviders[0].apiKey).toBe("");
    expect(normalized.llmProviders[0].apiKeySecretId).toBeUndefined();
  });

  it("detects built-in providers by persisted IDs", () => {
    expect(isDefaultTranscriptionProvider({ id: "openai-stt" })).toBe(true);
    expect(isDefaultTranscriptionProvider({ id: "custom-stt" })).toBe(false);
    expect(isDefaultLlmProvider({ id: "openai-llm" })).toBe(true);
    expect(isDefaultLlmProvider({ id: "custom-llm" })).toBe(false);
  });

  it("normalizes blank optional provider fields before save", () => {
    const values = normalizeProvidersFormValues({
      transcriptionProviders: [
        {
          ...createCustomTranscriptionProvider("custom-stt", "whisper_cpp"),
          name: "  External whisper ",
          baseUrl: " http://127.0.0.1:8080 ",
          apiKey: "  ",
          defaultModel: "  ",
          endpointPath: " /inference "
        }
      ],
      llmProviders: [
        {
          ...createCustomLlmProvider("custom-llm"),
          apiKey: " sk-test ",
          defaultModel: " legacy-model ",
          models: [" model-a ", "model-a", " ", "model-b"]
        },
        {
          ...createCustomLlmProvider("custom-ollama", "ollama"),
          models: ["should-be-dropped"]
        }
      ]
    });

    expect(values.transcriptionProviders[0]).toMatchObject({
      name: "External whisper",
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "",
      endpointPath: "/inference",
      defaultModel: undefined
    });
    expect(values.llmProviders[0]).toMatchObject({
      apiKey: "sk-test",
      defaultModel: undefined,
      models: ["model-a", "model-b", "legacy-model"]
    });
    expect(values.llmProviders[1].models).toBeUndefined();
  });

  it("applies one OpenAI credential to voice and language providers", () => {
    const values = applyCloudCredentialApiKey(
      {
        transcriptionProviders: defaultTranscriptionProviders,
        llmProviders: defaultLlmProviders
      },
      "openai",
      " sk-openai "
    );

    expect(values.transcriptionProviders.find((provider) => provider.id === "openai-stt")).toMatchObject({
      apiKey: " sk-openai ",
      enabled: true
    });
    expect(values.llmProviders.find((provider) => provider.id === "openai-llm")).toMatchObject({
      apiKey: " sk-openai ",
      enabled: true
    });
    expect(cloudCredentialApiKey("openai", values)).toBe(" sk-openai ");
  });

  it("detects unsaved first-time cloud credential entry", () => {
    const persistedValues = {
      transcriptionProviders: defaultTranscriptionProviders,
      llmProviders: defaultLlmProviders
    };
    const values = applyCloudCredentialApiKey(persistedValues, "openai", "sk-openai");

    expect(cloudCredentialConfigured("openai", persistedValues)).toBe(false);
    expect(cloudCredentialConfigured("openai", values)).toBe(true);
    expect(hasCloudCredentialChanges("openai", values, persistedValues)).toBe(true);
  });

  it("applies Anthropic and Google credentials only to their provider records", () => {
    const customStt = createCustomTranscriptionProvider("custom-stt");
    const customLlm = createCustomLlmProvider("custom-llm");
    const values = applyCloudCredentialApiKey(
      {
        transcriptionProviders: [...defaultTranscriptionProviders, customStt],
        llmProviders: [...defaultLlmProviders, customLlm]
      },
      "anthropic",
      "sk-ant"
    );

    expect(values.transcriptionProviders).toEqual([...defaultTranscriptionProviders, customStt]);
    expect(values.llmProviders.find((provider) => provider.id === "anthropic")).toMatchObject({
      apiKey: "sk-ant",
      enabled: true
    });
    expect(values.llmProviders.find((provider) => provider.id === "google")).toEqual(
      defaultLlmProviders.find((provider) => provider.id === "google")
    );
    expect(values.llmProviders.find((provider) => provider.id === "custom-llm")).toEqual(customLlm);
  });

  it("clearing a cloud credential disables matching provider records", () => {
    const configured = applyCloudCredentialApiKey(
      {
        transcriptionProviders: defaultTranscriptionProviders,
        llmProviders: defaultLlmProviders
      },
      "openai",
      "sk-openai"
    );
    const cleared = applyCloudCredentialApiKey(configured, "openai", "  ");

    expect(cleared.transcriptionProviders.find((provider) => provider.id === "openai-stt")).toMatchObject({
      apiKey: "  ",
      enabled: false
    });
    expect(cleared.llmProviders.find((provider) => provider.id === "openai-llm")).toMatchObject({
      apiKey: "  ",
      enabled: false
    });
    expect(cloudCredentialApiKey("openai", cleared)).toBe("");
    expect(cleared.transcriptionProviders.find((provider) => provider.id === "openai-stt")?.apiKeySecretId).toBeUndefined();
    expect(cleared.llmProviders.find((provider) => provider.id === "openai-llm")?.apiKeySecretId).toBeUndefined();
  });

  it("detects unsaved cloud credential removal from stored secret references", () => {
    const persistedValues = {
      transcriptionProviders: defaultTranscriptionProviders.map((provider) =>
        provider.id === "openai-stt" ? { ...provider, enabled: true, apiKeySecretId: "provider-secret:stt:test", hasStoredSecret: true, apiKeyIntent: "keep" as const } : provider
      ),
      llmProviders: defaultLlmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, enabled: true, apiKeySecretId: "provider-secret:llm:test", hasStoredSecret: true, apiKeyIntent: "keep" as const } : provider
      )
    };
    const values = applyCloudCredentialApiKey(persistedValues, "openai", "");

    expect(cloudCredentialConfigured("openai", persistedValues)).toBe(true);
    expect(cloudCredentialConfigured("openai", values)).toBe(false);
    expect(hasCloudCredentialChanges("openai", values, persistedValues)).toBe(true);
  });

  it("treats stored secret references as configured credentials without exposing a key", () => {
    const values = {
      transcriptionProviders: defaultTranscriptionProviders.map((provider) =>
        provider.id === "openai-stt" ? { ...provider, enabled: true, apiKeySecretId: "provider-secret:stt:test", hasStoredSecret: true, apiKeyIntent: "keep" as const } : provider
      ),
      llmProviders: defaultLlmProviders
    };

    expect(cloudCredentialApiKey("openai", values)).toBe("");
    expect(cloudCredentialConfigured("openai", values)).toBe(true);
    expect(cloudCredentialValidationProviders("openai", values).transcriptionProviders[0]).toMatchObject({
      id: "openai-stt",
      apiKeySecretId: "provider-secret:stt:test"
    });
  });

  it("requires explicit credential intent after changing an endpoint with a stored key", () => {
    const provider = {
      ...createCustomLlmProvider("custom-llm"),
      baseUrl: "https://old.example.test/v1",
      hasStoredSecret: true,
      apiKeySecretId: "provider-secret:llm:custom",
      apiKeyIntent: "keep" as const
    };

    const changed = invalidateStoredCredentialIntent({ ...provider, baseUrl: "https://new.example.test/v1" });
    const values = { transcriptionProviders: [], llmProviders: [changed] };

    expect(changed.apiKeyIntent).toBeUndefined();
    expect(hasUnconfirmedProviderCredentialIntent(values)).toBe(true);
    expect(hasUnconfirmedProviderCredentialIntent({
      ...values,
      llmProviders: [{ ...changed, apiKeyIntent: "keep" as const }]
    })).toBe(false);
  });

  it("upserts missing default cloud provider records", () => {
    const values = applyCloudCredentialApiKey(
      {
        transcriptionProviders: defaultTranscriptionProviders.filter((provider) => provider.id !== "openai-stt"),
        llmProviders: defaultLlmProviders.filter((provider) => provider.id !== "openai-llm")
      },
      "openai",
      "sk-openai"
    );

    expect(values.transcriptionProviders.find((provider) => provider.id === "openai-stt")).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      enabled: true
    });
    expect(values.llmProviders.find((provider) => provider.id === "openai-llm")).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      enabled: true
    });
  });

  it("identifies curated cloud providers for the advanced editor filter", () => {
    expect(isCloudCredentialTranscriptionProvider({ id: "openai-stt" })).toBe(true);
    expect(isCloudCredentialTranscriptionProvider({ id: "local-openai-stt" })).toBe(false);
    expect(isCloudCredentialLlmProvider({ id: "openai-llm" })).toBe(true);
    expect(isCloudCredentialLlmProvider({ id: "ollama" })).toBe(false);
  });

  it("returns validation provider records for a cloud credential row", () => {
    const values = applyCloudCredentialApiKey(
      {
        transcriptionProviders: defaultTranscriptionProviders,
        llmProviders: defaultLlmProviders
      },
      "openai",
      "sk-openai"
    );

    expect(cloudCredentialValidationProviders("openai", values)).toMatchObject({
      transcriptionProviders: [{ id: "openai-stt", apiKey: "sk-openai" }],
      llmProviders: [{ id: "openai-llm", apiKey: "sk-openai" }]
    });
  });
});
