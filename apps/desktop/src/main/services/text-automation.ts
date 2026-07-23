import { AsyncLocalStorage } from "node:async_hooks";
import { LinuxTextAutomationService } from "./linux-text-automation";
import { MacosTextAutomationService } from "./macos-text-automation";

export type AutomationResultStatus = "success" | "unavailable" | "denied" | "failed";
export type TextAutomationBackendId =
  | "linux_native_helper"
  | "macos_accessibility_helper"
  | "wtype"
  | "xdotool"
  | "ydotool"
  | "xdg_remote_desktop_keyboard"
  | "clipboard_only";
export type TextAutomationShortcut = "ctrl_v" | "ctrl_shift_v" | "shift_insert" | "ctrl_c" | "ctrl_shift_c";

export interface AutomationResult {
  success: boolean;
  status: AutomationResultStatus;
  message: string;
  diagnostics: string[];
  backend?: TextAutomationBackendId;
  attemptedBackends?: TextAutomationBackendId[];
}

export interface SelectedTextAutomationResult extends AutomationResult {
  text?: string;
}

export interface TextAutomationCapability {
  backend: TextAutomationBackendId;
  automationAvailable: boolean;
  permissionRequired: boolean;
  diagnostics: string[];
  availableBackends?: TextAutomationBackendId[];
  attemptedBackends?: TextAutomationBackendId[];
  missingTools?: string[];
  setupHints?: string[];
}

export interface TextAutomationBackend {
  initialize(): Promise<void>;
  dispose(): void;
  pasteClipboard(): Promise<AutomationResult>;
  copySelection(): Promise<AutomationResult>;
  readSelectedText?(): Promise<SelectedTextAutomationResult>;
  refreshStatus?(): void;
  getCapability(): TextAutomationCapability;
  getDiagnostics(): string[];
}

export interface ShortcutAutomationBackend extends TextAutomationBackend {
  sendKeyboardShortcut(shortcut: TextAutomationShortcut, action: "paste" | "copy"): Promise<AutomationResult>;
}

export class TextAutomationService {
  private operationQueue: Promise<void> = Promise.resolve();
  private exclusiveContext = new AsyncLocalStorage<boolean>();

  constructor(private readonly backend: TextAutomationBackend = createTextAutomationBackend()) {}

  initialize(): Promise<void> {
    return this.backend.initialize();
  }

  dispose(): void {
    this.backend.dispose();
  }

  pasteClipboard(): Promise<AutomationResult> {
    if (this.exclusiveContext.getStore()) return this.backend.pasteClipboard();
    return this.enqueue(() => this.backend.pasteClipboard());
  }

  copySelection(): Promise<AutomationResult> {
    if (this.exclusiveContext.getStore()) return this.backend.copySelection();
    return this.enqueue(() => this.backend.copySelection());
  }

  readSelectedText(): Promise<SelectedTextAutomationResult> {
    if (!this.backend.readSelectedText) {
      return Promise.resolve({
        success: false,
        status: "unavailable",
        message: "Selected text reads are not supported by this automation backend.",
        diagnostics: this.backend.getDiagnostics(),
        backend: this.backend.getCapability().backend
      });
    }
    if (this.exclusiveContext.getStore()) return this.backend.readSelectedText();
    return this.enqueue(() => this.backend.readSelectedText!());
  }

  runExclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.enqueue(() => this.exclusiveContext.run(true, operation), signal);
  }

  getCapability(): TextAutomationCapability {
    return this.backend.getCapability();
  }

  refreshStatus(): void {
    this.backend.refreshStatus?.();
  }

  getDiagnostics(): string[] {
    return this.backend.getDiagnostics();
  }

  private enqueue<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const runOperation = (): Promise<T> => {
      if (signal?.aborted) return Promise.reject(abortError());
      return operation();
    };
    const run = this.operationQueue.then(runOperation, runOperation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function createTextAutomationBackend(platform: NodeJS.Platform = process.platform): TextAutomationBackend {
  if (platform === "linux") return new LinuxTextAutomationService();
  if (platform === "darwin") return new MacosTextAutomationService();
  return new UnavailableTextAutomationService(platform);
}

class UnavailableTextAutomationService implements TextAutomationBackend {
  constructor(private readonly platform: string) {}

  async initialize(): Promise<void> {
    await Promise.resolve();
  }

  dispose(): void {
    return undefined;
  }

  pasteClipboard(): Promise<AutomationResult> {
    return Promise.resolve(this.result());
  }

  copySelection(): Promise<AutomationResult> {
    return Promise.resolve(this.result());
  }

  getCapability(): TextAutomationCapability {
    return {
      backend: "clipboard_only",
      automationAvailable: false,
      permissionRequired: false,
      diagnostics: [`Text automation is unavailable on unsupported platform ${this.platform}.`]
    };
  }

  getDiagnostics(): string[] {
    return this.getCapability().diagnostics;
  }

  private result(): AutomationResult {
    return {
      success: false,
      status: "unavailable",
      message: `Text automation is unavailable on unsupported platform ${this.platform}.`,
      diagnostics: this.getDiagnostics(),
      backend: "clipboard_only"
    };
  }
}
