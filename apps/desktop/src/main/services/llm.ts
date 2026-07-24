import { codexModel } from "../../shared/codex-provider";
import type { LlmProviderConfig, ProcessedResult } from "../../shared/types";
import {
  closeResponseBody,
  fetchWithTimeout,
  joinUrl,
  parseJsonOrText,
  providerSuccessBodyMaxBytes,
  providerValidationBodyMaxBytes
} from "./http";
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
const validationTimeoutMs = 8000;

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
      const path = provider.type === "ollama" ? "/api/tags" : "/models";
      const response = await fetchWithTimeout(
        joinUrl(provider.baseUrl, path),
        { headers: validationHeaders(provider) },
        validationTimeoutMs
      );
      if (!response.ok) {
        await closeResponseBody(response);
        return {
          ok: false,
          message: response.status === 401 || response.status === 403
            ? "Authentication failed."
            : `Provider validation failed with HTTP ${response.status}.`
        };
      }

      const data = await parseJsonOrText(response, {
        totalTimeoutMs: validationTimeoutMs,
        idleTimeoutMs: validationTimeoutMs,
        maxBytes: providerValidationBodyMaxBytes,
        label: "Provider validation"
      });
      if (!isValidModelList(provider, data)) {
        return { ok: false, message: "Provider returned an unexpected validation response." };
      }
      return { ok: true, message: `Provider responded with HTTP ${response.status}.` };
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
    await assertSuccessfulResponse(response, "Ollama");
    const data = await parseProviderResponse(response, "Ollama response", timeouts, options.signal);
    if (!isRecord(data) || data.done !== true || !isRecord(data.message) || typeof data.message.content !== "string") {
      throw new Error("Ollama returned an invalid success response.");
    }
    return {
      text: requireCleanupText(data.message.content, "Ollama"),
      providerId: options.provider.id,
      model: options.provider.defaultModel
    };
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
    await assertSuccessfulResponse(response, "LLM");
    const data = await parseProviderResponse(response, "LLM response", timeouts, options.signal);
    const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
    if (
      !isRecord(choice) ||
      choice.finish_reason !== "stop" ||
      !isRecord(choice.message) ||
      typeof choice.message.content !== "string"
    ) {
      throw new Error("LLM provider returned an incomplete or invalid success response.");
    }
    return {
      text: requireCleanupText(choice.message.content, "LLM provider"),
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
          max_tokens: anthropicOutputTokenBudget(options.prompt),
          temperature: 0.2,
          messages: [{ role: "user", content: options.prompt }]
        })
      },
      timeouts.totalTimeoutMs
    );
    await assertSuccessfulResponse(response, "Anthropic");
    const data = await parseProviderResponse(response, "Anthropic response", timeouts, options.signal);
    if (!isRecord(data) || data.stop_reason !== "end_turn" || !Array.isArray(data.content)) {
      throw new Error(`Anthropic returned an incomplete or invalid success response${anthropicStopReasonSuffix(data)}.`);
    }
    if (!data.content.every((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")) {
      throw new Error("Anthropic returned an invalid content response.");
    }
    const text = data.content.map((part) => (part as Record<string, unknown>).text as string).join("");
    return {
      text: requireCleanupText(text, "Anthropic"),
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
    await assertSuccessfulResponse(response, "Google LLM");
    const data = await parseProviderResponse(response, "Google LLM response", timeouts, options.signal);
    const candidate = isRecord(data) && Array.isArray(data.candidates) ? data.candidates[0] : undefined;
    const parts = isRecord(candidate) && isRecord(candidate.content) && Array.isArray(candidate.content.parts)
      ? candidate.content.parts
      : undefined;
    if (
      !isRecord(candidate) ||
      candidate.finishReason !== "STOP" ||
      !parts ||
      !parts.every((part) => isRecord(part) && typeof part.text === "string")
    ) {
      throw new Error("Google LLM returned an incomplete or invalid success response.");
    }
    const text = parts.map((part) => (part as Record<string, unknown>).text as string).join("");
    return { text: requireCleanupText(text, "Google LLM"), providerId: options.provider.id, model };
  }
}

async function parseProviderResponse(
  response: Response,
  label: string,
  timeouts: { totalTimeoutMs: number; idleTimeoutMs: number },
  signal?: AbortSignal
): Promise<unknown> {
  return parseJsonOrText(response, {
    ...timeouts,
    maxBytes: providerSuccessBodyMaxBytes,
    label,
    signal
  });
}

async function assertSuccessfulResponse(response: Response, providerLabel: string): Promise<void> {
  if (response.ok) return;
  await closeResponseBody(response);
  throw providerHttpError(providerLabel, response);
}

function providerHttpError(providerLabel: string, response: Response): Error {
  const requestId = boundedRequestId(response);
  return new Error(`${providerLabel} failed with HTTP ${response.status}${requestId ? ` (request ID ${requestId})` : ""}.`);
}

function boundedRequestId(response: Response): string | undefined {
  const value = response.headers.get("request-id") ?? response.headers.get("x-request-id");
  if (!value) return undefined;
  const sanitized = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 128);
  return sanitized || undefined;
}

function validationHeaders(provider: LlmProviderConfig): HeadersInit {
  if (provider.type === "google") {
    return provider.apiKey ? { "x-goog-api-key": provider.apiKey } : {};
  }
  if (provider.type === "anthropic") {
    return { ...llmProviderAuthHeaders(provider), "anthropic-version": "2023-06-01" };
  }
  return llmProviderAuthHeaders(provider);
}

function isValidModelList(provider: LlmProviderConfig, data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (provider.type === "ollama" || provider.type === "google") return Array.isArray(data.models);
  return Array.isArray(data.data);
}

function requireCleanupText(value: string, providerLabel: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${providerLabel} returned empty cleanup text.`);
  return text;
}

function anthropicOutputTokenBudget(prompt: string): number {
  return Math.min(16384, Math.max(2048, Math.ceil(prompt.length / 3)));
}

function anthropicStopReasonSuffix(data: unknown): string {
  if (!isRecord(data) || typeof data.stop_reason !== "string") return "";
  return ` (stop reason ${data.stop_reason})`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
