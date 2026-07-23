import { clipboard } from "../electron-api";
import { captureClipboardSnapshot, restoreClipboardSnapshot } from "./clipboard-snapshot";
import { LinuxClipboardService } from "./linux-clipboard";
import { TextAutomationService } from "./text-automation";

export interface ClipboardPasteLease {
  restoreIfOwned(): Promise<void>;
}

export interface ClipboardPasteWriter {
  writeTextForPaste(text: string, signal?: AbortSignal): Promise<ClipboardPasteLease>;
}

export interface PasteResult {
  pasted: boolean;
  message: string;
  clipboardRetained?: boolean;
}

export interface PasteDispatchGuardResult {
  allowed: boolean;
  message?: string;
}

export type PasteDispatchGuard = () => Promise<PasteDispatchGuardResult>;

export class PasteService {
  constructor(
    private readonly textAutomation: TextAutomationService,
    private readonly clipboardSettleDelayMs = 120,
    private readonly linuxClipboard: ClipboardPasteWriter = new LinuxClipboardService(),
    private readonly clipboardRestoreDelayMs = 5000
  ) {}

  async initialize(): Promise<void> {
    await Promise.resolve();
  }

  getDiagnostics(): string[] {
    return this.textAutomation.getDiagnostics();
  }

  isAutomationAvailable(): boolean {
    return this.textAutomation.getCapability().automationAvailable;
  }

  isPermissionRequired(): boolean {
    return this.textAutomation.getCapability().permissionRequired;
  }

  async copyText(text: string, signal?: AbortSignal): Promise<PasteResult & { pasted: false }> {
    await this.textAutomation.runExclusive(async () => {
      throwIfAborted(signal);
      await this.linuxClipboard.writeTextForPaste(text, signal);
      throwIfAborted(signal);
    }, signal);
    return {
      pasted: false,
      message: "Automatic paste was skipped; output left on the clipboard.",
      clipboardRetained: true
    };
  }

  async insertText(text: string, signal?: AbortSignal, beforePaste?: PasteDispatchGuard): Promise<PasteResult> {
    return this.textAutomation.runExclusive(async () => {
      throwIfAborted(signal);
      const previousClipboard = captureClipboardSnapshot();
      let pasteDispatchStarted = false;
      let clipboardLease: ClipboardPasteLease | null = null;
      const restoreIfOwned = async (): Promise<void> => {
        await clipboardLease?.restoreIfOwned();
        if (clipboard.readText() === text) restoreClipboardSnapshot(previousClipboard);
      };

      try {
        clipboardLease = await this.linuxClipboard.writeTextForPaste(text, signal);
        throwIfAborted(signal);

        await abortableDelay(this.clipboardSettleDelayMs, signal);
        throwIfAborted(signal);

        const guardResult = await beforePaste?.();
        throwIfAborted(signal);
        if (guardResult && !guardResult.allowed) {
          return {
            pasted: false,
            message: guardResult.message ?? "Automatic paste was skipped; output left on the clipboard.",
            clipboardRetained: true
          };
        }

        pasteDispatchStarted = true;
        const result = await this.textAutomation.pasteClipboard();
        if (!result.success) {
          return { pasted: false, message: result.message, clipboardRetained: true };
        }

        if (!previousClipboard.restorable) {
          return {
            pasted: true,
            message: "Paste shortcut sent; output left on the clipboard because the previous clipboard contained unsupported formats.",
            clipboardRetained: true
          };
        }

        await this.scheduleClipboardRestore(restoreIfOwned);
        return {
          pasted: true,
          message: "Paste shortcut sent; previous clipboard restoration scheduled after paste delivery.",
          clipboardRetained: false
        };
      } catch (error) {
        if (signal?.aborted && !pasteDispatchStarted) await restoreIfOwned();
        throw error;
      }
    }, signal);
  }

  private async scheduleClipboardRestore(restoreIfOwned: () => Promise<void>): Promise<void> {
    if (this.clipboardRestoreDelayMs <= 0) {
      await restoreIfOwned();
      return;
    }

    const timer = setTimeout(() => {
      void this.textAutomation
        .runExclusive(restoreIfOwned)
        .catch((error) => console.warn(`Clipboard restoration failed: ${errorMessage(error)}`));
    }, this.clipboardRestoreDelayMs);
    timer.unref();
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
