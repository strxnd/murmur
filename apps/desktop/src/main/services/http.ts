export interface ResponseBodyReadOptions {
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
  label?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}

interface ResponseDeadline {
  deadlineAt: number;
  timeoutMs: number;
  controller: AbortController;
  timedOut: boolean;
  cleanup: () => void;
}

const defaultBodyTimeoutMs = 15000;
const responseDeadlines = new WeakMap<Response, ResponseDeadline>();

export const providerSuccessBodyMaxBytes = 2 * 1024 * 1024;
export const providerValidationBodyMaxBytes = 1024 * 1024;
export const providerTranscriptMaxChars = 500000;
export const providerSsePendingMaxChars = 256000;

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  let timedOut = false;
  let returnedResponse = false;
  const abort = (): void => controller.abort();
  const cleanup = (): void => {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    init.signal?.removeEventListener("abort", abort);
  }, timeoutMs);
  unrefTimer(timeout);
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (init.signal?.aborted) throw abortError();
    const response = await fetch(input, { ...init, signal: controller.signal });
    responseDeadlines.set(response, {
      deadlineAt,
      timeoutMs,
      controller,
      get timedOut() {
        return timedOut;
      },
      cleanup
    });
    returnedResponse = true;
    return response;
  } catch (error) {
    if (init.signal?.aborted) throw abortError();
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    if (!returnedResponse) cleanup();
  }
}

export function joinUrl(baseUrl: string, path: string | undefined): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `${cleanBase}${cleanPath}`;
}

export async function parseJsonOrText(response: Response, options: ResponseBodyReadOptions = {}): Promise<any> {
  const text = await readResponseText(response, options);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function readResponseText(response: Response, options: ResponseBodyReadOptions = {}): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  await readResponseBody(
    response,
    (chunk) => {
      text += decoder.decode(chunk, { stream: true });
    },
    options
  );
  text += decoder.decode();
  return text;
}

export async function closeResponseBody(response: Response): Promise<void> {
  const deadline = responseDeadlines.get(response);
  try {
    await response.body?.cancel().catch(() => undefined);
  } finally {
    deadline?.cleanup();
    responseDeadlines.delete(response);
  }
}

export async function readResponseBody(
  response: Response,
  onChunk: (chunk: Uint8Array) => void,
  options: ResponseBodyReadOptions = {}
): Promise<void> {
  const deadline = responseDeadlines.get(response);
  const reader = response.body?.getReader();
  if (!reader) {
    deadline?.cleanup();
    responseDeadlines.delete(response);
    return;
  }

  const totalTimeoutMs = options.totalTimeoutMs ?? defaultBodyTimeoutMs;
  const idleTimeoutMs = options.idleTimeoutMs ?? totalTimeoutMs;
  const label = options.label ?? "HTTP";
  const localDeadlineAt = Date.now() + totalTimeoutMs;
  const deadlineAt = Math.min(localDeadlineAt, deadline?.deadlineAt ?? Number.POSITIVE_INFINITY);
  let bytesRead = 0;

  try {
    while (true) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw deadlineTimeoutError(deadline, label, totalTimeoutMs);
      }

      const result = await readChunkWithTimeout(
        reader,
        Math.min(idleTimeoutMs, remainingMs),
        `${label} response body stalled for ${idleTimeoutMs}ms.`,
        options.signal,
        deadline?.controller.signal
      );
      if (result.done) break;
      if (!result.value) continue;

      bytesRead += result.value.byteLength;
      if (options.maxBytes !== undefined && bytesRead > options.maxBytes) {
        throw new Error(`${label} response body exceeded ${options.maxBytes} bytes.`);
      }
      onChunk(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (deadline && (deadline.timedOut || Date.now() >= deadline.deadlineAt)) {
      throw new Error(`Request timed out after ${deadline.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    reader.releaseLock();
    deadline?.cleanup();
    responseDeadlines.delete(response);
  }
}

export function extractTextFromTranscriptionResponse(data: unknown): string {
  if (typeof data === "string") return requireTranscriptText(data);
  if (!isRecord(data)) throw new Error("STT returned an invalid success response.");
  if (typeof data.text === "string") return requireTranscriptText(data.text);

  if (Array.isArray(data.segments)) {
    if (!data.segments.every((segment) => isRecord(segment) && typeof segment.text === "string")) {
      throw new Error("STT returned an invalid segments response.");
    }
    return requireTranscriptText(data.segments.map((segment) => segment.text).join(" "));
  }

  if (Array.isArray(data.transcription)) {
    if (!data.transcription.every((segment) => typeof segment === "string" || (isRecord(segment) && typeof segment.text === "string"))) {
      throw new Error("STT returned an invalid transcription response.");
    }
    return requireTranscriptText(
      data.transcription.map((segment) => (typeof segment === "string" ? segment : segment.text as string)).join(" ")
    );
  }

  throw new Error("STT returned an unrecognized success response.");
}

export function requireTranscriptText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("STT returned an empty transcript.");
  if (text.length > providerTranscriptMaxChars) {
    throw new Error(`STT transcript exceeded ${providerTranscriptMaxChars} characters.`);
  }
  return text;
}

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  message: string,
  ...signals: Array<AbortSignal | undefined>
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  try {
    for (const signal of signals) {
      if (signal?.aborted) throw abortError();
    }
    const abortPromise = new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
      for (const signal of signals) {
        if (!signal) continue;
        const listener = () => reject(abortError());
        listeners.push({ signal, listener });
        signal.addEventListener("abort", listener, { once: true });
      }
    });
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        unrefTimer(timeout);
      }),
      abortPromise
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
  }
}

function deadlineTimeoutError(deadline: ResponseDeadline | undefined, label: string, totalTimeoutMs: number): Error {
  if (deadline && Date.now() >= deadline.deadlineAt) {
    return new Error(`Request timed out after ${deadline.timeoutMs}ms.`);
  }
  return new Error(`${label} response body timed out after ${totalTimeoutMs}ms.`);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
