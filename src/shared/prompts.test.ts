import { describe, expect, it } from "vitest";
import { defaultModes } from "./defaults";
import { buildProcessingPrompt, buildVocabularyPrompt } from "./prompts";
import type { ContextSnapshot, VocabularyEntry } from "./types";

describe("LLM prompt context", () => {
  const mode = defaultModes.find((candidate) => candidate.id === "default")!;
  const context: ContextSnapshot = {
    appName: "Mail",
    windowTitle: "Inbox",
    selectedText: "Selected secret",
    clipboardText: "Clipboard secret",
    capturedAt: "2026-06-27T00:00:00.000Z",
    sourceQuality: "full",
    diagnostics: []
  };

  it("includes active context requested by the selected mode", () => {
    const prompt = buildProcessingPrompt({
      mode,
      context,
      rawTranscript: "reply politely",
      vocabularyPrompt: ""
    });

    expect(prompt).toContain("Selected secret");
    expect(prompt).toContain("Clipboard secret");
    expect(prompt).toContain("Active app: Mail");
    expect(prompt).toContain("Window title: Inbox");
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
  it("includes only enabled context channels and clips large selected text", () => {
    const mode = {
      ...defaultModes[0],
      context: { app: true, selectedText: true, clipboardText: false }
    };
    const context: ContextSnapshot = {
      appName: "Code",
      selectedText: "x".repeat(4010),
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
    expect(prompt).not.toContain("do not include clipboard");
    expect(prompt).toContain("Raw transcript:\nship the patch");
  });

  it("includes a custom writing style when configured", () => {
    const mode = {
      ...defaultModes[0],
      writingStyle: "Keep it warm and concise."
    };
    const context: ContextSnapshot = {
      capturedAt: "2026-01-01T00:00:00.000Z",
      sourceQuality: "full",
      diagnostics: []
    };

    const prompt = buildProcessingPrompt({
      mode,
      context,
      rawTranscript: "thanks for the update",
      vocabularyPrompt: ""
    });

    expect(prompt).toContain("Model instructions:\nKeep it warm and concise.");
  });
});
