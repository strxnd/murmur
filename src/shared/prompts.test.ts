import { describe, expect, it } from "vitest";
import { defaultModes } from "./defaults";
import { buildProcessingPrompt, buildVocabularyPrompt, contextForLlmPrompt } from "./prompts";
import type { ContextSnapshot, VocabularyEntry } from "./types";

describe("LLM prompt context", () => {
  const mode = defaultModes.find((candidate) => candidate.id === "default")!;
  const context: ContextSnapshot = {
    appName: "Mail",
    windowTitle: "Inbox",
    browserDomain: "example.test",
    focusedText: "Focused field",
    selectedText: "Selected secret",
    clipboardText: "Clipboard secret",
    capturedAt: "2026-06-27T00:00:00.000Z",
    sourceQuality: "full",
    diagnostics: []
  };

  it("omits active context for cloud LLMs unless sharing is enabled", () => {
    const prompt = buildProcessingPrompt({
      mode,
      context: contextForLlmPrompt(context, { providerIsCloud: true, shareContextWithCloudLlm: false }),
      rawTranscript: "reply politely",
      vocabularyPrompt: ""
    });

    expect(prompt).toContain("Context: unavailable");
    expect(prompt).not.toContain("Selected secret");
    expect(prompt).not.toContain("Clipboard secret");
    expect(prompt).not.toContain("Active app: Mail");
    expect(prompt).not.toContain("Window title: Inbox");
  });

  it("keeps active context for local LLMs", () => {
    const prompt = buildProcessingPrompt({
      mode,
      context: contextForLlmPrompt(context, { providerIsCloud: false, shareContextWithCloudLlm: false }),
      rawTranscript: "reply politely",
      vocabularyPrompt: ""
    });

    expect(prompt).toContain("Selected secret");
    expect(prompt).toContain("Clipboard secret");
    expect(prompt).toContain("Active app: Mail");
  });

  it("keeps active context for cloud LLMs after explicit opt-in", () => {
    const prompt = buildProcessingPrompt({
      mode,
      context: contextForLlmPrompt(context, { providerIsCloud: true, shareContextWithCloudLlm: true }),
      rawTranscript: "reply politely",
      vocabularyPrompt: ""
    });

    expect(prompt).toContain("Selected secret");
    expect(prompt).toContain("Clipboard secret");
    expect(prompt).toContain("Active app: Mail");
  });
});

describe("buildVocabularyPrompt", () => {
  it("trims entries, keeps pronunciation metadata, and caps prompt terms", () => {
    const vocabulary: VocabularyEntry[] = [
      { id: "blank", term: "   ", enabled: true },
      { id: "murmur", term: " Murmur ", pronunciation: "mer-mer", category: "product", enabled: true },
      ...Array.from({ length: 80 }, (_, index) => ({
        id: `term-${index}`,
        term: `Term ${index}`,
        enabled: true
      }))
    ];

    const prompt = buildVocabularyPrompt(vocabulary);

    expect(prompt).toContain("- Murmur (mer-mer) [product]");
    expect(prompt).toContain("- Term 78");
    expect(prompt).not.toContain("- Term 79");
    expect(prompt).not.toContain("blank");
  });
});

describe("buildProcessingPrompt", () => {
  it("includes only enabled context channels and clips large focused text", () => {
    const mode = {
      ...defaultModes[0],
      context: { app: true, selectedText: false, clipboardText: false }
    };
    const context: ContextSnapshot = {
      appName: "Code",
      focusedText: "x".repeat(4010),
      selectedText: "do not include",
      clipboardText: "do not include clipboard",
      capturedAt: "2026-01-01T00:00:00.000Z",
      sourceQuality: "full",
      diagnostics: []
    };

    const prompt = buildProcessingPrompt({
      mode,
      context,
      rawTranscript: "ship the patch",
      vocabularyPrompt: "Prefer Murmur."
    });

    expect(prompt).toContain("Active app: Code");
    expect(prompt).toContain(`${"x".repeat(4000)}...`);
    expect(prompt).not.toContain("do not include");
    expect(prompt).toContain("Raw transcript:\nship the patch");
  });
});
