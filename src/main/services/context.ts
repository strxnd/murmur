import type { AppSettings, ContextSnapshot } from "../../shared/types";
import { commandExists, execFileText, sleep } from "./command";
import { clipboard } from "../electron-api";
import { DesktopMetadataService } from "./context-metadata";

export class ContextService {
  private lastClipboardText = "";
  private lastClipboardAt = 0;
  private hasYdotool = false;
  private metadata = new DesktopMetadataService();
  private diagnostics: string[] = [];

  async initialize(): Promise<void> {
    const [hasYdotool] = await Promise.all([commandExists("ydotool"), this.metadata.initialize()]);
    this.hasYdotool = hasYdotool;
    this.diagnostics = [
      ...this.metadata.getDiagnostics(),
      this.hasYdotool ? "ydotool available for selected text fallback." : "ydotool unavailable."
    ];
    this.startClipboardTracking();
  }

  dispose(): void {
    this.metadata.dispose();
  }

  getDiagnostics(): string[] {
    return this.diagnostics;
  }

  getCapabilityFlags(): {
    appMetadata: boolean;
    focusedText: boolean;
    selectedText: boolean;
    browserDomain: boolean;
  } {
    return {
      appMetadata: this.metadata.hasAppMetadataProvider(),
      focusedText: false,
      selectedText: this.hasYdotool,
      browserDomain: false
    };
  }

  async capture(settings: AppSettings): Promise<ContextSnapshot> {
    const diagnostics: string[] = [];
    const activeWindow = await this.metadata.capture(diagnostics);
    let selectedText: string | undefined;

    if (settings.selectedTextCapture === "clipboard_restore" && this.hasYdotool) {
      selectedText = await this.captureSelectionViaClipboard(diagnostics);
    }

    const now = Date.now();
    const currentClipboard = clipboard.readText();
    const clipboardText =
      currentClipboard && (now - this.lastClipboardAt <= 3000 || currentClipboard !== selectedText)
        ? currentClipboard
        : undefined;

    const hasAppMetadata = Boolean(
      activeWindow.appName || activeWindow.appId || activeWindow.windowTitle || activeWindow.browserDomain || activeWindow.browserUrl
    );
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
    this.lastClipboardText = clipboard.readText();
    this.lastClipboardAt = Date.now();
    setInterval(() => {
      const text = clipboard.readText();
      if (text !== this.lastClipboardText) {
        this.lastClipboardText = text;
        this.lastClipboardAt = Date.now();
      }
    }, 1000).unref();
  }

  private async captureSelectionViaClipboard(diagnostics: string[]): Promise<string | undefined> {
    const original = clipboard.readText();
    try {
      await execFileText("ydotool", ["key", "29:1", "46:1", "46:0", "29:0"], 1200);
      await sleep(180);
      const copied = clipboard.readText();
      if (copied && copied !== original) {
        clipboard.writeText(original);
        return copied;
      }
      clipboard.writeText(original);
      return undefined;
    } catch (error) {
      diagnostics.push(`Selected text fallback failed: ${String(error)}`);
      clipboard.writeText(original);
      return undefined;
    }
  }
}
