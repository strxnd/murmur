import type { LlmProviderConfig } from "./types";

export const codexModel = "gpt-5.6-luna";

export const codexProviderDefaults = {
  id: "codex",
  type: "codex",
  name: "Codex",
  isCloud: true,
  defaultModel: codexModel,
  enabled: true
} satisfies LlmProviderConfig;
