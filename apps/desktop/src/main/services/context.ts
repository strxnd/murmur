import { randomUUID } from "node:crypto";
import type { ContextSnapshot } from "../../shared/types";
import { clipboard } from "../electron-api";
import {
  captureClipboardSnapshot,
  clipboardHasOwnershipToken,
  clipboardMatchesSnapshot,
  restoreClipboardSnapshot,
  writeOwnedClipboardText,
  type ClipboardSnapshot
} from "./clipboard-snapshot";
import { DesktopMetadataService } from "./context-metadata";
import { LinuxClipboardService } from "./linux-clipboard";
import { TextAutomationService } from "./text-automation";

export interface PrimarySelectionReader {
  readPrimaryText(): Promise<string | undefined>;
}

export interface ContextCaptureChannels {
  selectedText: boolean;
  clipboardText: boolean;
}

export interface ContextCaptureOptions {
  selectedText?: boolean;
  clipboardText?: boolean;
  resolveChannels?: (metadata: ContextSnapshot) => ContextCaptureChannels;
  signal?: AbortSignal;
}

export class ContextService {
  private lastClipboardText = "";
  private lastClipboardAt = 0;
  private clipboardTransactionDepth = 0;
  private clipboardTrackingInterval: ReturnType<typeof setInterval> | null = null;
  private metadata = new DesktopMetadataService();

  constructor(
    private readonly textAutomation: TextAutomationService,
    private readonly selectionPollTimeoutMs = 500,
    private readonly selectionPollIntervalMs = 25,
    private readonly linuxClipboard: PrimarySelectionReader = new LinuxClipboardService()
  ) {}

  async initialize(): Promise<void> {
    await this.metadata.initialize();
    this.startClipboardTracking();
  }

  dispose(): void {
    this.stopClipboardTracking();
    this.metadata.dispose();
  }

  getDiagnostics(): string[] {
    return [...this.metadata.getDiagnostics(), ...this.textAutomation.getDiagnostics()];
  }

  getCapabilityFlags(): {
    appMetadata: boolean;
    selectedText: boolean;
  } {
    return {
      appMetadata: this.metadata.hasAppMetadataProvider(),
      selectedText: this.textAutomation.getCapability().automationAvailable
    };
  }

  async capture(options: ContextCaptureOptions = {}): Promise<ContextSnapshot> {
    const { signal } = options;
    throwIfAborted(signal);
    const diagnostics: string[] = [];
    const activeWindow = await this.metadata.capture(diagnostics);
    throwIfAborted(signal);
    const metadata: ContextSnapshot = {
      ...activeWindow,
      capturedAt: new Date().toISOString(),
      sourceQuality: hasAppMetadata(activeWindow) ? "partial" : "unavailable",
      diagnostics
    };
    const channels = options.resolveChannels?.(metadata) ?? {
      selectedText: options.selectedText === true,
      clipboardText: options.clipboardText === true
    };
    let selectedText: string | undefined;

    const textAutomationCapability = this.textAutomation.getCapability();
    if (channels.selectedText && textAutomationCapability.automationAvailable) {
      if (textAutomationCapability.backend === "macos_accessibility_helper") {
        selectedText = await this.captureSelectionViaAccessibility(diagnostics, signal);
        selectedText ??= await this.captureSelectionViaClipboard(diagnostics, signal);
      } else {
        selectedText = await this.captureSelectionViaClipboard(diagnostics, signal);
      }
    }
    throwIfAborted(signal);

    const clipboardText = channels.clipboardText ? this.readFreshClipboardText(selectedText) : undefined;

    const appMetadataAvailable = hasAppMetadata(activeWindow);
    const quality =
      appMetadataAvailable && selectedText
        ? "full"
        : appMetadataAvailable || selectedText
          ? "partial"
          : clipboardText
            ? "fallback"
            : "unavailable";

    return {
      ...activeWindow,
      selectedText,
      clipboardText,
      capturedAt: metadata.capturedAt,
      sourceQuality: quality,
      diagnostics
    };
  }

  private startClipboardTracking(): void {
    if (this.clipboardTrackingInterval) return;
    this.lastClipboardText = clipboard.readText();
    this.lastClipboardAt = 0;
    this.clipboardTrackingInterval = setInterval(() => {
      if (this.clipboardTransactionDepth > 0) return;
      this.observeClipboardText(clipboard.readText());
    }, 1000);
    unrefTimer(this.clipboardTrackingInterval);
  }

  private readFreshClipboardText(selectedText?: string): string | undefined {
    const currentClipboard = clipboard.readText();
    this.observeClipboardText(currentClipboard);
    const observedRecently = this.lastClipboardAt > 0 && Date.now() - this.lastClipboardAt <= 3000;
    return currentClipboard && observedRecently && currentClipboard !== selectedText ? currentClipboard : undefined;
  }

  private observeClipboardText(text: string): void {
    if (text === this.lastClipboardText) return;
    this.lastClipboardText = text;
    this.lastClipboardAt = Date.now();
  }

  private stopClipboardTracking(): void {
    if (!this.clipboardTrackingInterval) return;
    clearInterval(this.clipboardTrackingInterval);
    this.clipboardTrackingInterval = null;
  }

  private async captureSelectionViaClipboard(
    diagnostics: string[],
    signal?: AbortSignal
  ): Promise<string | undefined> {
    return this.textAutomation.runExclusive(async () => {
      throwIfAborted(signal);
      const original = captureClipboardSnapshot();
      if (!original.restorable) {
        diagnostics.push("Selected text capture was skipped to preserve unsupported clipboard formats.");
        return undefined;
      }
      const ownershipToken = randomUUID();
      const sentinel = `murmur-selection-${ownershipToken}`;
      const originalPrimary = await this.linuxClipboard.readPrimaryText().catch(() => undefined);
      let ownedClipboard: ClipboardSnapshot | undefined;
      this.clipboardTransactionDepth += 1;
      try {
        throwIfAborted(signal);
        writeOwnedClipboardText(sentinel, ownershipToken);
        const result = await this.textAutomation.copySelection();
        throwIfAborted(signal);
        if (!result.success) {
          diagnostics.push(result.message);
          return undefined;
        }

        const copied = await this.pollClipboardChange(sentinel, signal);
        if (copied && copied !== sentinel) {
          ownedClipboard = captureClipboardSnapshot();
          return copied;
        }
        const primary = await this.linuxClipboard.readPrimaryText().catch(() => undefined);
        throwIfAborted(signal);
        if (primary && primary !== sentinel && primary !== originalPrimary) {
          return primary;
        }
        return undefined;
      } catch (error) {
        if (isAbortError(error)) throw error;
        diagnostics.push(`Selected text capture failed: ${String(error)}`);
        return undefined;
      } finally {
        try {
          const transactionStillOwnsClipboard =
            clipboardHasOwnershipToken(ownershipToken) ||
            (ownedClipboard !== undefined && clipboardMatchesSnapshot(ownedClipboard));
          if (transactionStillOwnsClipboard) {
            restoreClipboardSnapshot(original);
            this.lastClipboardText = original.text;
          } else {
            this.observeClipboardText(clipboard.readText());
          }
        } finally {
          this.clipboardTransactionDepth -= 1;
        }
      }
    }, signal);
  }

  private async captureSelectionViaAccessibility(
    diagnostics: string[],
    signal?: AbortSignal
  ): Promise<string | undefined> {
    throwIfAborted(signal);
    const result = await this.textAutomation.readSelectedText();
    throwIfAborted(signal);
    if (!result.success) {
      diagnostics.push(result.message);
      return undefined;
    }
    return result.text;
  }

  private async pollClipboardChange(sentinel: string, signal?: AbortSignal): Promise<string | undefined> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.selectionPollTimeoutMs) {
      throwIfAborted(signal);
      const copied = clipboard.readText();
      if (copied && copied !== sentinel) return copied;
      await abortableDelay(this.selectionPollIntervalMs, signal);
    }
    return undefined;
  }
}

function hasAppMetadata(
  context: Pick<ContextSnapshot, "appName" | "appId" | "windowId" | "windowTitle">
): boolean {
  return Boolean(context.appName || context.appId || context.windowId || context.windowTitle);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}
