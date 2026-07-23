import { codexModel } from "../../shared/codex-provider";
import type { LlmProviderConfig, ProcessedResult } from "../../shared/types";
import { fetchWithTimeout, joinUrl, parseJsonOrText, readResponseText } from "./http";
import { llmProviderAuthHeaders } from "./provider-auth";

interface LlmOptions {
  provider: LlmProviderConfig;
  prompt: string;
  signal?: AbortSignal;
}

interface CodexLlmClient {
  getStatus(): { status: string; message: string; modelAvailable: boolean };
  refreshStatus(): Promise<{ status: string; message: string; modelAvailable: boolean }>;
  processCleanup(options: { prompt: string; model: string; signal?: AbortSignal }): Promise<ProcessedResult>;
}

const llmTimeoutMs = 120000;
const llmIdleTimeoutMs = 30000;

export class LlmService {
  constructor(private codex?: CodexLlmClient) {}

  async process(options: LlmOptions): Promise<ProcessedResult> {
    const { provider } = options;
    if (!provider.enabled) {
      throw new Error(`LLM provider "${provider.name}" is disabled.`);
    }

    if (provider.type === "codex") {
      if (!this.codex) throw new Error("Codex OAuth is unavailable.");
      return this.codex.processCleanup({ prompt: options.prompt, model: provider.defaultModel || codexModel, signal: options.signal });
    }
    if (provider.type === "ollama") return this.processOllama(options);
    if (provider.type === "anthropic") return this.processAnthropic(options);
    if (provider.type === "google") return this.processGoogle(options);
    return this.processOpenAiCompatible(options);
  }

  async validate(provider: LlmProviderConfig): Promise<{ ok: boolean; message: string }> {
    if (provider.type === "codex") {
      if (!this.codex) return { ok: false, message: "Codex OAuth is unavailable." };
      const status = await this.codex.refreshStatus();
      return {
        ok: status.status === "connected" && status.modelAvailable,
        message: status.message
      };
    }
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

    try {
      const path = provider.type === "ollama" ? "/api/tags" : provider.type === "google" ? "" : "/models";
      const response = await fetchWithTimeout(joinUrl(provider.baseUrl, path), { headers: llmProviderAuthHeaders(provider) }, 8000);
      if (response.status === 401 || response.status === 403) return { ok: false, message: "Authentication failed." };
      return { ok: response.ok || response.status < 500, message: `Provider responded with HTTP ${response.status}.` };
    } catch (error) {
      return { ok: false, message: `Provider connection failed: ${errorMessage(error)}` };
    }
  }

  private async processOllama(options: LlmOptions): Promise<ProcessedResult> {
    const timeouts = llmHttpTimeouts();
    const response = await fetchWithTimeout(
      joinUrl(options.provider.baseUrl || "http://127.0.0.1:11434", "/api/chat"),
      {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.provider.defaultModel || "llama3.1",
          stream: false,
          messages: [{ role: "user", content: options.prompt }]
        })
      },
      timeouts.totalTimeoutMs
    );
    if (!response.ok) {
      const body = await readResponseText(response, { ...timeouts, label: "Ollama error", signal: options.signal });
      throw new Error(`Ollama failed with HTTP ${response.status}: ${body}`);
    }
    const data = await parseJsonOrText(response, { ...timeouts, label: "Ollama response", signal: options.signal });
    return { text: data?.message?.content?.trim() ?? "", providerId: options.provider.id, model: options.provider.defaultModel };
  }

  private async processOpenAiCompatible(options: LlmOptions): Promise<ProcessedResult> {
    const timeouts = llmHttpTimeouts();
    const response = await fetchWithTimeout(
      joinUrl(options.provider.baseUrl || "https://api.openai.com/v1", "/chat/completions"),
      {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json", ...llmProviderAuthHeaders(options.provider) },
        body: JSON.stringify({
          model: options.provider.defaultModel || "gpt-4.1-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: "You return only final text to paste." },
            { role: "user", content: options.prompt }
          ]
        })
      },
      timeouts.totalTimeoutMs
    );
    if (!response.ok) {
      const body = await readResponseText(response, { ...timeouts, label: "LLM error", signal: options.signal });
      throw new Error(`LLM failed with HTTP ${response.status}: ${body}`);
    }
    const data = await parseJsonOrText(response, { ...timeouts, label: "LLM response", signal: options.signal });
    return {
      text: data?.choices?.[0]?.message?.content?.trim() ?? "",
      providerId: options.provider.id,
      model: options.provider.defaultModel
    };
  }

  private async processAnthropic(options: LlmOptions): Promise<ProcessedResult> {
    const timeouts = llmHttpTimeouts();
    const response = await fetchWithTimeout(
      joinUrl(options.provider.baseUrl || "https://api.anthropic.com", "/v1/messages"),
      {
        method: "POST",
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": options.provider.apiKey || ""
        },
        body: JSON.stringify({
          model: options.provider.defaultModel || "claude-sonnet-4-6",
          max_tokens: 2048,
          temperature: 0.2,
          messages: [{ role: "user", content: options.prompt }]
        })
      },
      timeouts.totalTimeoutMs
    );
    if (!response.ok) {
      const body = await readResponseText(response, { ...timeouts, label: "Anthropic error", signal: options.signal });
      throw new Error(`Anthropic failed with HTTP ${response.status}: ${body}`);
    }
    const data = await parseJsonOrText(response, { ...timeouts, label: "Anthropic response", signal: options.signal });
    return {
      text: data?.content?.map((part: any) => part.text).join("").trim() ?? "",
      providerId: options.provider.id,
      model: options.provider.defaultModel
    };
  }

  private async processGoogle(options: LlmOptions): Promise<ProcessedResult> {
    const timeouts = llmHttpTimeouts();
    const model = options.provider.defaultModel || "gemini-2.5-flash";
    const endpoint = joinUrl(
      options.provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
      `/models/${model}:generateContent`
    );
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": options.provider.apiKey || "" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: options.prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      },
      timeouts.totalTimeoutMs
    );
    if (!response.ok) {
      const body = await readResponseText(response, { ...timeouts, label: "Google LLM error", signal: options.signal });
      throw new Error(`Google LLM failed with HTTP ${response.status}: ${body}`);
    }
    const data = await parseJsonOrText(response, { ...timeouts, label: "Google LLM response", signal: options.signal });
    const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("").trim() ?? "";
    return { text, providerId: options.provider.id, model };
  }
}

function llmHttpTimeouts(): { totalTimeoutMs: number; idleTimeoutMs: number } {
  return {
    totalTimeoutMs: envPositiveInteger("MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS", llmTimeoutMs),
    idleTimeoutMs: envPositiveInteger("MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS", llmIdleTimeoutMs)
  };
}

function envPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
