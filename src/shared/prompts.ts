import type { ContextSnapshot, ModeConfig, VocabularyEntry } from "./types";

export function buildVocabularyPrompt(vocabulary: VocabularyEntry[]): string {
  const terms = vocabulary
    .filter((entry) => entry.term.trim().length > 0)
    .slice(0, 80)
    .map((entry) => {
      const term = entry.term.trim();
      const pronunciation = entry.pronunciation ? ` (${entry.pronunciation})` : "";
      const category = entry.category ? ` [${entry.category}]` : "";
      return `- ${term}${pronunciation}${category}`;
    });

  return terms.length > 0
    ? `Prefer these spellings for names, products, acronyms, and technical terms:\n${terms.join("\n")}`
    : "";
}

export function buildProcessingPrompt(options: {
  mode: ModeConfig;
  context: ContextSnapshot;
  rawTranscript: string;
  vocabularyPrompt: string;
}): string {
  const { mode, context, rawTranscript, vocabularyPrompt } = options;
  const contextLines = [
    mode.context.app && context.appName ? `Active app: ${context.appName}` : "",
    mode.context.app && context.windowTitle ? `Window title: ${context.windowTitle}` : "",
    mode.context.selectedText && context.selectedText ? `Selected text:\n${clip(context.selectedText, 4000)}` : "",
    mode.context.clipboardText && context.clipboardText ? `Recent clipboard text:\n${clip(context.clipboardText, 2500)}` : ""
  ].filter(Boolean);

  const examples = mode.examples
    .slice(0, 8)
    .map((example, index) => `Example ${index + 1}\nInput: ${example.input}\nOutput: ${example.output}`)
    .join("\n\n");
  const modelInstructions = mode.writingStyle.trim() ? `Model instructions:\n${mode.writingStyle.trim()}` : "";

  return [
    "You are Murmur, a system-wide dictation cleanup engine.",
    "Rules:",
    "- Remove filler words and false starts unless the selected mode explicitly needs raw text.",
    "- Fix punctuation, casing, and obvious speech recognition errors.",
    "- Preserve the user's intent, facts, tone, and uncertainty.",
    "- Do not invent details, recipients, dates, links, or commitments.",
    "- Return only the final text to paste. Do not explain your changes.",
    "",
    `Mode: ${mode.name}`,
    modelInstructions,
    mode.instructionPrompt,
    vocabularyPrompt,
    contextLines.length > 0 ? `Context:\n${contextLines.join("\n\n")}` : "Context: unavailable",
    examples ? `Examples:\n${examples}` : "",
    `Raw transcript:\n${rawTranscript}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
