import { clipboard } from "../electron-api";
import { captureClipboardSnapshot, restoreClipboardSnapshot } from "./clipboard-snapshot";
import { LinuxClipboardService } from "./linux-clipboard";
import { TextAutomationService } from "./text-automation";

export interface ClipboardPasteWriter {
  writeTextForPaste(text: string, signal?: AbortSignal): Promise<void>;
}

export class PasteService {
  constructor(
    private readonly textAutomation: TextAutomationService,
    private readonly clipboardSettleDelayMs = 120,
    private readonly linuxClipboard: ClipboardPasteWriter = new LinuxClipboardService()
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

  async insertText(text: string, signal?: AbortSignal): Promise<{ pasted: boolean; message: string }> {
    return this.textAutomation.runExclusive(async () => {
      throwIfAborted(signal);
      const previousClipboard = captureClipboardSnapshot();
      const restoreIfOwned = (): void => {
        if (clipboard.readText() === text) restoreClipboardSnapshot(previousClipboard);
      };
      const onAbort = (): void => restoreIfOwned();
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        await this.linuxClipboard.writeTextForPaste(text, signal);
        throwIfAborted(signal);

        await abortableDelay(this.clipboardSettleDelayMs, signal);
        throwIfAborted(signal);

        const result = await this.textAutomation.pasteClipboard();
        if (!result.success) {
          return { pasted: false, message: result.message };
        }

        return { pasted: true, message: "Paste shortcut sent; output left on clipboard." };
      } catch (error) {
        if (signal?.aborted) restoreIfOwned();
        throw error;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    }, signal);
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
