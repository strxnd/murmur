import { randomUUID } from "node:crypto";
import type { ContextSnapshot } from "../../shared/types";
import { sleep } from "./command";
import { clipboard } from "../electron-api";
import { captureClipboardSnapshot, restoreClipboardSnapshot } from "./clipboard-snapshot";
import { DesktopMetadataService } from "./context-metadata";
import { LinuxClipboardService } from "./linux-clipboard";
import { TextAutomationService } from "./text-automation";

export interface PrimarySelectionReader {
  readPrimaryText(): Promise<string | undefined>;
}

export interface ContextCaptureOptions {
  selectedText?: boolean;
}

export class ContextService {
  private lastClipboardText = "";
  private lastClipboardAt = 0;
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
    const diagnostics: string[] = [];
    const activeWindow = await this.metadata.capture(diagnostics);
    let selectedText: string | undefined;

    const textAutomationCapability = this.textAutomation.getCapability();
    if ((options.selectedText ?? true) && textAutomationCapability.automationAvailable) {
      if (textAutomationCapability.backend === "macos_accessibility_helper") {
        selectedText = await this.captureSelectionViaAccessibility(diagnostics);
        selectedText ??= await this.captureSelectionViaClipboard(diagnostics);
      } else {
        selectedText = await this.captureSelectionViaClipboard(diagnostics);
      }
    }

    const now = Date.now();
    const currentClipboard = clipboard.readText();
    const clipboardText =
      currentClipboard && (now - this.lastClipboardAt <= 3000 || currentClipboard !== selectedText)
        ? currentClipboard
        : undefined;

    const hasAppMetadata = Boolean(activeWindow.appName || activeWindow.appId || activeWindow.windowTitle);
    const quality =
      hasAppMetadata && selectedText
        ? "full"
        : hasAppMetadata || selectedText
          ? "partial"
          : clipboardText
            ? "fallback"
            : "unavailable";

    return {
      ...activeWindow,
      selectedText,
      clipboardText,
      capturedAt: new Date().toISOString(),
      sourceQuality: quality,
      diagnostics
    };
  }

  private startClipboardTracking(): void {
    if (this.clipboardTrackingInterval) return;
    this.lastClipboardText = clipboard.readText();
    this.lastClipboardAt = Date.now();
    this.clipboardTrackingInterval = setInterval(() => {
      const text = clipboard.readText();
      if (text !== this.lastClipboardText) {
        this.lastClipboardText = text;
        this.lastClipboardAt = Date.now();
      }
    }, 1000);
    unrefTimer(this.clipboardTrackingInterval);
  }

  private stopClipboardTracking(): void {
    if (!this.clipboardTrackingInterval) return;
    clearInterval(this.clipboardTrackingInterval);
    this.clipboardTrackingInterval = null;
  }

  private async captureSelectionViaClipboard(diagnostics: string[]): Promise<string | undefined> {
    return this.textAutomation.runExclusive(async () => {
      const original = captureClipboardSnapshot();
      const sentinel = `murmur-selection-${randomUUID()}`;
      const originalPrimary = await this.linuxClipboard.readPrimaryText().catch(() => undefined);
      try {
        clipboard.writeText(sentinel);
        const result = await this.textAutomation.copySelection();
        if (!result.success) {
          diagnostics.push(result.message);
          return undefined;
        }

        const copied = await this.pollClipboardChange(sentinel);
        if (copied && copied !== sentinel) {
          return copied;
        }
        const primary = await this.linuxClipboard.readPrimaryText().catch(() => undefined);
        if (primary && primary !== sentinel && primary !== originalPrimary) {
          return primary;
        }
        return undefined;
      } catch (error) {
        diagnostics.push(`Selected text capture failed: ${String(error)}`);
        return undefined;
      } finally {
        restoreClipboardSnapshot(original);
      }
    });
  }

  private async captureSelectionViaAccessibility(diagnostics: string[]): Promise<string | undefined> {
    const result = await this.textAutomation.readSelectedText();
    if (!result.success) {
      diagnostics.push(result.message);
      return undefined;
    }
    return result.text;
  }

  private async pollClipboardChange(sentinel: string): Promise<string | undefined> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.selectionPollTimeoutMs) {
      const copied = clipboard.readText();
      if (copied && copied !== sentinel) return copied;
      await sleep(this.selectionPollIntervalMs);
    }
    return undefined;
  }
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}
