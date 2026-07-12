import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export interface RendererSource {
  kind: "dev" | "file";
  url?: string;
  filePath: string;
}

export function resolveRendererSource(options: {
  isPackaged: boolean;
  envRendererUrl?: string;
  rendererFilePath: string;
}): RendererSource {
  const filePath = resolve(options.rendererFilePath);
  if (!options.isPackaged && options.envRendererUrl) {
    const url = parseTrustedDevServerUrl(options.envRendererUrl);
    if (url) return { kind: "dev", url: url.toString().replace(/\/$/, ""), filePath };
  }

  return { kind: "file", filePath };
}

export function isTrustedRendererUrl(source: RendererSource, candidate: string | undefined): boolean {
  if (!candidate) return false;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  if (source.kind === "dev" && source.url) {
    return url.origin === new URL(source.url).origin;
  }

  if (url.protocol !== "file:") return false;

  try {
    return resolve(fileURLToPath(url)) === source.filePath;
  } catch {
    return false;
  }
}

export function rendererFileUrl(source: RendererSource): string {
  return pathToFileURL(source.filePath).toString();
}

function parseTrustedDevServerUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isLocalhost(url.hostname)) return null;
  return url;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
