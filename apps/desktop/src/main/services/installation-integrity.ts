import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  readdirSync,
  statfsSync,
  statSync
} from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";

export interface DownloadedFile {
  bytes: number;
  sha256: string;
}

export interface InstalledFileReceipt {
  sizeBytes: number;
  sha256: string;
}

export interface InstalledTreeReceipt {
  files: Record<string, InstalledFileReceipt>;
  symlinks: Record<string, string>;
}

interface BoundedDownloadOptions {
  response: Response;
  filePath: string;
  expectedBytes: number;
  idleTimeoutMs: number;
  signal: AbortSignal;
  onProgress?: (bytes: number) => void;
}

export async function withDownloadDeadline<T>(
  signal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  signal.addEventListener("abort", abort, { once: true });

  try {
    if (signal.aborted) throw abortError();
    return await operation(controller.signal);
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut) throw new Error(`Download exceeded the total deadline of ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function downloadResponseToFile(options: BoundedDownloadOptions): Promise<DownloadedFile> {
  const { response, filePath, expectedBytes, idleTimeoutMs, signal, onProgress } = options;
  if (!response.body) throw new Error("Download response did not include a stream.");
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error(`Download has an invalid expected size: ${expectedBytes}.`);
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw new Error(`Download declared an invalid Content-Length: ${declaredLength}.`);
    }
    if (declaredBytes !== expectedBytes) {
      throw new Error(`Download size mismatch. Expected ${expectedBytes} bytes, server declared ${declaredBytes}.`);
    }
  }

  mkdirSync(dirname(filePath), { recursive: true });
  ensureAvailableDiskSpace(dirname(filePath), expectedBytes);

  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let handle: FileHandle | undefined;
  let bytes = 0;
  let streamDone = false;

  try {
    handle = await open(filePath, "wx", 0o600);
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await readStreamChunk(reader, idleTimeoutMs, signal);
      if (done) {
        streamDone = true;
        break;
      }
      if (!value) continue;
      if (bytes + value.byteLength > expectedBytes) {
        throw new Error(`Download exceeded the pinned size of ${expectedBytes} bytes.`);
      }
      const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const result = await handle.write(buffer, 0, buffer.byteLength, null);
      if (result.bytesWritten !== buffer.byteLength) {
        throw new Error(`Download write was incomplete: wrote ${result.bytesWritten} of ${buffer.byteLength} bytes.`);
      }
      bytes += result.bytesWritten;
      hash.update(buffer);
      onProgress?.(bytes);
    }
    if (bytes !== expectedBytes) {
      throw new Error(`Download size mismatch. Expected ${expectedBytes} bytes, received ${bytes}.`);
    }
    await handle.sync();
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    if (!streamDone) await reader.cancel().catch(() => undefined);
    await handle?.close().catch(() => undefined);
  }
}

export async function inspectTarArchive(
  archivePath: string,
  compression: "gz" | "bz2",
  maxExtractedBytes: number,
  signal?: AbortSignal
): Promise<number> {
  const flag = compression === "gz" ? "-tzf" : "-tjf";
  const verboseFlag = compression === "gz" ? "-tvzf" : "-tvjf";
  const [namesOutput, verboseOutput] = await Promise.all([
    captureCommand("tar", [flag, archivePath], signal),
    captureCommand("tar", [verboseFlag, archivePath], signal)
  ]);
  const names = outputLines(namesOutput);
  const details = outputLines(verboseOutput);
  if (names.length !== details.length) {
    throw new Error("Archive listing was inconsistent while validating entries.");
  }

  let extractedBytes = 0;
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const detail = details[index];
    if (isUnsafeArchivePath(name)) throw new Error(`Archive contains an unsafe path: ${name}`);

    const entryType = detail[0];
    if (entryType === "-") {
      extractedBytes += archiveEntrySize(detail);
      if (extractedBytes > maxExtractedBytes) {
        throw new Error(`Archive expands beyond the allowed ${maxExtractedBytes} bytes.`);
      }
      continue;
    }
    if (entryType === "d") continue;
    if (entryType === "l") {
      const target = detail.includes(" -> ") ? detail.slice(detail.lastIndexOf(" -> ") + 4) : "";
      if (!target || isUnsafeLinkTarget(name, target)) {
        throw new Error(`Archive contains an unsafe symbolic link: ${name}`);
      }
      continue;
    }
    if (entryType === "h") {
      throw new Error(`Archive contains an unsupported hard link: ${name}`);
    }
    throw new Error(`Archive contains an unsupported entry type for ${name}.`);
  }
  return extractedBytes;
}

export function createInstalledTreeReceipt(root: string, maxBytes: number): InstalledTreeReceipt {
  const receipt: InstalledTreeReceipt = { files: {}, symlinks: {} };
  const canonicalRoot = realpathSync(root);
  let totalBytes = 0;

  walkInstalledTree(root, (path, relativePath) => {
    if (relativePath === "runtime.json" || relativePath === ".murmur-model.json") return;
    const stats = lstatSync(path);
    if (stats.isDirectory()) return;
    if (stats.isSymbolicLink()) {
      assertContainedRealpath(canonicalRoot, path);
      receipt.symlinks[relativePath] = readlinkSync(path);
      return;
    }
    if (!stats.isFile()) throw new Error(`Installed artifact contains an unsupported filesystem entry: ${relativePath}`);
    assertContainedRealpath(canonicalRoot, path);
    totalBytes += stats.size;
    if (totalBytes > maxBytes) throw new Error(`Installed artifact exceeds the allowed ${maxBytes} bytes.`);
    receipt.files[relativePath] = {
      sizeBytes: stats.size,
      sha256: sha256File(path)
    };
  });

  if (Object.keys(receipt.files).length === 0) throw new Error("Installed artifact did not contain any regular files.");
  return receipt;
}

export function verifyInstalledTreeReceipt(root: string, expected: InstalledTreeReceipt, maxBytes: number): string | null {
  try {
    const actual = createInstalledTreeReceipt(root, maxBytes);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return "Installed artifact contents do not match their integrity receipt.";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function ensureAvailableDiskSpace(path: string, requiredBytes: number): void {
  const stats = statfsSync(path);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
    throw new Error(`Not enough free disk space for download. Required ${requiredBytes} bytes, available ${Math.max(0, availableBytes)}.`);
  }
}

function walkInstalledTree(root: string, visit: (path: string, relativePath: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    const relativePath = relative(root, path).split(sep).join("/");
    visit(path, relativePath);
    if (entry.isDirectory()) {
      walkInstalledTreeNested(root, path, visit);
    }
  }
}

function walkInstalledTreeNested(root: string, directory: string, visit: (path: string, relativePath: string) => void): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split(sep).join("/");
    visit(path, relativePath);
    if (entry.isDirectory()) walkInstalledTreeNested(root, path, visit);
  }
}

function assertContainedRealpath(canonicalRoot: string, path: string): void {
  const canonicalPath = realpathSync(path);
  const relativePath = relative(canonicalRoot, canonicalPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Installed artifact resolves outside its installation root: ${path}`);
  }
}

function sha256File(path: string): string {
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`Integrity receipt path is not a regular file: ${path}`);

  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function archiveEntrySize(detail: string): number {
  const fields = detail.trim().split(/\s+/);
  const sizeField = fields[1]?.includes("/") ? fields[2] : fields[4];
  const size = Number(sizeField);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Could not determine archive entry size from: ${detail}`);
  return size;
}

function isUnsafeArchivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.includes("\0")) return true;
  return normalized.split("/").some((part) => part === "..");
}

function isUnsafeLinkTarget(entryName: string, target: string): boolean {
  const normalizedTarget = target.replace(/\\/g, "/");
  if (!normalizedTarget || normalizedTarget.startsWith("/") || /^[A-Za-z]:\//.test(normalizedTarget) || normalizedTarget.includes("\0")) {
    return true;
  }
  const resolvedTarget = normalize(join(dirname(entryName), normalizedTarget)).replace(/\\/g, "/");
  return resolvedTarget === ".." || resolvedTarget.startsWith("../");
}

function outputLines(output: string): string[] {
  return output.split("\n").map((line) => line.trimEnd()).filter(Boolean);
}

function captureCommand(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolvePromise(stdout);
    };
    const abort = (): void => {
      child.kill();
      finish(abortError());
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => reject(abortError()));
    timeout = setTimeout(() => finish(() => reject(new Error(`Download stalled while reading the response body for ${timeoutMs}ms.`))), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (result) => finish(() => resolvePromise(result)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
