import type {
  AutomationResult,
  SelectedTextAutomationResult,
  TextAutomationBackend,
  TextAutomationCapability,
  TextAutomationShortcut
} from "./text-automation";
import { MacosAutomationHelper } from "./macos-automation-helper";

export class MacosTextAutomationService implements TextAutomationBackend {
  private diagnostics: string[] = [];
  private trusted = false;
  private helperAvailable = false;

  constructor(private readonly helper = new MacosAutomationHelper()) {}

  async initialize(): Promise<void> {
    await Promise.resolve();
    this.refreshStatus();
  }

  dispose(): void {
    return undefined;
  }

  pasteClipboard(): Promise<AutomationResult> {
    return Promise.resolve(this.shortcutResult("paste", this.helper.paste()));
  }

  copySelection(): Promise<AutomationResult> {
    return Promise.resolve(this.shortcutResult("copy", this.helper.copy()));
  }

  readSelectedText(): Promise<SelectedTextAutomationResult> {
    const result = this.helper.selectedText();
    this.refreshStatusFromResult(result);
    if (!result.ok) {
      return Promise.resolve({
        success: false,
        status: result.trusted === false ? "denied" : "failed",
        message: result.error ?? "macOS selected-text read failed.",
        diagnostics: this.getDiagnostics(),
        backend: "macos_accessibility_helper"
      });
    }
    return Promise.resolve({
      success: true,
      status: "success",
      message: "macOS selected text read through Accessibility.",
      diagnostics: this.getDiagnostics(),
      backend: "macos_accessibility_helper",
      text: result.text || undefined
    });
  }

  getCapability(): TextAutomationCapability {
    return {
      backend: "macos_accessibility_helper",
      automationAvailable: this.helperAvailable && this.trusted,
      permissionRequired: true,
      diagnostics: this.getDiagnostics(),
      availableBackends: this.helperAvailable ? ["macos_accessibility_helper"] : [],
      attemptedBackends: ["macos_accessibility_helper"],
      missingTools: this.helperAvailable ? [] : ["murmur-macos-helper"],
      setupHints: this.trusted ? [] : ["Grant Accessibility permission to Murmur in macOS System Settings."]
    };
  }

  getDiagnostics(): string[] {
    return [...this.diagnostics];
  }

  private shortcutResult(action: "paste" | "copy", result: { ok: boolean; trusted?: boolean; error?: string }): AutomationResult {
    this.refreshStatusFromResult(result);
    if (!result.ok) {
      return {
        success: false,
        status: result.trusted === false ? "denied" : "failed",
        message: result.error ?? `macOS ${action} key emission failed.`,
        diagnostics: this.getDiagnostics(),
        backend: "macos_accessibility_helper",
        attemptedBackends: ["macos_accessibility_helper"]
      };
    }
    return {
      success: true,
      status: "success",
      message: `macOS ${action} key emitted through Accessibility helper.`,
      diagnostics: this.getDiagnostics(),
      backend: "macos_accessibility_helper",
      attemptedBackends: ["macos_accessibility_helper"]
    };
  }

  refreshStatus(): void {
    const status = this.helper.status();
    this.helperAvailable = status.helperAvailable;
    this.trusted = status.trusted;
    this.diagnostics = status.diagnostics;
  }

  private refreshStatusFromResult(result: { ok: boolean; trusted?: boolean; error?: string }): void {
    if (typeof result.trusted === "boolean") this.trusted = result.trusted;
    if (!result.ok && result.error) this.diagnostics = [result.error];
  }
}

export function macosShortcutSupported(_shortcut: TextAutomationShortcut): boolean {
  return true;
}
