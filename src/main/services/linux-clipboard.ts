import { clipboard } from "../electron-api";
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

  async writeTextForPaste(text: string): Promise<void> {
    clipboard.writeText(text);
    if (this.platform !== "linux") return;

    this.writeElectronPrimarySelection(text);
    await Promise.all([
      this.writeWlPrimarySelection(text).catch(() => undefined),
      this.writeXPrimarySelection(text).catch(() => undefined)
    ]);
  }

  async readPrimaryText(): Promise<string | undefined> {
    if (this.platform !== "linux") return undefined;

    const electronSelection = this.readElectronPrimarySelection();
    if (electronSelection) return electronSelection;

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
