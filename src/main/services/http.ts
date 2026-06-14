export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function joinUrl(baseUrl: string, path: string | undefined): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `${cleanBase}${cleanPath}`;
}

export async function parseJsonOrText(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
