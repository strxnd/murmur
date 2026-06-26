import type { LlmProviderConfig } from "../../shared/types";

export function llmProviderAuthHeaders(provider: LlmProviderConfig): HeadersInit {
  if (!provider.apiKey) return {};
  if (provider.type === "anthropic") return { "x-api-key": provider.apiKey };
  return { Authorization: `Bearer ${provider.apiKey}` };
}
