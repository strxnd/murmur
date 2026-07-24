import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderConfig } from "../../shared/types";
import { providerSuccessBodyMaxBytes } from "./http";
import { LlmService } from "./llm";

const servers: Array<() => Promise<void>> = [];
const originalTotalTimeout = process.env.MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS;
const originalIdleTimeout = process.env.MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS;

afterEach(async () => {
  restoreTimeoutEnv();
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((close) => close()));
});

describe("LlmService", () => {
  it("returns a failed validation result when the provider connection fails", async () => {
    const { url } = await startServer((response) => response.socket?.destroy());
    const service = new LlmService();

    const result = await service.validate(ollamaProvider(url));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Provider connection failed:/);
  });

  it("rejects stalled response bodies", async () => {
    process.env.MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS = "60";
    process.env.MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS = "20";
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"message":');
    });

    const service = new LlmService();

    await expect(service.process({ provider: ollamaProvider(url), prompt: "clean this up" })).rejects.toThrow(/Ollama response/);
  });

  it("sends Google API keys in headers without placing them in request URLs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Clean this." }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LlmService();
    const provider: LlmProviderConfig = {
      id: "google",
      type: "google",
      name: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "google-secret",
      isCloud: true,
      defaultModel: "gemini-2.5-flash",
      enabled: true
    };

    await expect(service.process({ provider, prompt: "clean this" })).resolves.toMatchObject({ text: "Clean this." });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("google-secret");
    expect(String(url)).not.toContain("?key=");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "google-secret" });
  });

  it("rejects non-2xx validation responses and cancels their bodies", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not found"));
      },
      cancel() {
        cancelled = true;
      }
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 404 })));
    const service = new LlmService();

    const result = await service.validate(openAiProvider("https://provider.invalid/v1"));

    expect(result).toEqual({ ok: false, message: "Provider validation failed with HTTP 404." });
    expect(cancelled).toBe(true);
  });

  it("consumes successful validation bodies before returning", async () => {
    const response = new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
    const service = new LlmService();

    await expect(service.validate(openAiProvider("https://provider.invalid/v1"))).resolves.toEqual({
      ok: true,
      message: "Provider responded with HTTP 200."
    });
    expect(response.bodyUsed).toBe(true);
  });

  it("validates Anthropic against its versioned models endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LlmService();

    await expect(service.validate(anthropicProvider("https://api.anthropic.test"))).resolves.toMatchObject({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.anthropic.test/v1/models");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
      "x-api-key": "test-key"
    });
  });

  it("rejects unknown successful cleanup schemas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "upstream failed" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const service = new LlmService();

    await expect(service.process({ provider: openAiProvider("https://provider.invalid/v1"), prompt: "clean this" })).rejects.toThrow(
      "incomplete or invalid success response"
    );
  });

  it("rejects Anthropic max-token truncation so callers can use the raw transcript", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "partial cleanup" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LlmService();
    const prompt = "word ".repeat(4000);

    await expect(
      service.process({ provider: anthropicProvider("https://provider.invalid"), prompt })
    ).rejects.toThrow("stop reason max_tokens");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { max_tokens: number };
    expect(requestBody.max_tokens).toBeGreaterThan(2048);
  });

  it("sanitizes provider error bodies that echo sensitive prompt content", async () => {
    const secretMarker = "TRANSCRIPT_AND_CONTEXT_SECRET";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(`gateway echoed ${secretMarker}`, {
          status: 429,
          headers: { "x-request-id": "req_safe-123" }
        })
      )
    );
    const service = new LlmService();

    const request = service.process({ provider: openAiProvider("https://provider.invalid/v1"), prompt: secretMarker });

    await expect(request).rejects.toThrow("LLM failed with HTTP 429 (request ID req_safe-123).");
    await expect(request).rejects.not.toThrow(secretMarker);
  });

  it("rejects provider response bodies above the configured byte ceiling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x".repeat(providerSuccessBodyMaxBytes + 1), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const service = new LlmService();

    await expect(service.process({ provider: openAiProvider("https://provider.invalid/v1"), prompt: "clean this" })).rejects.toThrow(
      `exceeded ${providerSuccessBodyMaxBytes} bytes`
    );
  });

  it("dispatches Codex cleanup and validation through the OAuth client", async () => {
    const processCleanup = vi.fn().mockResolvedValue({ text: "Clean this.", providerId: "codex", model: "gpt-5.6-luna" });
    const refreshStatus = vi.fn().mockResolvedValue({
      status: "connected",
      message: "Connected to Codex.",
      modelAvailable: true
    });
    const service = new LlmService({
      getStatus: () => ({ status: "connected", message: "Connected to Codex.", modelAvailable: true }),
      refreshStatus,
      processCleanup
    });
    const provider: LlmProviderConfig = {
      id: "codex",
      type: "codex",
      name: "Codex",
      isCloud: true,
      defaultModel: "gpt-5.6-luna",
      enabled: true
    };

    await expect(service.process({ provider, prompt: "clean this" })).resolves.toEqual({
      text: "Clean this.",
      providerId: "codex",
      model: "gpt-5.6-luna"
    });
    await expect(service.validate(provider)).resolves.toEqual({ ok: true, message: "Connected to Codex." });
    expect(processCleanup).toHaveBeenCalledWith({ prompt: "clean this", model: "gpt-5.6-luna" });
    expect(refreshStatus).toHaveBeenCalledOnce();
  });
});

function openAiProvider(baseUrl: string): LlmProviderConfig {
  return {
    id: "openai-test",
    type: "openai",
    name: "OpenAI test",
    baseUrl,
    apiKey: "test-key",
    isCloud: true,
    defaultModel: "test-model",
    enabled: true
  };
}

function anthropicProvider(baseUrl: string): LlmProviderConfig {
  return {
    id: "anthropic-test",
    type: "anthropic",
    name: "Anthropic test",
    baseUrl,
    apiKey: "test-key",
    isCloud: true,
    defaultModel: "claude-sonnet-4-6",
    enabled: true
  };
}

function ollamaProvider(baseUrl: string): LlmProviderConfig {
  return {
    id: "ollama",
    type: "ollama",
    name: "Ollama",
    baseUrl,
    isCloud: false,
    defaultModel: "llama3.1",
    enabled: true
  };
}

function restoreTimeoutEnv(): void {
  restoreEnvValue("MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS", originalTotalTimeout);
  restoreEnvValue("MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS", originalIdleTimeout);
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function startServer(handler: (response: ServerResponse) => void): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => handler(response));
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port."));
        return;
      }
      servers.push(() => closeServer(server, sockets));
      resolve({ url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
