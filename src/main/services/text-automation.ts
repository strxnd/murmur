import { AsyncLocalStorage } from "node:async_hooks";
import { LinuxTextAutomationService } from "./linux-text-automation";

export type AutomationResultStatus = "success" | "unavailable" | "denied" | "failed";
export type TextAutomationBackendId =
  | "linux_native_helper"
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
  getCapability(): TextAutomationCapability;
  getDiagnostics(): string[];
}

export interface ShortcutAutomationBackend extends TextAutomationBackend {
  sendKeyboardShortcut(shortcut: TextAutomationShortcut, action: "paste" | "copy"): Promise<AutomationResult>;
}

export class TextAutomationService {
  private operationQueue: Promise<void> = Promise.resolve();
  private exclusiveContext = new AsyncLocalStorage<boolean>();

  constructor(private readonly backend: TextAutomationBackend = new LinuxTextAutomationService()) {}

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

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(() => this.exclusiveContext.run(true, operation));
  }

  getCapability(): TextAutomationCapability {
    return this.backend.getCapability();
  }

  getDiagnostics(): string[] {
    return this.backend.getDiagnostics();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
