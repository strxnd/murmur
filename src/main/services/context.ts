import { URL } from "node:url";
import type { AppSettings, ContextSnapshot } from "../../shared/types";
import { commandExists, execFileText, sleep } from "./command";
import { clipboard } from "../electron-api";

interface HyprlandWindow {
  class?: string;
  title?: string;
  initialClass?: string;
}

export class ContextService {
  private lastClipboardText = "";
  private lastClipboardAt = 0;
  private hasHyprctl = false;
  private hasYdotool = false;
  private diagnostics: string[] = [];

  async initialize(): Promise<void> {
    this.hasHyprctl = await commandExists("hyprctl");
    this.hasYdotool = await commandExists("ydotool");
    this.diagnostics = [
      this.hasHyprctl ? "hyprctl available for active window metadata." : "hyprctl unavailable.",
      this.hasYdotool ? "ydotool available for selected text fallback." : "ydotool unavailable."
    ];
    this.startClipboardTracking();
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
      appMetadata: this.hasHyprctl,
      focusedText: false,
      selectedText: this.hasYdotool,
      browserDomain: false
    };
  }

  async capture(settings: AppSettings): Promise<ContextSnapshot> {
    const diagnostics: string[] = [];
    let appName: string | undefined;
    let appId: string | undefined;
    let windowTitle: string | undefined;
    let selectedText: string | undefined;
    let browserDomain: string | undefined;

    if (this.hasHyprctl) {
      try {
        const raw = await execFileText("hyprctl", ["activewindow", "-j"]);
        const activeWindow = JSON.parse(raw) as HyprlandWindow;
        appName = activeWindow.class || activeWindow.initialClass;
        appId = activeWindow.initialClass || activeWindow.class;
        windowTitle = activeWindow.title;
        browserDomain = inferDomainFromTitle(windowTitle);
      } catch (error) {
        diagnostics.push(`Unable to read active window: ${String(error)}`);
      }
    } else {
      diagnostics.push("Active app metadata unavailable on this compositor.");
    }

    if (settings.selectedTextCapture === "clipboard_restore" && this.hasYdotool) {
      selectedText = await this.captureSelectionViaClipboard(diagnostics);
    }

    const now = Date.now();
    const currentClipboard = clipboard.readText();
    const clipboardText =
      currentClipboard && (now - this.lastClipboardAt <= 3000 || currentClipboard !== selectedText)
        ? currentClipboard
        : undefined;

    const quality =
      appName || selectedText || clipboardText ? (selectedText ? "partial" : "fallback") : "unavailable";

    return {
      appName,
      appId,
      windowTitle,
      browserDomain,
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

function inferDomainFromTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const urlMatch = title.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return undefined;
  try {
    return new URL(urlMatch[0]).hostname;
  } catch {
    return undefined;
  }
}
