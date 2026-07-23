import { describe, expect, it } from "vitest";
import {
  defaultAutoModeRules,
  defaultLlmProviders,
  defaultModes,
  defaultSettings,
  defaultTranscriptionProviders
} from "../../shared/defaults";
import type { DictationInvalidationReason } from "./dictation-session";
import {
  createDictationProcessingPlan,
  DictationSessionOwner,
  StaleDictationSessionError
} from "./dictation-session";

function processingPlan() {
  return createDictationProcessingPlan({
    source: "dictation",
    settings: { ...defaultSettings },
    modes: defaultModes.map((mode) => ({
      ...mode,
      examples: mode.examples.map((example) => ({ ...example })),
      context: { ...mode.context }
    })),
    autoModeRules: defaultAutoModeRules.map((rule) => ({ ...rule, match: { ...rule.match } })),
    vocabulary: [{ id: "vocabulary-1", term: "Murmur", enabled: true }],
    sttProvider: {
      ...defaultTranscriptionProviders[0],
      id: "stt-frozen",
      baseUrl: "https://stt.example.test/v1",
      defaultModel: "voice-model-v1",
      apiKeySecretId: "secret-stt-1",
      apiKey: "stt-key-v1",
      isCloud: true,
      isLocal: false
    },
    llmProvider: {
      ...defaultLlmProviders[0],
      id: "llm-frozen",
      baseUrl: "https://llm.example.test/v1",
      defaultModel: "language-model-v1",
      apiKeySecretId: "secret-llm-1",
      apiKey: "llm-key-v1",
      isCloud: true
    }
  });
}

describe("dictation session ownership", () => {
  it("freezes the processing configuration and resolved credentials for the full recording", () => {
    const settings = { ...defaultSettings, activeModeId: defaultModes[0].id };
    const modes = defaultModes.map((mode) => ({
      ...mode,
      examples: mode.examples.map((example) => ({ ...example })),
      context: { ...mode.context }
    }));
    const rules = [
      {
        id: "rule-1",
        name: "Editor",
        modeId: modes[0].id,
        priority: 1,
        enabled: true,
        match: { appName: "Editor" }
      }
    ];
    const vocabulary = [{ id: "word-1", term: "original", enabled: true }];
    const sttProvider = {
      ...defaultTranscriptionProviders[0],
      baseUrl: "https://stt.example.test/v1",
      defaultModel: "voice-model-v1",
      apiKeySecretId: "secret-stt-1",
      apiKey: "stt-key-v1"
    };
    const llmProvider = {
      ...defaultLlmProviders[0],
      baseUrl: "https://llm.example.test/v1",
      defaultModel: "language-model-v1",
      apiKeySecretId: "secret-llm-1",
      apiKey: "llm-key-v1"
    };

    const plan = createDictationProcessingPlan({
      source: "dictation",
      settings,
      modes,
      autoModeRules: rules,
      vocabulary,
      sttProvider,
      llmProvider
    });

    settings.activeModeId = "changed-mode";
    modes[0].name = "Changed mode";
    modes[0].context.app = !modes[0].context.app;
    rules[0].match.appName = "Changed app";
    vocabulary[0].term = "changed";
    sttProvider.baseUrl = "https://changed-stt.example.test";
    sttProvider.defaultModel = "voice-model-v2";
    sttProvider.apiKey = "stt-key-v2";
    llmProvider.baseUrl = "https://changed-llm.example.test";
    llmProvider.defaultModel = "language-model-v2";
    llmProvider.apiKey = "llm-key-v2";

    expect(plan.settings.activeModeId).toBe(defaultModes[0].id);
    expect(plan.modes[0].name).not.toBe("Changed mode");
    expect(plan.autoModeRules[0].match.appName).toBe("Editor");
    expect(plan.vocabulary[0].term).toBe("original");
    expect(plan.sttProvider).toMatchObject({
      baseUrl: "https://stt.example.test/v1",
      defaultModel: "voice-model-v1",
      apiKeySecretId: "secret-stt-1",
      apiKey: "stt-key-v1"
    });
    expect(plan.llmProvider).toMatchObject({
      baseUrl: "https://llm.example.test/v1",
      defaultModel: "language-model-v1",
      apiKeySecretId: "secret-llm-1",
      apiKey: "llm-key-v1"
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.modes[0].context)).toBe(true);
    expect(Object.isFrozen(plan.autoModeRules[0].match)).toBe(true);
  });

  it.each<DictationInvalidationReason>(["cancelled", "cleared", "failed", "shutdown", "timed_out"])(
    "aborts and rejects a stale continuation after the session is %s",
    async (reason) => {
      const owner = new DictationSessionOwner();
      const operation = owner.start("session-1", processingPlan());
      owner.markAwaitingAudio(operation);
      expect(owner.claimAudio("session-1")).toBe(operation);

      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let sideEffect = false;
      const continuation = pending.then(() => {
        owner.assertCurrent(operation);
        sideEffect = true;
      });

      owner.invalidate(reason);
      release();

      await expect(continuation).rejects.toBeInstanceOf(StaleDictationSessionError);
      expect(operation.controller.signal.aborted).toBe(true);
      expect(owner.isCurrent(operation)).toBe(false);
      expect(sideEffect).toBe(false);
    }
  );

  it("aborts the previous generation when a new recording supersedes it", () => {
    const owner = new DictationSessionOwner();
    const first = owner.start("session-1", processingPlan());
    const second = owner.start("session-2", processingPlan());

    expect(first.controller.signal.aborted).toBe(true);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(owner.isCurrent(first)).toBe(false);
    expect(owner.isCurrent(second)).toBe(true);
    expect(() => owner.assertCurrent(first)).toThrow(StaleDictationSessionError);
  });

  it("accepts audio only while the matching generation is awaiting completion", () => {
    const owner = new DictationSessionOwner();
    const operation = owner.start("session-1", processingPlan());

    expect(owner.claimAudio("session-1")).toBeNull();
    owner.markAwaitingAudio(operation);
    expect(owner.claimAudio("wrong-session")).toBeNull();

    owner.invalidate("timed_out");

    expect(owner.claimAudio("session-1")).toBeNull();
    expect(operation.controller.signal.aborted).toBe(true);
  });
});
