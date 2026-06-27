import { describe, expect, it } from "vitest";
import { defaultModes } from "./defaults";
import { buildProcessingPrompt, contextForLlmPrompt } from "./prompts";
import type { ContextSnapshot } from "./types";

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
