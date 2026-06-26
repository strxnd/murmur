import { describe, expect, it } from "vitest";
import {
  applyLlmProviderType,
  applyTranscriptionProviderType,
  createCustomLlmProvider,
  createCustomTranscriptionProvider,
  customTranscriptionProviderTypes,
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
      name: "Custom OpenAI-compatible LLM",
      baseUrl: "",
      isCloud: true,
      enabled: false
    });
  });

  it("applies LLM type presets and preserves API keys", () => {
    const provider = createCustomLlmProvider("custom-llm");
    const nextProvider = applyLlmProviderType({ ...provider, apiKey: "sk-test" }, "openrouter");

    expect(nextProvider).toMatchObject({
      type: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-test",
      isCloud: true
    });
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
          ...createCustomLlmProvider("custom-llm", "openai"),
          apiKey: " sk-test ",
          defaultModel: "  "
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
      defaultModel: undefined
    });
  });
});
