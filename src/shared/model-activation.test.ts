import { describe, expect, it } from "vitest";
import { defaultLlmProviders, defaultSettings, defaultTranscriptionProviders } from "./defaults";
import { modelCatalog } from "./model-catalog";
import {
  isLlmProviderUsable,
  isModelProviderUsable,
  isTranscriptionProviderUsable,
  llmProviderFromModel,
  transcriptionProviderFromModel
} from "./model-activation";

describe("transcriptionProviderFromModel", () => {
  it("maps active Whisper models to the bundled whisper.cpp runtime", () => {
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    expect(item).toBeDefined();

    const provider = transcriptionProviderFromModel(item!);

    expect(provider?.id).toBe("local-whisper-cpp");
    expect(provider?.baseUrl).toBe("murmur://runtime/whisper.cpp");
  });

  it("maps active Sherpa models to the bundled sherpa-onnx runtime", () => {
    const item = modelCatalog.find((candidate) => candidate.id === "nvidia-parakeet-tdt-ctc-110m");
    expect(item).toBeDefined();

    const provider = transcriptionProviderFromModel(item!);

    expect(provider?.id).toBe("local-nvidia-parakeet-stt");
    expect(provider?.baseUrl).toBe("murmur://runtime/sherpa-onnx");
  });

  it("maps remote STT models to the default cloud provider records", () => {
    const openai = modelCatalog.find((candidate) => candidate.id === "openai-gpt-4o-transcribe");
    expect(openai).toBeDefined();

    expect(transcriptionProviderFromModel(openai!)?.id).toBe("openai-stt");
  });
});

describe("llmProviderFromModel", () => {
  it("maps remote language models to default cloud provider records", () => {
    const openai = modelCatalog.find((candidate) => candidate.id === "openai-gpt-5-5");
    const anthropic = modelCatalog.find((candidate) => candidate.id === "anthropic-claude-sonnet-4-6");
    const google = modelCatalog.find((candidate) => candidate.id === "google-gemini-3-5-flash");

    expect(llmProviderFromModel(openai!)?.id).toBe("openai-llm");
    expect(llmProviderFromModel(anthropic!)?.id).toBe("anthropic");
    expect(llmProviderFromModel(google!)?.id).toBe("google");
  });
});

describe("provider usability", () => {
  it("requires cloud STT providers to be enabled, allowed, and credentialed", () => {
    const provider = defaultTranscriptionProviders.find((candidate) => candidate.id === "openai-stt");
    expect(provider).toBeDefined();

    expect(isTranscriptionProviderUsable({ ...provider!, enabled: false, apiKey: "sk-test" }, defaultSettings)).toBe(false);
    expect(isTranscriptionProviderUsable({ ...provider!, enabled: true, apiKey: "" }, defaultSettings)).toBe(false);
    expect(isTranscriptionProviderUsable({ ...provider!, enabled: true, apiKey: "   " }, defaultSettings)).toBe(false);
    expect(
      isTranscriptionProviderUsable({ ...provider!, enabled: true, apiKey: "sk-test" }, { ...defaultSettings, localOnly: true })
    ).toBe(false);
    expect(isTranscriptionProviderUsable({ ...provider!, enabled: true, apiKey: "sk-test" }, defaultSettings)).toBe(true);
  });

  it("requires cloud LLM providers to be enabled, allowed, and credentialed", () => {
    const provider = defaultLlmProviders.find((candidate) => candidate.id === "openai-llm");
    expect(provider).toBeDefined();

    expect(isLlmProviderUsable({ ...provider!, enabled: false, apiKey: "sk-test" }, defaultSettings)).toBe(false);
    expect(isLlmProviderUsable({ ...provider!, enabled: true, apiKey: "" }, defaultSettings)).toBe(false);
    expect(isLlmProviderUsable({ ...provider!, enabled: true, apiKey: "sk-test" }, { ...defaultSettings, localOnly: true })).toBe(
      false
    );
    expect(isLlmProviderUsable({ ...provider!, enabled: true, apiKey: "sk-test" }, defaultSettings)).toBe(true);
  });

  it("gates API-backed model providers on credentials and local-only mode", () => {
    const sttModel = modelCatalog.find((candidate) => candidate.id === "openai-gpt-4o-transcribe");
    const llmModel = modelCatalog.find((candidate) => candidate.id === "openai-gpt-5-5");
    expect(sttModel).toBeDefined();
    expect(llmModel).toBeDefined();

    const credentialedSttProviders = defaultTranscriptionProviders.map((provider) =>
      provider.id === "openai-stt" ? { ...provider, apiKey: "sk-test" } : provider
    );
    const credentialedLlmProviders = defaultLlmProviders.map((provider) =>
      provider.id === "openai-llm" ? { ...provider, apiKey: "sk-test" } : provider
    );

    expect(
      isModelProviderUsable(sttModel!, {
        settings: defaultSettings,
        transcriptionProviders: defaultTranscriptionProviders,
        llmProviders: defaultLlmProviders
      })
    ).toBe(false);
    expect(
      isModelProviderUsable(sttModel!, {
        settings: defaultSettings,
        transcriptionProviders: credentialedSttProviders,
        llmProviders: defaultLlmProviders
      })
    ).toBe(true);
    expect(
      isModelProviderUsable(llmModel!, {
        settings: { ...defaultSettings, localOnly: true },
        transcriptionProviders: defaultTranscriptionProviders,
        llmProviders: credentialedLlmProviders
      })
    ).toBe(false);
    expect(
      isModelProviderUsable(llmModel!, {
        settings: defaultSettings,
        transcriptionProviders: defaultTranscriptionProviders,
        llmProviders: credentialedLlmProviders
      })
    ).toBe(true);
  });
});
