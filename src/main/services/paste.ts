import type { AppSettings } from "../../shared/types";
import { commandExists, execFileText, sleep } from "./command";
import { clipboard } from "../electron-api";

export class PasteService {
  private hasYdotool = false;
  private diagnostics: string[] = [];

  async initialize(): Promise<void> {
    this.hasYdotool = await commandExists("ydotool");
    this.diagnostics = [
      this.hasYdotool ? "ydotool available for paste automation." : "ydotool unavailable; clipboard only."
    ];
  }

  getDiagnostics(): string[] {
    return this.diagnostics;
  }

  isAutomationAvailable(): boolean {
    return this.hasYdotool;
  }

  async insertText(text: string, settings: AppSettings): Promise<{ pasted: boolean; message: string }> {
    const original = clipboard.readText();
    clipboard.writeText(text);

    if (settings.pasteMethod === "clipboard_only" || !this.hasYdotool) {
      return { pasted: false, message: "Output copied to clipboard." };
    }

    try {
      await execFileText("ydotool", ["key", "29:1", "47:1", "47:0", "29:0"], 1200);
      await sleep(700);
      clipboard.writeText(original);
      return { pasted: true, message: "Output pasted and clipboard restored." };
    } catch (error) {
      clipboard.writeText(text);
      return { pasted: false, message: `Paste automation failed; output left on clipboard. ${String(error)}` };
    }
  }
}
