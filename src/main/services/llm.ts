import type { LlmProviderConfig, ProcessedResult } from "../../shared/types";
import { fetchWithTimeout, joinUrl, parseJsonOrText } from "./http";

interface LlmOptions {
  provider: LlmProviderConfig;
  prompt: string;
  localOnly: boolean;
}

export class LlmService {
  async process(options: LlmOptions): Promise<ProcessedResult> {
    const { provider, localOnly } = options;
    if (localOnly && provider.isCloud) {
      throw new Error(`Local-only mode blocks cloud LLM provider "${provider.name}".`);
    }
    if (!provider.enabled) {
      throw new Error(`LLM provider "${provider.name}" is disabled.`);
    }

    if (provider.type === "ollama") return this.processOllama(options);
    if (provider.type === "anthropic") return this.processAnthropic(options);
    if (provider.type === "google") return this.processGoogle(options);
    return this.processOpenAiCompatible(options);
  }

  async validate(provider: LlmProviderConfig): Promise<{ ok: boolean; message: string }> {
    if (provider.isCloud && !provider.apiKey) {
      return { ok: false, message: "Cloud LLM provider needs an API key before validation." };
    }
    if (!provider.baseUrl) {
      return { ok: false, message: "Base URL is required." };
    }
    try {
      new URL(provider.baseUrl);
    } catch {
      return { ok: false, message: "Base URL is not valid." };
    }

    const path = provider.type === "ollama" ? "/api/tags" : provider.type === "google" ? "" : "/models";
    const response = await fetchWithTimeout(joinUrl(provider.baseUrl, path), { headers: this.headers(provider) }, 8000);
    if (response.status === 401 || response.status === 403) return { ok: false, message: "Authentication failed." };
    return { ok: response.ok || response.status < 500, message: `Provider responded with HTTP ${response.status}.` };
  }

  private async processOllama(options: LlmOptions): Promise<ProcessedResult> {
    const response = await fetchWithTimeout(
      joinUrl(options.provider.baseUrl || "http://127.0.0.1:11434", "/api/chat"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.provider.defaultModel || "llama3.1",
          stream: false,
          messages: [{ role: "user", content: options.prompt }]
        })
      },
      120000
    );
    if (!response.ok) throw new Error(`Ollama failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await parseJsonOrText(response);
    return { text: data?.message?.content?.trim() ?? "", providerId: options.provider.id, model: options.provider.defaultModel };
  }

  private async processOpenAiCompatible(options: LlmOptions): Promise<ProcessedResult> {
    const response = await fetchWithTimeout(
      joinUrl(options.provider.baseUrl || "https://api.openai.com/v1", "/chat/completions"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(options.provider) },
        body: JSON.stringify({
          model: options.provider.defaultModel || "gpt-4.1-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: "You return only final text to paste." },
            { role: "user", content: options.prompt }
          ]
        })
      },
      120000
    );
    if (!response.ok) throw new Error(`LLM failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await parseJsonOrText(response);
    return {
      text: data?.choices?.[0]?.message?.content?.trim() ?? "",
      providerId: options.provider.id,
      model: options.provider.defaultModel
    };
  }

  private async processAnthropic(options: LlmOptions): Promise<ProcessedResult> {
    const response = await fetchWithTimeout(
      joinUrl(options.provider.baseUrl || "https://api.anthropic.com", "/v1/messages"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": options.provider.apiKey || ""
        },
        body: JSON.stringify({
          model: options.provider.defaultModel || "claude-sonnet-4-5",
          max_tokens: 2048,
          temperature: 0.2,
          messages: [{ role: "user", content: options.prompt }]
        })
      },
      120000
    );
    if (!response.ok) throw new Error(`Anthropic failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await parseJsonOrText(response);
    return {
      text: data?.content?.map((part: any) => part.text).join("").trim() ?? "",
      providerId: options.provider.id,
      model: options.provider.defaultModel
    };
  }

  private async processGoogle(options: LlmOptions): Promise<ProcessedResult> {
    const model = options.provider.defaultModel || "gemini-2.5-flash";
    const endpoint = `${joinUrl(options.provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta", `/models/${model}:generateContent`)}?key=${encodeURIComponent(options.provider.apiKey || "")}`;
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: options.prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      },
      120000
    );
    if (!response.ok) throw new Error(`Google LLM failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await parseJsonOrText(response);
    const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("").trim() ?? "";
    return { text, providerId: options.provider.id, model };
  }

  private headers(provider: LlmProviderConfig): HeadersInit {
    if (!provider.apiKey) return {};
    if (provider.type === "anthropic") return { "x-api-key": provider.apiKey };
    return { Authorization: `Bearer ${provider.apiKey}` };
  }
}
