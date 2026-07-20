import { describe, expect, it, vi } from "vitest";
import { CodexOAuthService } from "./codex-oauth";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  expiresAt?: number;
}

class MemoryAuthStore {
  tokens?: StoredTokens;

  get(): StoredTokens | undefined {
    return this.tokens ? { ...this.tokens } : undefined;
  }

  set(tokens: StoredTokens): void {
    this.tokens = { ...tokens };
  }

  delete(): void {
    this.tokens = undefined;
  }
}

describe("CodexOAuthService", () => {
  it("uses Codex compatibility for discovery before sending Luna cleanup requests", async () => {
    const store = new MemoryAuthStore();
    const token = accountToken({ email: "user@example.com", chatgpt_plan_type: "plus" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ user_code: "ABCD-EFGH", device_auth_id: "device-1", interval: 0 }))
      .mockResolvedValueOnce(jsonResponse({ authorization_code: "code-1", code_verifier: "verifier-1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: token, refresh_token: "refresh-1", id_token: token, expires_in: 3600 }))
      .mockImplementationOnce(async (input) =>
        modelResponse(String(input).endsWith("client_version=0.144.0") ? ["gpt-5.6-luna"] : [])
      )
      .mockResolvedValueOnce(
        eventStream([
          { type: "response.output_text.delta", delta: "Clean this." },
          { type: "response.completed", response: { output: null } }
        ])
      );
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const service = new CodexOAuthService({
      authStore: store,
      fetch: fetchMock,
      openExternal,
      minimumPollIntervalMs: 0,
      appVersion: "0.1.0"
    });

    await expect(service.startLogin()).resolves.toMatchObject({
      status: "connected",
      modelAvailable: true,
      accountLabel: "user@example.com"
    });
    expect(openExternal).toHaveBeenCalledWith("https://auth.openai.com/codex/device");
    expect(store.tokens).toMatchObject({ refreshToken: "refresh-1", accountId: "account-1" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://chatgpt.com/backend-api/codex/models?client_version=0.144.0",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
          "ChatGPT-Account-ID": "account-1",
          "User-Agent": "murmur/0.1.0"
        })
      })
    );

    await expect(service.processCleanup({ prompt: "cleanup", model: "gpt-5.6-luna" })).resolves.toEqual({
      text: "Clean this.",
      providerId: "codex",
      model: "gpt-5.6-luna"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "ChatGPT-Account-ID": "account-1",
          "User-Agent": "murmur/0.1.0"
        })
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toMatchObject({ model: "gpt-5.6-luna" });
  });

  it("reports a connected account as unavailable when Luna is missing", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(modelResponse(["another-model"]));
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.refreshStatus()).resolves.toMatchObject({
      status: "connected",
      modelAvailable: false,
      message: "Codex did not return gpt-5.6-luna during model discovery. Refresh or reconnect and try again."
    });
  });

  it("reports denied model discovery without marking the account ready", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.refreshStatus()).resolves.toMatchObject({
      status: "connected",
      modelAvailable: false,
      message: "Codex did not return gpt-5.6-luna during model discovery. Refresh or reconnect and try again."
    });
    expect(store.tokens).toBeDefined();
  });

  it("clears revoked credentials when model discovery returns 401", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.refreshStatus()).resolves.toMatchObject({ status: "signed_out", modelAvailable: false });
    expect(store.tokens).toBeUndefined();
  });

  it("exposes the verification URL when the browser cannot be opened", async () => {
    const store = new MemoryAuthStore();
    const token = accountToken();
    const statuses: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ user_code: "ABCD-EFGH", device_auth_id: "device-1", interval: 0 }))
      .mockResolvedValueOnce(jsonResponse({ authorization_code: "code-1", code_verifier: "verifier-1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: token, refresh_token: "refresh-1", expires_in: 3600 }))
      .mockResolvedValueOnce(modelResponse(["gpt-5.6-luna"]));
    const service = new CodexOAuthService({
      authStore: store,
      fetch: fetchMock,
      openExternal: vi.fn().mockRejectedValue(new Error("no browser")),
      minimumPollIntervalMs: 0,
      onStatusChange: (status) => statuses.push(status.message)
    });

    await expect(service.startLogin()).resolves.toMatchObject({ status: "connected" });
    expect(statuses).toContain("Open https://auth.openai.com/codex/device and enter code ABCD-EFGH to connect Codex.");
  });

  it("cancels sign-in after an already-started browser launch without polling or storing credentials", async () => {
    const store = new MemoryAuthStore();
    const browser = deferred<void>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ user_code: "ABCD-EFGH", device_auth_id: "device-1", interval: 0 }));
    const openExternal = vi.fn(() => browser.promise);
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock, openExternal, minimumPollIntervalMs: 0 });

    const login = service.startLogin();
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());
    const cancellation = service.cancelLogin();
    browser.resolve();

    await expect(cancellation).resolves.toMatchObject({ status: "signed_out" });
    await expect(login).resolves.toMatchObject({ status: "signed_out" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(store.tokens).toBeUndefined();
  });

  it("cancels a pending token response body without persisting credentials", async () => {
    const store = new MemoryAuthStore();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ user_code: "ABCD-EFGH", device_auth_id: "device-1", interval: 0 }))
      .mockResolvedValueOnce(jsonResponse({ authorization_code: "code-1", code_verifier: "verifier-1" }))
      .mockResolvedValueOnce(stalledResponse());
    const service = new CodexOAuthService({
      authStore: store,
      fetch: fetchMock,
      openExternal: vi.fn().mockResolvedValue(undefined),
      minimumPollIntervalMs: 0
    });

    const login = service.startLogin();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await expect(service.cancelLogin()).resolves.toMatchObject({ status: "signed_out" });
    await expect(login).resolves.toMatchObject({ status: "signed_out" });
    expect(store.tokens).toBeUndefined();
  });

  it("keeps authentication timeouts active while reading the response body", async () => {
    const store = new MemoryAuthStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(stalledResponse());
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock, authTimeoutMs: 10 });

    await expect(service.startLogin()).resolves.toMatchObject({
      status: "error",
      message: "Codex authentication request timed out."
    });
    expect(store.tokens).toBeUndefined();
  });

  it("clears credentials and runtime state after a terminal cleanup refresh failure", async () => {
    const store = connectedStore();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.processCleanup({ prompt: "cleanup", model: "gpt-5.6-luna" })).rejects.toThrow(
      "Codex token refresh failed with HTTP 400."
    );
    expect(store.tokens).toBeUndefined();
    expect(service.getStatus()).toMatchObject({ status: "signed_out", modelAvailable: false });
  });

  it("sends direct Codex Responses requests and reads completed streamed output", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      eventStream([
        { type: "response.output_text.delta", delta: "Clean " },
        { type: "response.output_text.delta", delta: "this." },
        { type: "response.completed", response: { output: null } }
      ])
    );
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.processCleanup({ prompt: "cleanup", model: "gpt-5.6-luna" })).resolves.toEqual({
      text: "Clean this.",
      providerId: "codex",
      model: "gpt-5.6-luna"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
          "ChatGPT-Account-ID": "account-1"
        })
      })
    );
  });

  it("reads Codex event streams even when the response content type is incorrect", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      eventStream(
        [
          { type: "response.output_text.delta", delta: "Clean this." },
          { type: "response.completed", response: { output: null } }
        ],
        { contentType: "application/json", includeEventNames: true }
      )
    );
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.processCleanup({ prompt: "cleanup", model: "gpt-5.6-luna" })).resolves.toEqual({
      text: "Clean this.",
      providerId: "codex",
      model: "gpt-5.6-luna"
    });
  });

  it("rejects accumulated deltas when Codex reports an incomplete response", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      eventStream([
        { type: "response.output_text.delta", delta: "Partial text" },
        { type: "response.incomplete", response: { error: { message: "Output limit reached." } } }
      ])
    );
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.processCleanup({ prompt: "cleanup", model: "gpt-5.6-luna" })).rejects.toThrow("Output limit reached.");
  });

  it("rejects a stream that ends without a completion event", async () => {
    const store = connectedStore();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(eventStream([{ type: "response.output_text.delta", delta: "Partial text" }]));
    const service = new CodexOAuthService({ authStore: store, fetch: fetchMock });

    await expect(service.processCleanup({ prompt: "cleanup", model: "gpt-5.6-luna" })).rejects.toThrow(
      "Codex response ended before completion."
    );
  });
});

function connectedStore(): MemoryAuthStore {
  const store = new MemoryAuthStore();
  store.tokens = {
    accessToken: accountToken(),
    refreshToken: "refresh-1",
    accountId: "account-1"
  };
  return store;
}

function accountToken(extraAuth: Record<string, unknown> = {}): string {
  return jwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    "https://api.openai.com/auth": { chatgpt_account_id: "account-1", ...extraAuth }
  });
}

function modelResponse(slugs: string[]): Response {
  return jsonResponse({ models: slugs.map((slug) => ({ slug, display_name: slug })) });
}

function eventStream(
  events: Array<Record<string, unknown>>,
  options: { contentType?: string; includeEventNames?: boolean } = {}
): Response {
  return new Response(
    events
      .map((event) => {
        const eventName = options.includeEventNames ? `event: ${String(event.type)}\n` : "";
        return `${eventName}data: ${JSON.stringify(event)}\n\n`;
      })
      .join(""),
    {
      status: 200,
      headers: { "Content-Type": options.contentType ?? "text/event-stream" }
    }
  );
}

function stalledResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        // Leave the body open until the request is cancelled or times out.
      }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function jwt(payload: Record<string, unknown>): string {
  return `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
