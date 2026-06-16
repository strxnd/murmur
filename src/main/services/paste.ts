import { sleep } from "./command";
import { LinuxClipboardService } from "./linux-clipboard";
import { TextAutomationService } from "./text-automation";

export interface ClipboardPasteWriter {
  writeTextForPaste(text: string): Promise<void>;
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

  async insertText(text: string): Promise<{ pasted: boolean; message: string }> {
    return this.textAutomation.runExclusive(async () => {
      await this.linuxClipboard.writeTextForPaste(text);

      await sleep(this.clipboardSettleDelayMs);

      const result = await this.textAutomation.pasteClipboard();
      if (!result.success) {
        return { pasted: false, message: result.message };
      }

      return { pasted: true, message: "Paste shortcut sent; output left on clipboard." };
    });
  }
}
