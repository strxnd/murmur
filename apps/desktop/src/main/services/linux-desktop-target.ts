import { readFile } from "node:fs/promises";
import { commandExists, execFileText } from "./command";

const targetTimeoutMs = 800;

export interface LinuxDesktopEnvironment {
  currentDesktop: string;
  desktopSession: string;
  hasDisplay: boolean;
  hasWaylandDisplay: boolean;
  isGnome: boolean;
  isKde: boolean;
  isWlroots: boolean;
  sessionType: "wayland" | "x11" | "unknown";
}

export interface LinuxTargetInfo {
  appId?: string;
  appName?: string;
  classification: "terminal" | "non_terminal" | "unknown";
  diagnostics: string[];
  isElectron: boolean;
  isTerminal: boolean;
  pid?: number;
  source?: "hyprctl" | "xdotool";
  windowTitle?: string;
}

export interface LinuxDesktopTargetDependencies {
  commandExists?: (command: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  execFileText?: typeof execFileText;
  platform?: NodeJS.Platform | string;
  readProcComm?: (pid: number) => Promise<string | undefined>;
}

export class LinuxDesktopTargetService {
  private readonly commandExists: (command: string) => Promise<boolean>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly execFileText: typeof execFileText;
  private readonly platform: NodeJS.Platform | string;
  private readonly readProcComm: (pid: number) => Promise<string | undefined>;
  private tools: Partial<Record<"hyprctl" | "xdotool", boolean>> = {};

  constructor(dependencies: LinuxDesktopTargetDependencies = {}) {
    this.commandExists = dependencies.commandExists ?? commandExists;
    this.env = dependencies.env ?? process.env;
    this.execFileText = dependencies.execFileText ?? execFileText;
    this.platform = dependencies.platform ?? process.platform;
    this.readProcComm = dependencies.readProcComm ?? defaultReadProcComm;
  }

  getEnvironment(): LinuxDesktopEnvironment {
    return detectLinuxDesktopEnvironment(this.env);
  }

  async capture(): Promise<LinuxTargetInfo> {
    if (this.platform !== "linux") {
      return emptyTarget(["Linux active window target detection is unavailable on this platform."]);
    }

    const diagnostics: string[] = [];
    const hyprland = await this.captureHyprland(diagnostics).catch((error) => {
      diagnostics.push(`Hyprland active window detection failed: ${errorMessage(error)}.`);
      return null;
    });
    if (hyprland) return hyprland;

    const x11 = await this.captureX11(diagnostics).catch((error) => {
      diagnostics.push(`X11 active window detection failed: ${errorMessage(error)}.`);
      return null;
    });
    if (x11) return x11;

    return emptyTarget(diagnostics);
  }

  private async captureHyprland(diagnostics: string[]): Promise<LinuxTargetInfo | null> {
    if (!this.env.HYPRLAND_INSTANCE_SIGNATURE || !(await this.hasTool("hyprctl"))) return null;
    const output = await this.execFileText("hyprctl", ["activewindow", "-j"], targetTimeoutMs, { env: this.env });
    const parsed = JSON.parse(output) as {
      class?: string;
      initialClass?: string;
      pid?: number;
      title?: string;
    };
    const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
    const procName = pid ? await this.readProcComm(pid) : undefined;
    return buildTarget({
      appId: parsed.initialClass || parsed.class || procName,
      appName: parsed.class || procName,
      diagnostics,
      pid,
      source: "hyprctl",
      windowTitle: parsed.title
    });
  }

  private async captureX11(diagnostics: string[]): Promise<LinuxTargetInfo | null> {
    if (!this.env.DISPLAY || !(await this.hasTool("xdotool"))) return null;
    const windowId = await this.execFileText("xdotool", ["getactivewindow"], targetTimeoutMs, { env: this.env });
    if (!windowId) return null;

    const [windowTitle, pidText] = await Promise.all([
      this.execFileText("xdotool", ["getwindowname", windowId], targetTimeoutMs, { env: this.env }).catch(() => ""),
      this.execFileText("xdotool", ["getwindowpid", windowId], targetTimeoutMs, { env: this.env }).catch(() => "")
    ]);
    const pid = Number.isFinite(Number(pidText)) ? Number(pidText) : undefined;
    const procName = pid ? await this.readProcComm(pid) : undefined;

    return buildTarget({
      appId: procName,
      appName: procName,
      diagnostics,
      pid,
      source: "xdotool",
      windowTitle
    });
  }

  private async hasTool(tool: "hyprctl" | "xdotool"): Promise<boolean> {
    if (this.tools[tool] !== undefined) return Boolean(this.tools[tool]);
    const available = await this.commandExists(tool);
    this.tools[tool] = available;
    return available;
  }
}

export function detectLinuxDesktopEnvironment(env: NodeJS.ProcessEnv = process.env): LinuxDesktopEnvironment {
  const session = (env.XDG_SESSION_TYPE || "").toLowerCase();
  const currentDesktop = env.XDG_CURRENT_DESKTOP || "";
  const desktopSession = env.DESKTOP_SESSION || "";
  const desktopKey = `${currentDesktop} ${desktopSession}`.toLowerCase();
  const hasWaylandDisplay = Boolean(env.WAYLAND_DISPLAY);
  const hasDisplay = Boolean(env.DISPLAY);
  const sessionType = session === "wayland" || hasWaylandDisplay ? "wayland" : session === "x11" || hasDisplay ? "x11" : "unknown";

  return {
    currentDesktop,
    desktopSession,
    hasDisplay,
    hasWaylandDisplay,
    isGnome: /\bgnome\b/.test(desktopKey),
    isKde: /\bkde\b|plasma/.test(desktopKey),
    isWlroots: /hyprland|sway|river|wayfire|labwc|niri|wlroots/.test(desktopKey) || Boolean(env.HYPRLAND_INSTANCE_SIGNATURE || env.SWAYSOCK),
    sessionType
  };
}

export function pasteShortcutForTarget(target: LinuxTargetInfo, environment: LinuxDesktopEnvironment): "ctrl_v" | "ctrl_shift_v" | "shift_insert" {
  if (target.classification === "terminal") {
    return isKonsole(target) ? "shift_insert" : "ctrl_shift_v";
  }
  if (target.classification === "unknown" && environment.sessionType === "wayland") {
    return "shift_insert";
  }
  return "ctrl_v";
}

export function copyShortcutForTarget(target: LinuxTargetInfo): "ctrl_c" | "ctrl_shift_c" {
  return target.isTerminal ? "ctrl_shift_c" : "ctrl_c";
}

function buildTarget(input: {
  appId?: string;
  appName?: string;
  diagnostics: string[];
  pid?: number;
  source: "hyprctl" | "xdotool";
  windowTitle?: string;
}): LinuxTargetInfo {
  const searchable = [input.appId, input.appName, input.windowTitle].filter(Boolean).join(" ");
  const isTerminal = isTerminalTarget(searchable);
  return {
    ...input,
    classification: isTerminal ? "terminal" : searchable ? "non_terminal" : "unknown",
    isElectron: isElectronTarget(searchable),
    isTerminal
  };
}

function emptyTarget(diagnostics: string[]): LinuxTargetInfo {
  return {
    classification: "unknown",
    diagnostics,
    isElectron: false,
    isTerminal: false
  };
}

function isKonsole(target: LinuxTargetInfo): boolean {
  return /konsole/i.test([target.appId, target.appName, target.windowTitle].filter(Boolean).join(" "));
}

function isElectronTarget(value: string): boolean {
  return /\b(electron|code|visual studio code|discord|slack|teams|signal|obsidian|chromium|chrome)\b/i.test(value);
}

function isTerminalTarget(value: string): boolean {
  return /\b(alacritty|blackbox|cool-retro-term|foot|ghostty|gnome-terminal|kgx|kitty|konsole|mate-terminal|ptyxis|qterminal|rio|st|tabby|terminator|terminal|tilix|urxvt|wezterm|xfce4-terminal|xterm)\b/i.test(
    value
  );
}

async function defaultReadProcComm(pid: number): Promise<string | undefined> {
  try {
    return (await readFile(`/proc/${pid}/comm`, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const typedError = error as { message?: string };
  return typedError.message || String(error);
}
