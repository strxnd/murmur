import { clipboard } from "../electron-api";
import { clipboardHasOwnershipToken, writeOwnedClipboardText } from "./clipboard-snapshot";
import { commandExists, execFileText } from "./command";

const clipboardToolTimeoutMs = 800;

export interface LinuxClipboardDependencies {
  commandExists?: (command: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  execFileText?: typeof execFileText;
  platform?: NodeJS.Platform | string;
}

export class LinuxClipboardService {
  private readonly commandExists: (command: string) => Promise<boolean>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly execFileText: typeof execFileText;
  private readonly platform: NodeJS.Platform | string;
  private toolAvailability: Partial<Record<"wl-copy" | "wl-paste" | "xclip" | "xsel", boolean>> = {};

  constructor(dependencies: LinuxClipboardDependencies = {}) {
    this.commandExists = dependencies.commandExists ?? commandExists;
    this.env = dependencies.env ?? process.env;
    this.execFileText = dependencies.execFileText ?? execFileText;
    this.platform = dependencies.platform ?? process.platform;
  }

  async writeTextForPaste(
    text: string,
    signal?: AbortSignal,
    ownershipToken?: string
  ): Promise<{ restoreIfOwned(): Promise<void> }> {
    if (signal?.aborted) throw abortError();
    const previousText = clipboard.readText();
    const previousPrimary =
      this.platform === "linux" ? (await this.readPrimaryText()) ?? "" : this.readElectronPrimarySelection() ?? "";
    let primaryOwnershipMarked = false;
    if (signal?.aborted) throw abortError();

    const restoreExternalSelections = async (restoreStandard: boolean, restorePrimary: boolean): Promise<void> => {
      await Promise.all([
        restoreStandard ? this.writeWlClipboard(previousText).catch(() => undefined) : Promise.resolve(),
        restorePrimary ? this.writeWlPrimarySelection(previousPrimary).catch(() => undefined) : Promise.resolve(),
        restoreStandard ? this.writeXClipboard(previousText).catch(() => undefined) : Promise.resolve(),
        restorePrimary ? this.writeXPrimarySelection(previousPrimary).catch(() => undefined) : Promise.resolve()
      ]);
    };
    const restoreAfterAbort = async (): Promise<void> => {
      if (ownershipToken) return;
      const restoreStandard = clipboard.readText() === text;
      let restorePrimary = this.readElectronPrimarySelection() === text;
      if (restoreStandard) clipboard.writeText(previousText);
      if (restorePrimary) this.writeElectronPrimarySelection(previousPrimary);
      if (this.platform === "linux" && !restorePrimary && (await this.readExternalPrimaryText().catch(() => undefined)) === text) {
        restorePrimary = true;
      }
      await restoreExternalSelections(restoreStandard, restorePrimary);
    };
    const lease = {
      restoreIfOwned: async () => {
        let restorePrimary = ownershipToken
          ? primaryOwnershipMarked && clipboardHasOwnershipToken(ownershipToken, "selection")
          : this.readElectronPrimarySelection() === text;
        if (
          !ownershipToken &&
          this.platform === "linux" &&
          !restorePrimary &&
          (await this.readExternalPrimaryText().catch(() => undefined)) === text
        ) {
          restorePrimary = true;
        }
        if (restorePrimary) this.writeElectronPrimarySelection(previousPrimary);
        await restoreExternalSelections(false, restorePrimary);
      }
    };
    const onAbort = (): void => {
      void restoreAfterAbort().catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (ownershipToken) writeOwnedClipboardText(text, ownershipToken);
      else clipboard.writeText(text);
      if (this.platform === "linux") {
        if (ownershipToken) {
          try {
            writeOwnedClipboardText(text, ownershipToken, "selection");
            primaryOwnershipMarked = true;
          } catch {
            this.writeElectronPrimarySelection(text);
          }
        } else {
          this.writeElectronPrimarySelection(text);
        }
        await Promise.all([
          this.writeWlPrimarySelection(text).catch(() => undefined),
          this.writeXPrimarySelection(text).catch(() => undefined)
        ]);
      }
      if (signal?.aborted) {
        if (ownershipToken) return lease;
        await restoreAfterAbort();
        throw abortError();
      }

      return lease;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async readPrimaryText(): Promise<string | undefined> {
    if (this.platform !== "linux") return undefined;

    const electronSelection = this.readElectronPrimarySelection();
    if (electronSelection) return electronSelection;
    return this.readExternalPrimaryText();
  }

  private async readExternalPrimaryText(): Promise<string | undefined> {
    const readers = [
      () => this.readWlPrimarySelection(),
      () => this.readXclipPrimarySelection(),
      () => this.readXselPrimarySelection()
    ];

    for (const read of readers) {
      const text = await read().catch(() => undefined);
      if (text) return text;
    }

    return undefined;
  }

  private writeElectronPrimarySelection(text: string): void {
    try {
      clipboard.writeText(text, "selection");
    } catch {
      // Some Electron builds expose selection only on Linux/X11. External tools below cover other cases.
    }
  }

  private readElectronPrimarySelection(): string | undefined {
    try {
      return clipboard.readText("selection") || undefined;
    } catch {
      return undefined;
    }
  }

  private async writeWlPrimarySelection(text: string): Promise<void> {
    if (!this.env.WAYLAND_DISPLAY || !(await this.hasTool("wl-copy"))) return;
    await this.execFileText("wl-copy", ["--primary"], clipboardToolTimeoutMs, { env: this.env, input: text });
  }

  private async writeWlClipboard(text: string): Promise<void> {
    if (!this.env.WAYLAND_DISPLAY || !(await this.hasTool("wl-copy"))) return;
    await this.execFileText("wl-copy", [], clipboardToolTimeoutMs, { env: this.env, input: text });
  }

  private async writeXClipboard(text: string): Promise<void> {
    if (!this.env.DISPLAY) return;
    if (await this.hasTool("xclip")) {
      await this.execFileText("xclip", ["-selection", "clipboard"], clipboardToolTimeoutMs, { env: this.env, input: text });
      return;
    }
    if (await this.hasTool("xsel")) {
      await this.execFileText("xsel", ["--clipboard", "--input"], clipboardToolTimeoutMs, { env: this.env, input: text });
    }
  }

  private async writeXPrimarySelection(text: string): Promise<void> {
    if (!this.env.DISPLAY) return;
    if (await this.hasTool("xclip")) {
      await this.execFileText("xclip", ["-selection", "primary"], clipboardToolTimeoutMs, { env: this.env, input: text });
      return;
    }
    if (await this.hasTool("xsel")) {
      await this.execFileText("xsel", ["--primary", "--input"], clipboardToolTimeoutMs, { env: this.env, input: text });
    }
  }

  private async readWlPrimarySelection(): Promise<string | undefined> {
    if (!this.env.WAYLAND_DISPLAY || !(await this.hasTool("wl-paste"))) return undefined;
    return (await this.execFileText("wl-paste", ["--primary", "--no-newline"], clipboardToolTimeoutMs, { env: this.env })) || undefined;
  }

  private async readXclipPrimarySelection(): Promise<string | undefined> {
    if (!this.env.DISPLAY || !(await this.hasTool("xclip"))) return undefined;
    return (await this.execFileText("xclip", ["-selection", "primary", "-o"], clipboardToolTimeoutMs, { env: this.env })) || undefined;
  }

  private async readXselPrimarySelection(): Promise<string | undefined> {
    if (!this.env.DISPLAY || !(await this.hasTool("xsel"))) return undefined;
    return (await this.execFileText("xsel", ["--primary", "--output"], clipboardToolTimeoutMs, { env: this.env })) || undefined;
  }

  private async hasTool(tool: "wl-copy" | "wl-paste" | "xclip" | "xsel"): Promise<boolean> {
    if (this.toolAvailability[tool] !== undefined) return Boolean(this.toolAvailability[tool]);
    const available = await this.commandExists(tool);
    this.toolAvailability[tool] = available;
    return available;
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}
