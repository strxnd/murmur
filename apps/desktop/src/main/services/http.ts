export interface ResponseBodyReadOptions {
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
  label?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}

const defaultBodyTimeoutMs = 15000;

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  unrefTimer(timeout);
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (init.signal?.aborted) throw abortError();
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (init.signal?.aborted) throw abortError();
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
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

export async function readResponseBody(
  response: Response,
  onChunk: (chunk: Uint8Array) => void,
  options: ResponseBodyReadOptions = {}
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const totalTimeoutMs = options.totalTimeoutMs ?? defaultBodyTimeoutMs;
  const idleTimeoutMs = options.idleTimeoutMs ?? totalTimeoutMs;
  const label = options.label ?? "HTTP";
  const startedAt = Date.now();
  let bytesRead = 0;

  try {
    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = totalTimeoutMs - elapsedMs;
      if (remainingMs <= 0) {
        throw new Error(`${label} response body timed out after ${totalTimeoutMs}ms.`);
      }

      const result = await readChunkWithTimeout(
        reader,
        Math.min(idleTimeoutMs, remainingMs),
        `${label} response body stalled for ${idleTimeoutMs}ms.`,
        options.signal
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
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  try {
    if (signal?.aborted) throw abortError();
    const abortPromise = new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
      onAbort = () => reject(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
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
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function extractTextFromTranscriptionResponse(data: any): string {
  if (typeof data === "string") return data.trim();
  if (typeof data?.text === "string") return data.text.trim();
  if (Array.isArray(data?.segments)) {
    return data.segments
      .map((segment: any) => segment.text)
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (Array.isArray(data?.transcription)) {
    return data.transcription
      .map((segment: any) => segment.text ?? segment)
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return JSON.stringify(data);
}
