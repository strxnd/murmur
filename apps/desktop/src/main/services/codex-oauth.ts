import { homedir } from "node:os";
import { join } from "node:path";
import { codexModel } from "../../shared/codex-provider";
import type { CodexProviderRuntime, ProcessedResult } from "../../shared/types";
import { ProviderSecretStore, type ProviderSecretCodec } from "./provider-secrets";
const codexClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const codexIssuer = "https://auth.openai.com";
const codexTokenUrl = `${codexIssuer}/oauth/token`;
const codexDeviceUrl = `${codexIssuer}/codex/device`;
const defaultCodexBaseUrl = "https://chatgpt.com/backend-api/codex";
const defaultCodexCompatibilityVersion = "0.144.0";
const authRecordId = "codex-oauth";
const defaultAuthTimeoutMs = 15000;
const defaultLoginTimeoutMs = 15 * 60 * 1000;
const defaultResponseTimeoutMs = 120000;
const defaultResponseIdleTimeoutMs = 30000;
const tokenRefreshSkewMs = 2 * 60 * 1000;

interface JsonObject {
  [key: string]: unknown;
}

interface CodexTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  expiresAt?: number;
}

interface CodexAuthStore {
  get(): CodexTokens | undefined;
  set(tokens: CodexTokens): void;
  delete(): void;
}

type StatusListener = (status: CodexProviderRuntime) => void;

export interface CodexOAuthServiceOptions {
  authPath?: string;
  authStore?: CodexAuthStore;
  secretCodec?: ProviderSecretCodec;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<unknown>;
  onStatusChange?: StatusListener;
  authTimeoutMs?: number;
  loginTimeoutMs?: number;
  minimumPollIntervalMs?: number;
  responseTimeoutMs?: number;
  responseIdleTimeoutMs?: number;
  appVersion?: string;
  codexCompatibilityVersion?: string;
}

export class CodexOAuthService {
  private readonly authStore: CodexAuthStore;
  private readonly fetchImpl: typeof fetch;
  private readonly openExternal?: (url: string) => Promise<unknown>;
  private readonly baseUrl: string;
  private readonly authTimeoutMs: number;
  private readonly loginTimeoutMs: number;
  private readonly minimumPollIntervalMs: number;
  private readonly responseTimeoutMs: number;
  private readonly responseIdleTimeoutMs: number;
  private readonly appVersion: string;
  private readonly codexCompatibilityVersion: string;
  private onStatusChange?: StatusListener;
  private loginController?: AbortController;
  private loginPromise?: Promise<CodexProviderRuntime>;
  private logoutPromise?: Promise<CodexProviderRuntime>;
  private turnQueue: Promise<void> = Promise.resolve();
  private readonly operationControllers = new Set<AbortController>();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private authGeneration = 0;
  private disposed = false;
  private status: CodexProviderRuntime = {
    status: "checking",
    message: "Checking Codex connection...",
    modelAvailable: false
  };

  constructor(options: CodexOAuthServiceOptions = {}) {
    this.authStore =
      options.authStore ??
      new EncryptedCodexAuthStore(
        options.authPath ?? join(homedir(), ".config", "murmur", "murmur-codex-auth.json"),
        options.secretCodec
      );
    this.fetchImpl = options.fetch ?? fetch;
    this.openExternal = options.openExternal;
    this.onStatusChange = options.onStatusChange;
    this.baseUrl = (options.env ?? process.env).MURMUR_CODEX_BASE_URL?.trim().replace(/\/$/, "") || defaultCodexBaseUrl;
    this.authTimeoutMs = options.authTimeoutMs ?? defaultAuthTimeoutMs;
    this.loginTimeoutMs = options.loginTimeoutMs ?? defaultLoginTimeoutMs;
    this.minimumPollIntervalMs = options.minimumPollIntervalMs ?? 3000;
    this.responseTimeoutMs = options.responseTimeoutMs ?? defaultResponseTimeoutMs;
    this.responseIdleTimeoutMs = options.responseIdleTimeoutMs ?? defaultResponseIdleTimeoutMs;
    this.appVersion = options.appVersion?.trim() || "0.1.0";
    this.codexCompatibilityVersion = options.codexCompatibilityVersion?.trim() || defaultCodexCompatibilityVersion;
  }

  getStatus(): CodexProviderRuntime {
    return { ...this.status };
  }

  setStatusListener(listener: StatusListener | undefined): void {
    this.onStatusChange = listener;
  }

  async refreshStatus(): Promise<CodexProviderRuntime> {
    if (this.logoutPromise) {
      await this.logoutPromise;
      return this.getStatus();
    }
    if (this.disposed || this.loginPromise) return this.getStatus();
    const generation = this.authGeneration;
    const controller = new AbortController();
    this.operationControllers.add(controller);
    this.updateStatusForGeneration(generation, { status: "checking", message: "Checking Codex connection...", modelAvailable: false });

    const operation = (async () => {
      const stored = this.authStore.get();
      if (!stored) return this.setSignedOutForGeneration(generation);

      try {
        const tokens = await this.ensureFreshTokens(stored, controller.signal, generation);
        const modelAvailable = await this.validateModelAvailability(tokens, controller.signal, generation);
        this.assertAuthGeneration(generation);
        return this.setConnected(tokens, modelAvailable, generation);
      } catch (error) {
        if (!this.isAuthGenerationCurrent(generation)) return this.getStatus();
        if (this.handleTerminalAuthError(error, generation)) return this.getStatus();
        if (controller.signal.aborted) return this.getStatus();
        this.updateStatusForGeneration(generation, {
          status: "error",
          message: `Codex connection failed: ${errorMessage(error)}`,
          modelAvailable: false
        });
        return this.getStatus();
      }
    })().finally(() => this.operationControllers.delete(controller));
    return this.trackOperation(operation);
  }

  startLogin(): Promise<CodexProviderRuntime> {
    if (this.logoutPromise) return Promise.reject(new Error("Codex logout is in progress."));
    if (this.disposed) return Promise.reject(new Error("Codex service is disposed."));
    if (this.loginPromise) return this.loginPromise;

    const generation = this.authGeneration;
    const controller = new AbortController();
    this.loginController = controller;
    this.operationControllers.add(controller);
    const operation = this.runLogin(controller.signal, generation)
      .catch((error) => {
        if (!this.isAuthGenerationCurrent(generation)) return this.getStatus();
        if (controller.signal.aborted) {
          this.authStore.delete();
          return this.setSignedOutForGeneration(generation, "Codex sign-in cancelled.");
        }
        this.updateStatusForGeneration(generation, { status: "error", message: errorMessage(error), modelAvailable: false });
        return this.getStatus();
      })
      .finally(() => {
        this.operationControllers.delete(controller);
        if (this.loginController === controller) this.loginController = undefined;
        this.loginPromise = undefined;
      });
    this.loginPromise = this.trackOperation(operation);
    return this.loginPromise;
  }

  async cancelLogin(): Promise<CodexProviderRuntime> {
    const login = this.loginPromise;
    this.loginController?.abort();
    if (login) await login;
    return this.getStatus();
  }

  logout(): Promise<CodexProviderRuntime> {
    if (this.logoutPromise) return this.logoutPromise;
    const operation = this.runLogout();
    this.logoutPromise = operation.finally(() => {
      this.logoutPromise = undefined;
    });
    return this.logoutPromise;
  }

  processCleanup(options: { prompt: string; model: string; signal?: AbortSignal }): Promise<ProcessedResult> {
    if (this.logoutPromise) return Promise.reject(new Error("Codex logout is in progress."));
    const generation = this.authGeneration;
    const run = this.turnQueue.then(() => {
      this.assertAuthGeneration(generation);
      throwIfAborted(options.signal);
      return this.trackOperation(this.runCleanup(options, generation));
    });
    this.turnQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    const pendingQueue = this.turnQueue;
    this.disposed = true;
    this.authGeneration += 1;
    this.abortAuthenticationOperations();
    await Promise.allSettled([...this.activeOperations, pendingQueue]);
  }

  private async runLogout(): Promise<CodexProviderRuntime> {
    const pendingQueue = this.turnQueue;
    this.authGeneration += 1;
    this.abortAuthenticationOperations();
    await Promise.allSettled([...this.activeOperations, pendingQueue]);
    this.authStore.delete();
    return this.setSignedOut();
  }

  private async runLogin(signal: AbortSignal, generation: number): Promise<CodexProviderRuntime> {
    this.updateStatusForGeneration(generation, {
      status: "signing_in",
      message: "Requesting a Codex sign-in code...",
      modelAvailable: false
    });
    const deviceData = await this.requestJson(
      `${codexIssuer}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: codexClientId })
      },
      "Codex device-code request",
      signal
    );
    this.assertAuthGeneration(generation);
    const userCode = nonEmptyString(deviceData.user_code);
    const deviceAuthId = nonEmptyString(deviceData.device_auth_id);
    if (!userCode || !deviceAuthId) throw new Error("OpenAI returned an incomplete Codex sign-in response.");

    this.updateStatusForGeneration(generation, {
      status: "signing_in",
      message: `Enter code ${userCode} in the browser to connect Codex.`,
      modelAvailable: false
    });
    if (this.openExternal) {
      try {
        await this.openExternal(codexDeviceUrl);
      } catch {
        this.updateStatusForGeneration(generation, {
          status: "signing_in",
          message: `Open ${codexDeviceUrl} and enter code ${userCode} to connect Codex.`,
          modelAvailable: false
        });
      }
    } else {
      this.updateStatusForGeneration(generation, {
        status: "signing_in",
        message: `Open ${codexDeviceUrl} and enter code ${userCode} to connect Codex.`,
        modelAvailable: false
      });
    }
    throwIfAborted(signal);

    const authorization = await this.pollForAuthorization(
      deviceAuthId,
      userCode,
      Math.max(this.minimumPollIntervalMs, numberValue(deviceData.interval, 5) * 1000),
      signal
    );
    const authorizationCode = nonEmptyString(authorization.authorization_code);
    const codeVerifier = nonEmptyString(authorization.code_verifier);
    if (!authorizationCode || !codeVerifier) throw new Error("OpenAI returned an incomplete Codex authorization response.");

    const tokenData = await this.requestJson(
      codexTokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authorizationCode,
          redirect_uri: `${codexIssuer}/deviceauth/callback`,
          client_id: codexClientId,
          code_verifier: codeVerifier
        })
      },
      "Codex token exchange",
      signal
    );
    this.assertAuthGeneration(generation);
    const tokens = tokensFromResponse(tokenData);
    const modelAvailable = await this.validateModelAvailability(tokens, signal, generation);
    throwIfAborted(signal);
    this.assertAuthGeneration(generation);
    this.authStore.set(tokens);
    return this.setConnected(tokens, modelAvailable, generation);
  }

  private async pollForAuthorization(
    deviceAuthId: string,
    userCode: string,
    intervalMs: number,
    signal: AbortSignal
  ): Promise<JsonObject> {
    const deadline = Date.now() + this.loginTimeoutMs;
    while (Date.now() < deadline) {
      await abortableDelay(intervalMs, signal);
      const authorization = await this.withRequestTimeout(this.authTimeoutMs, signal, async (requestSignal) => {
        const response = await this.fetchImpl(`${codexIssuer}/api/accounts/deviceauth/token`, {
          method: "POST",
          signal: requestSignal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode })
        });
        if (response.status === 403 || response.status === 404) {
          await response.body?.cancel();
          return undefined;
        }
        return requireJsonResponse(response, "Codex sign-in polling", requestSignal);
      });
      if (authorization) return authorization;
    }
    throw new Error("Codex sign-in timed out. Start the connection again.");
  }

  private async runCleanup(
    options: { prompt: string; model: string; signal?: AbortSignal },
    generation: number
  ): Promise<ProcessedResult> {
    if (options.model !== codexModel) throw new Error(`Codex only supports ${codexModel} in Murmur.`);
    const controller = new AbortController();
    this.operationControllers.add(controller);
    let timedOut = false;
    const onAbort = (): void => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.responseTimeoutMs);
    try {
      this.assertAuthGeneration(generation);
      let tokens = await this.requireTokens(controller.signal, generation);
      this.assertAuthGeneration(generation);
      let response = await this.requestCleanup(options.prompt, tokens, controller.signal);
      this.assertAuthGeneration(generation);

      if (response.status === 401) {
        await response.body?.cancel();
        this.assertAuthGeneration(generation);
        tokens = await this.refreshTokens(tokens, controller.signal, generation);
        this.assertAuthGeneration(generation);
        response = await this.requestCleanup(options.prompt, tokens, controller.signal);
        this.assertAuthGeneration(generation);
        if (response.status === 401) {
          await response.body?.cancel();
          throw new CodexAuthError("Codex rejected the refreshed session.", true);
        }
      }
      if (!response.ok) throw await codexHttpError(response);

      const text = (await readCodexText(response, this.responseIdleTimeoutMs)).trim();
      this.assertAuthGeneration(generation);
      if (!text) throw new Error("Codex completed without final text.");
      return { text, providerId: "codex", model: codexModel };
    } catch (error) {
      if (this.handleTerminalAuthError(error, generation)) throw error;
      if (options.signal?.aborted) throw abortError();
      if (timedOut) throw new Error("Codex request timed out.");
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      controller.abort();
      this.operationControllers.delete(controller);
    }
  }

  private async requireTokens(signal: AbortSignal | undefined, generation: number): Promise<CodexTokens> {
    const stored = this.authStore.get();
    if (!stored) throw new Error("Sign in to Codex with your ChatGPT subscription.");
    try {
      const tokens = await this.ensureFreshTokens(stored, signal, generation);
      this.assertAuthGeneration(generation);
      const accountId = accountIdFromTokens(tokens);
      if (!accountId) throw new Error("Codex did not provide a ChatGPT account ID. Sign in again.");
      return { ...tokens, accountId };
    } catch (error) {
      this.handleTerminalAuthError(error, generation);
      throw error;
    }
  }

  private requestCleanup(prompt: string, tokens: CodexTokens, signal: AbortSignal): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "ChatGPT-Account-ID": tokens.accountId ?? accountIdFromTokens(tokens) ?? "",
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "OpenAI-Beta": "responses=experimental",
        originator: "murmur",
        "User-Agent": `murmur/${this.appVersion}`
      },
      body: JSON.stringify({
        model: codexModel,
        instructions:
          "You are a text transformation engine for dictation. Work only from the supplied text. Return only the transformed text requested by the user, with no commentary. Do not call tools or use external context.",
        input: [{ role: "user", content: prompt }],
        tools: [],
        store: false,
        stream: true
      })
    });
  }

  private ensureFreshTokens(tokens: CodexTokens, signal: AbortSignal | undefined, generation: number): Promise<CodexTokens> {
    const expiresAt = tokens.expiresAt ?? jwtExpiration(tokens.accessToken);
    if (!expiresAt || expiresAt - Date.now() > tokenRefreshSkewMs) return Promise.resolve(tokens);
    return this.refreshTokens(tokens, signal, generation);
  }

  private async refreshTokens(tokens: CodexTokens, signal: AbortSignal | undefined, generation: number): Promise<CodexTokens> {
    if (!tokens.refreshToken) throw new CodexAuthError("Codex refresh token is missing.", true);
    const refreshed = await this.withRequestTimeout(this.authTimeoutMs, signal, async (requestSignal) => {
      const response = await this.fetchImpl(codexTokenUrl, {
        method: "POST",
        signal: requestSignal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": `murmur/${this.appVersion}`
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: codexClientId
        })
      });
      if (!response.ok) {
        await response.body?.cancel();
        const terminal = response.status >= 400 && response.status < 500 && response.status !== 429;
        throw new CodexAuthError(`Codex token refresh failed with HTTP ${response.status}.`, terminal);
      }
      return tokensFromResponse(await requireJsonResponse(response, "Codex token refresh", requestSignal), tokens);
    });
    throwIfAborted(signal);
    this.assertAuthGeneration(generation);
    this.authStore.set(refreshed);
    return refreshed;
  }

  private requestJson(url: string, init: RequestInit, label: string, signal?: AbortSignal): Promise<JsonObject> {
    return this.withRequestTimeout(this.authTimeoutMs, signal, async (requestSignal) => {
      const response = await this.fetchImpl(url, { ...init, signal: requestSignal });
      return requireJsonResponse(response, label, requestSignal);
    });
  }

  private async validateModelAvailability(
    tokens: CodexTokens,
    signal: AbortSignal | undefined,
    generation: number
  ): Promise<boolean> {
    const accountId = accountIdFromTokens(tokens);
    if (!accountId) return false;

    this.assertAuthGeneration(generation);
    const separator = this.baseUrl.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}/models${separator}client_version=${encodeURIComponent(this.codexCompatibilityVersion)}`;
    const modelAvailable = await this.withRequestTimeout(this.authTimeoutMs, signal, async (requestSignal) => {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: requestSignal,
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "ChatGPT-Account-ID": accountId,
          Accept: "application/json",
          originator: "murmur",
          "User-Agent": `murmur/${this.appVersion}`
        }
      });
      if (response.status === 401) {
        await response.body?.cancel();
        throw new CodexAuthError("Codex rejected the stored session.", true);
      }
      if (response.status === 403) {
        await response.body?.cancel();
        return false;
      }

      const data = await requireJsonResponse(response, "Codex model discovery", requestSignal);
      return (Array.isArray(data.models) ? data.models : []).some((value) => nonEmptyString(asObject(value)?.slug) === codexModel);
    });
    this.assertAuthGeneration(generation);
    return modelAvailable;
  }

  private async withRequestTimeout<T>(
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      throwIfAborted(controller.signal);
      return await operation(controller.signal);
    } catch (error) {
      if (externalSignal?.aborted) throw abortError();
      if (timedOut) throw new Error("Codex authentication request timed out.");
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  private setConnected(tokens: CodexTokens, modelAvailable: boolean, generation: number): CodexProviderRuntime {
    const claims = mergedClaims(tokens);
    const accountId = tokens.accountId ?? stringClaim(claims, "chatgpt_account_id");
    const email = stringClaim(claims, "email");
    const plan = stringClaim(claims, "chatgpt_plan_type");
    this.updateStatusForGeneration(generation, {
      status: "connected",
      message: modelAvailable
        ? "Connected to Codex with ChatGPT OAuth."
        : accountId
          ? `Codex did not return ${codexModel} during model discovery. Refresh or reconnect and try again.`
          : "Codex is connected, but the account ID is unavailable.",
      modelAvailable,
      accountLabel: email ?? (plan ? `ChatGPT ${capitalize(plan)}` : undefined)
    });
    return this.getStatus();
  }

  private handleTerminalAuthError(error: unknown, generation: number): boolean {
    if (!isTerminalAuthError(error) || !this.isAuthGenerationCurrent(generation)) return false;
    this.authStore.delete();
    this.setSignedOutForGeneration(generation, "Your Codex session expired. Sign in again.");
    return true;
  }

  private setSignedOutForGeneration(
    generation: number,
    message = "Sign in to Codex with your ChatGPT subscription."
  ): CodexProviderRuntime {
    this.updateStatusForGeneration(generation, { status: "signed_out", message, modelAvailable: false });
    return this.getStatus();
  }

  private setSignedOut(message = "Sign in to Codex with your ChatGPT subscription."): CodexProviderRuntime {
    this.updateStatus({ status: "signed_out", message, modelAvailable: false });
    return this.getStatus();
  }

  private updateStatusForGeneration(generation: number, status: CodexProviderRuntime): void {
    if (this.isAuthGenerationCurrent(generation)) this.updateStatus(status);
  }

  private isAuthGenerationCurrent(generation: number): boolean {
    return !this.disposed && generation === this.authGeneration;
  }

  private assertAuthGeneration(generation: number): void {
    if (!this.isAuthGenerationCurrent(generation)) throw abortError();
  }

  private abortAuthenticationOperations(): void {
    this.loginController = undefined;
    for (const controller of this.operationControllers) controller.abort();
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.activeOperations.add(operation);
    void operation.then(
      () => this.activeOperations.delete(operation),
      () => this.activeOperations.delete(operation)
    );
    return operation;
  }

  private updateStatus(status: CodexProviderRuntime): void {
    this.status = status;
    this.onStatusChange?.(this.getStatus());
  }
}

class EncryptedCodexAuthStore implements CodexAuthStore {
  private readonly store: ProviderSecretStore;

  constructor(path: string, codec?: ProviderSecretCodec) {
    this.store = new ProviderSecretStore(path, codec);
  }

  get(): CodexTokens | undefined {
    const value = this.store.get(authRecordId);
    if (!value) return undefined;
    try {
      const tokens = JSON.parse(value) as Partial<CodexTokens>;
      if (!tokens.accessToken || !tokens.refreshToken) return undefined;
      return tokens as CodexTokens;
    } catch {
      return undefined;
    }
  }

  set(tokens: CodexTokens): void {
    this.store.set(authRecordId, JSON.stringify(tokens));
  }

  delete(): void {
    this.store.delete(authRecordId);
  }
}

class CodexAuthError extends Error {
  constructor(message: string, readonly terminal: boolean) {
    super(message);
  }
}

async function requireJsonResponse(response: Response, label: string, signal?: AbortSignal): Promise<JsonObject> {
  const text = await readResponseText(response, signal);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}${text ? `: ${bounded(text)}` : "."}`);
  const object = asObject(data);
  if (!object) throw new Error(`${label} returned invalid JSON.`);
  return object;
}

async function readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (true) {
      const chunk = await readWithAbort(reader, signal);
      text += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) return text;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function tokensFromResponse(data: JsonObject, previous?: CodexTokens): CodexTokens {
  const accessToken = nonEmptyString(data.access_token);
  const refreshToken = nonEmptyString(data.refresh_token) ?? previous?.refreshToken;
  const idToken = nonEmptyString(data.id_token) ?? previous?.idToken;
  if (!accessToken || !refreshToken) throw new Error("OpenAI did not return complete Codex credentials.");
  const expiresIn = numberValue(data.expires_in, 0);
  const next: CodexTokens = {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : jwtExpiration(accessToken),
    accountId: previous?.accountId
  };
  next.accountId = accountIdFromTokens(next) ?? previous?.accountId;
  return next;
}

async function readCodexText(response: Response, idleTimeoutMs: number): Promise<string> {
  const body = await readCodexBody(response, idleTimeoutMs);
  const data = parseObject(body);
  if (data) return extractResponseText(data);
  return extractCodexEventStreamText(body);
}

async function readCodexBody(response: Response, idleTimeoutMs: number): Promise<string> {
  if (!response.body) throw new Error("Codex returned an empty response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";

  try {
    while (true) {
      const chunk = await readWithIdleTimeout(reader, idleTimeoutMs);
      body += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) return body;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function extractCodexEventStreamText(body: string): string {
  let deltaText = "";
  let itemText = "";
  let completedText = "";
  let completed = false;

  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;

    const event = parseObject(data);
    const type = nonEmptyString(event?.type);
    if (type === "response.output_text.delta") deltaText += stringValue(event?.delta) ?? "";
    if (type === "response.output_text.done") completedText = stringValue(event?.text) ?? completedText;
    if (type === "response.output_item.done") itemText += extractItemText(asObject(event?.item));
    if (type === "response.completed") {
      completed = true;
      completedText = extractResponseText(asObject(event?.response)) || completedText;
    }
    if (type === "response.incomplete") {
      throw new Error(eventError(event) ?? "Codex response was incomplete.");
    }
    if (type === "response.failed" || type === "error") {
      throw new Error(eventError(event) ?? "Codex response failed.");
    }
  }
  if (!completed) throw new Error("Codex response ended before completion.");
  return completedText || itemText || deltaText;
}

function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Codex response stopped streaming.")), timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function extractResponseText(response: JsonObject | undefined): string {
  if (!response) return "";
  const direct = stringValue(response.output_text);
  if (direct) return direct;
  return (Array.isArray(response.output) ? response.output : [])
    .map((item) => extractItemText(asObject(item)))
    .join("");
}

function extractItemText(item: JsonObject | undefined): string {
  if (!item || item.type !== "message") return "";
  return (Array.isArray(item.content) ? item.content : [])
    .map((part) => {
      const content = asObject(part);
      return content?.type === "output_text" ? stringValue(content.text) ?? "" : "";
    })
    .join("");
}

function mergedClaims(tokens: CodexTokens): JsonObject {
  const access = decodeJwt(tokens.accessToken);
  const identity = decodeJwt(tokens.idToken);
  const accessAuth = asObject(access["https://api.openai.com/auth"]) ?? {};
  const identityAuth = asObject(identity["https://api.openai.com/auth"]) ?? {};
  return { ...access, ...identity, ...accessAuth, ...identityAuth };
}

function accountIdFromTokens(tokens: CodexTokens): string | undefined {
  return tokens.accountId ?? stringClaim(mergedClaims(tokens), "chatgpt_account_id");
}

function jwtExpiration(token: string | undefined): number | undefined {
  const exp = decodeJwt(token).exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}

function decodeJwt(token: string | undefined): JsonObject {
  const payload = token?.split(".")[1];
  if (!payload) return {};
  try {
    return asObject(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))) ?? {};
  } catch {
    return {};
  }
}

function stringClaim(claims: JsonObject, key: string): string | undefined {
  return nonEmptyString(claims[key]);
}

function parseObject(value: string): JsonObject | undefined {
  try {
    return asObject(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function codexHttpError(response: Response): Promise<Error> {
  const text = bounded(await response.text());
  if (response.status === 429) return new Error(`Codex usage limit reached${text ? `: ${text}` : "."}`);
  return new Error(`Codex failed with HTTP ${response.status}${text ? `: ${text}` : "."}`);
}

function eventError(event: JsonObject | undefined): string | undefined {
  const error = asObject(event?.error) ?? asObject(asObject(event?.response)?.error);
  return nonEmptyString(error?.message) ?? nonEmptyString(event?.message);
}

function isTerminalAuthError(error: unknown): boolean {
  return error instanceof CodexAuthError && error.terminal;
}

function bounded(value: string): string {
  return value.trim().slice(0, 1000);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
