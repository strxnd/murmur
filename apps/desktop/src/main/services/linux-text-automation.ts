import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { commandExists, execFileText } from "./command";
import {
  copyShortcutForTarget,
  detectLinuxDesktopEnvironment,
  LinuxDesktopTargetService,
  pasteShortcutForTarget,
  type LinuxDesktopEnvironment,
  type LinuxTargetInfo
} from "./linux-desktop-target";
import type {
  AutomationResult,
  ShortcutAutomationBackend,
  TextAutomationBackend,
  TextAutomationBackendId,
  TextAutomationCapability,
  TextAutomationShortcut
} from "./text-automation";
import { XdgRemoteDesktopKeyboardService } from "./xdg-remote-desktop-keyboard";

const shortcutTimeoutMs = 1500;
const unavailableDiagnostic = "Linux keyboard automation unavailable; clipboard-only fallback will be used.";

type LinuxTool = "wtype" | "xdotool" | "ydotool";

interface LinuxCommandAvailability {
  wtype: boolean;
  xdotool: boolean;
  ydotool: boolean;
}

export interface LinuxTextAutomationDependencies {
  accessFile?: (path: string, mode?: number) => Promise<void>;
  commandExists?: (command: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  execFileText?: typeof execFileText;
  helperPaths?: string[];
  platform?: NodeJS.Platform | string;
  portalBackend?: ShortcutAutomationBackend;
  targetService?: LinuxTargetProvider;
}

export interface LinuxTargetProvider {
  capture(): Promise<LinuxTargetInfo>;
  getEnvironment(): LinuxDesktopEnvironment;
}

export class LinuxTextAutomationService implements TextAutomationBackend {
  private readonly accessFile: (path: string, mode?: number) => Promise<void>;
  private readonly commandExists: (command: string) => Promise<boolean>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly execFileText: typeof execFileText;
  private readonly helperPaths: string[];
  private readonly platform: NodeJS.Platform | string;
  private readonly portalBackend: ShortcutAutomationBackend;
  private readonly targetService: LinuxTargetProvider;

  private activeBackend: TextAutomationBackendId = "clipboard_only";
  private availableBackends: TextAutomationBackendId[] = [];
  private baseDiagnostics: string[] = [];
  private commands: LinuxCommandAvailability = { wtype: false, xdotool: false, ydotool: false };
  private helperPath: string | null = null;
  private initialized = false;
  private lastAttemptedBackends: TextAutomationBackendId[] = [];
  private missingTools: string[] = [];
  private runtimeDiagnostics: string[] = [];
  private setupHints: string[] = [];

  constructor(dependencies: LinuxTextAutomationDependencies = {}) {
    this.accessFile = dependencies.accessFile ?? access;
    this.commandExists = dependencies.commandExists ?? commandExists;
    this.env = dependencies.env ?? process.env;
    this.execFileText = dependencies.execFileText ?? execFileText;
    this.platform = dependencies.platform ?? process.platform;
    this.portalBackend = dependencies.portalBackend ?? new XdgRemoteDesktopKeyboardService({ env: this.env, platform: this.platform });
    this.targetService = dependencies.targetService ?? new LinuxDesktopTargetService({ env: this.env, platform: this.platform });
    this.helperPaths = dependencies.helperPaths ?? defaultHelperPaths(this.env);
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    this.runtimeDiagnostics = [];

    if (this.platform !== "linux") {
      this.availableBackends = [];
      this.activeBackend = "clipboard_only";
      this.baseDiagnostics = [unavailableDiagnostic];
      this.missingTools = [];
      this.setupHints = [];
      return;
    }

    const [helperPath, wtype, xdotool, ydotool] = await Promise.all([
      this.findHelperPath(),
      this.commandExists("wtype"),
      this.commandExists("xdotool"),
      this.commandExists("ydotool")
    ]);
    this.helperPath = helperPath;
    this.commands = { wtype, xdotool, ydotool };
    await this.portalBackend.initialize();

    this.availableBackends = this.computeAvailableBackends(this.targetService.getEnvironment());
    this.activeBackend = this.availableBackends[0] ?? "clipboard_only";
    this.missingTools = this.computeMissingTools();
    this.setupHints = this.computeSetupHints();
    this.baseDiagnostics = this.computeBaseDiagnostics();
  }

  dispose(): void {
    this.portalBackend.dispose();
  }

  pasteClipboard(): Promise<AutomationResult> {
    return this.sendShortcut("paste");
  }

  copySelection(): Promise<AutomationResult> {
    return this.sendShortcut("copy");
  }

  getCapability(): TextAutomationCapability {
    return {
      backend: this.activeBackend,
      automationAvailable: this.availableBackends.length > 0,
      permissionRequired: this.availableBackends.some((backend) => backendRequiresPermission(backend)),
      diagnostics: this.getDiagnostics(),
      availableBackends: this.availableBackends,
      attemptedBackends: this.lastAttemptedBackends,
      missingTools: this.missingTools,
      setupHints: this.setupHints
    };
  }

  getDiagnostics(): string[] {
    return uniqueStrings([...this.baseDiagnostics, ...this.portalBackend.getDiagnostics(), ...this.runtimeDiagnostics]);
  }

  private async sendShortcut(action: "paste" | "copy"): Promise<AutomationResult> {
    if (!this.initialized) await this.initialize();

    if (this.platform !== "linux") {
      return this.result(false, "unavailable", unavailableMessage(action), "clipboard_only", []);
    }

    const environment = this.targetService.getEnvironment();
    const target = await this.targetService.capture();
    const shortcut = action === "paste" ? pasteShortcutForTarget(target, environment) : copyShortcutForTarget(target);
    const candidates = this.orderedBackends(environment, target).filter((backend) => this.isBackendAvailable(backend, environment));
    const attempted: TextAutomationBackendId[] = [];
    const failures: string[] = [];
    this.lastAttemptedBackends = [];

    for (const backend of candidates) {
      attempted.push(backend);
      this.lastAttemptedBackends = [...attempted];
      try {
        const result = await this.runBackend(backend, shortcut, action);
        if (result.success) {
          this.activeBackend = backend;
          this.addRuntimeDiagnostic(successDiagnostic(backend, shortcut, action, target));
          return {
            ...result,
            backend,
            attemptedBackends: attempted,
            diagnostics: this.getDiagnostics()
          };
        }
        failures.push(`${backendLabel(backend)}: ${result.message}`);
        this.addRuntimeDiagnostic(`${backendLabel(backend)} failed: ${result.message}`);
      } catch (error) {
        const message = errorMessage(error);
        failures.push(`${backendLabel(backend)}: ${message}`);
        this.addRuntimeDiagnostic(`${backendLabel(backend)} failed: ${message}`);
      }
    }

    const message =
      failures.length > 0
        ? failedMessage(action, failures.at(-1) ?? failures.join("; "))
        : unavailableMessage(action);
    return this.result(false, failures.length > 0 ? "failed" : "unavailable", message, "clipboard_only", attempted);
  }

  private async runBackend(
    backend: TextAutomationBackendId,
    shortcut: TextAutomationShortcut,
    action: "paste" | "copy"
  ): Promise<AutomationResult> {
    if (backend === "linux_native_helper") {
      await this.runNativeHelper(shortcut);
      return this.result(true, "success", `${backendLabel(backend)} sent ${shortcutLabel(shortcut)}.`, backend, [backend]);
    }

    if (backend === "wtype") {
      await this.execFileText("wtype", wtypeArgs(shortcut), shortcutTimeoutMs, { env: this.env });
      return this.result(true, "success", `${backendLabel(backend)} sent ${shortcutLabel(shortcut)}.`, backend, [backend]);
    }

    if (backend === "xdotool") {
      await this.execFileText("xdotool", ["key", "--clearmodifiers", xdotoolKey(shortcut)], shortcutTimeoutMs, { env: this.env });
      return this.result(true, "success", `${backendLabel(backend)} sent ${shortcutLabel(shortcut)}.`, backend, [backend]);
    }

    if (backend === "ydotool") {
      await this.execFileText("ydotool", ["key", "-d", "12", ...ydotoolKeyEvents(shortcut)], shortcutTimeoutMs, { env: this.env });
      return this.result(true, "success", `${backendLabel(backend)} sent ${shortcutLabel(shortcut)}.`, backend, [backend]);
    }

    if (backend === "xdg_remote_desktop_keyboard") {
      return this.portalBackend.sendKeyboardShortcut(shortcut, action);
    }

    return this.result(false, "unavailable", unavailableMessage(action), backend, [backend]);
  }

  private async runNativeHelper(shortcut: TextAutomationShortcut): Promise<void> {
    if (!this.helperPath) throw new Error("Linux native text automation helper is not built.");
    await this.execFileText(this.helperPath, ["--shortcut", helperShortcut(shortcut)], shortcutTimeoutMs, { env: this.env });
  }

  private orderedBackends(environment: LinuxDesktopEnvironment, _target: LinuxTargetInfo): TextAutomationBackendId[] {
    if (environment.sessionType === "x11") {
      return ["linux_native_helper", "xdotool", "ydotool", "xdg_remote_desktop_keyboard"];
    }

    if (environment.sessionType === "wayland" && environment.isWlroots) {
      return ["wtype", "linux_native_helper", "xdg_remote_desktop_keyboard", "xdotool", "ydotool"];
    }

    if (environment.sessionType === "wayland" && (environment.isGnome || environment.isKde)) {
      return ["linux_native_helper", "xdg_remote_desktop_keyboard", "xdotool", "ydotool", "wtype"];
    }

    if (environment.sessionType === "wayland") {
      return ["linux_native_helper", "xdg_remote_desktop_keyboard", "wtype", "xdotool", "ydotool"];
    }

    return ["linux_native_helper", "xdotool", "wtype", "xdg_remote_desktop_keyboard", "ydotool"];
  }

  private isBackendAvailable(backend: TextAutomationBackendId, environment: LinuxDesktopEnvironment): boolean {
    if (backend === "linux_native_helper") return Boolean(this.helperPath);
    if (backend === "wtype") return this.commands.wtype && environment.hasWaylandDisplay;
    if (backend === "xdotool") return this.commands.xdotool && environment.hasDisplay;
    if (backend === "ydotool") return this.commands.ydotool;
    if (backend === "xdg_remote_desktop_keyboard") return this.portalBackend.getCapability().automationAvailable;
    return false;
  }

  private computeAvailableBackends(environment: LinuxDesktopEnvironment): TextAutomationBackendId[] {
    return uniqueBackends(this.orderedBackends(environment, emptyTarget()).filter((backend) => this.isBackendAvailable(backend, environment)));
  }

  private computeMissingTools(): string[] {
    const missing: string[] = [];
    for (const tool of ["wtype", "xdotool", "ydotool"] satisfies LinuxTool[]) {
      if (!this.commands[tool]) missing.push(tool);
    }
    if (!this.helperPath) missing.push("linux-fast-paste");
    return missing;
  }

  private computeSetupHints(): string[] {
    const hints: string[] = [];
    if (!this.helperPath) hints.push("Run bun run linux-helper:build to build the optional native Linux keyboard helper.");
    if (this.commands.ydotool) hints.push("ydotool requires ydotoold and access to /dev/uinput before it can emit keys.");
    if (!this.commands.wtype) hints.push("Install wtype for wlroots compositors such as Sway and Hyprland.");
    if (!this.commands.xdotool) hints.push("Install xdotool for X11 and XWayland targets.");
    return hints;
  }

  private computeBaseDiagnostics(): string[] {
    const diagnostics = [
      this.helperPath
        ? `Linux native text automation helper available: ${this.helperPath}.`
        : "Linux native text automation helper unavailable; tool and portal fallbacks will be used.",
      this.commands.wtype ? "wtype keyboard automation available." : "wtype keyboard automation unavailable.",
      this.commands.xdotool ? "xdotool keyboard automation available." : "xdotool keyboard automation unavailable.",
      this.commands.ydotool ? "ydotool keyboard automation available." : "ydotool keyboard automation unavailable."
    ];
    if (this.availableBackends.length === 0) diagnostics.push(unavailableDiagnostic);
    return diagnostics;
  }

  private async findHelperPath(): Promise<string | null> {
    for (const helperPath of this.helperPaths) {
      if (!helperPath) continue;
      try {
        await this.accessFile(helperPath, constants.X_OK);
        return helperPath;
      } catch {
        // Try the next candidate path.
      }
    }
    return null;
  }

  private addRuntimeDiagnostic(message: string): void {
    if (this.runtimeDiagnostics.includes(message)) return;
    this.runtimeDiagnostics.push(message);
    if (this.runtimeDiagnostics.length > 20) {
      this.runtimeDiagnostics = this.runtimeDiagnostics.slice(-20);
    }
  }

  private result(
    success: boolean,
    status: AutomationResult["status"],
    message: string,
    backend: TextAutomationBackendId,
    attemptedBackends: TextAutomationBackendId[]
  ): AutomationResult {
    return {
      success,
      status,
      message,
      backend,
      attemptedBackends,
      diagnostics: this.getDiagnostics()
    };
  }
}

function defaultHelperPaths(env: NodeJS.ProcessEnv): string[] {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  return [
    env.MURMUR_LINUX_FAST_PASTE ?? "",
    processWithResources.resourcesPath ? join(processWithResources.resourcesPath, "bin", "linux-fast-paste") : "",
    join(process.cwd(), "resources", "bin", "linux-fast-paste"),
    join(process.cwd(), "..", "..", "resources", "bin", "linux-fast-paste")
  ];
}

function wtypeArgs(shortcut: TextAutomationShortcut): string[] {
  if (shortcut === "ctrl_v") return ["-M", "ctrl", "v", "-m", "ctrl"];
  if (shortcut === "ctrl_shift_v") return ["-M", "ctrl", "-M", "shift", "v", "-m", "shift", "-m", "ctrl"];
  if (shortcut === "shift_insert") return ["-M", "shift", "-P", "Insert", "-p", "Insert", "-m", "shift"];
  if (shortcut === "ctrl_shift_c") return ["-M", "ctrl", "-M", "shift", "c", "-m", "shift", "-m", "ctrl"];
  return ["-M", "ctrl", "c", "-m", "ctrl"];
}

function xdotoolKey(shortcut: TextAutomationShortcut): string {
  if (shortcut === "ctrl_v") return "ctrl+v";
  if (shortcut === "ctrl_shift_v") return "ctrl+shift+v";
  if (shortcut === "shift_insert") return "shift+Insert";
  if (shortcut === "ctrl_shift_c") return "ctrl+shift+c";
  return "ctrl+c";
}

function ydotoolKeyEvents(shortcut: TextAutomationShortcut): string[] {
  if (shortcut === "ctrl_v") return ["29:1", "47:1", "47:0", "29:0"];
  if (shortcut === "ctrl_shift_v") return ["29:1", "42:1", "47:1", "47:0", "42:0", "29:0"];
  if (shortcut === "shift_insert") return ["42:1", "110:1", "110:0", "42:0"];
  if (shortcut === "ctrl_shift_c") return ["29:1", "42:1", "46:1", "46:0", "42:0", "29:0"];
  return ["29:1", "46:1", "46:0", "29:0"];
}

function helperShortcut(shortcut: TextAutomationShortcut): string {
  return shortcut.replaceAll("_", "-");
}

function shortcutLabel(shortcut: TextAutomationShortcut): string {
  return helperShortcut(shortcut);
}

function backendRequiresPermission(backend: TextAutomationBackendId): boolean {
  return backend === "linux_native_helper" || backend === "ydotool" || backend === "xdg_remote_desktop_keyboard";
}

function backendLabel(backend: TextAutomationBackendId): string {
  if (backend === "linux_native_helper") return "Linux native helper";
  if (backend === "xdg_remote_desktop_keyboard") return "XDG RemoteDesktop keyboard portal";
  return backend;
}

function successDiagnostic(
  backend: TextAutomationBackendId,
  shortcut: TextAutomationShortcut,
  action: "paste" | "copy",
  target: LinuxTargetInfo
): string {
  const targetLabel = target.appName || target.appId || target.windowTitle || "active window";
  return `${backendLabel(backend)} sent ${shortcutLabel(shortcut)} for ${action} to ${targetLabel}.`;
}

function unavailableMessage(action: "paste" | "copy"): string {
  return action === "paste"
    ? "No Linux keyboard automation backend is available; output copied to clipboard."
    : "No Linux keyboard automation backend is available; selected text capture skipped.";
}

function failedMessage(action: "paste" | "copy", reason: string): string {
  return action === "paste"
    ? `Paste automation failed; output left on clipboard. ${reason}`
    : `Selected text automation failed. ${reason}`;
}

function emptyTarget(): LinuxTargetInfo {
  return {
    diagnostics: [],
    isElectron: false,
    isTerminal: false
  };
}

function uniqueBackends(backends: TextAutomationBackendId[]): TextAutomationBackendId[] {
  return [...new Set(backends)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const typedError = error as { message?: string; name?: string };
  if (typedError.name && typedError.message) return `${typedError.name}: ${typedError.message}`;
  return typedError.message || String(error);
}
