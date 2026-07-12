import { describe, expect, it, vi } from "vitest";
import { LinuxTextAutomationService, type LinuxTargetProvider } from "./linux-text-automation";
import type {
  AutomationResult,
  ShortcutAutomationBackend,
  TextAutomationBackendId,
  TextAutomationCapability,
  TextAutomationShortcut
} from "./text-automation";

interface ExecCall {
  args: string[];
  command: string;
}

class FakePortalBackend implements ShortcutAutomationBackend {
  shortcuts: TextAutomationShortcut[] = [];
  capability: TextAutomationCapability = {
    backend: "clipboard_only",
    automationAvailable: false,
    permissionRequired: false,
    diagnostics: ["portal unavailable"]
  };

  async initialize(): Promise<void> {}
  dispose(): void {}
  async pasteClipboard(): Promise<AutomationResult> {
    return this.sendKeyboardShortcut("ctrl_v", "paste");
  }
  async copySelection(): Promise<AutomationResult> {
    return this.sendKeyboardShortcut("ctrl_c", "copy");
  }
  async sendKeyboardShortcut(shortcut: TextAutomationShortcut, action: "paste" | "copy"): Promise<AutomationResult> {
    this.shortcuts.push(shortcut);
    return {
      success: this.capability.automationAvailable,
      status: this.capability.automationAvailable ? "success" : "unavailable",
      message: `${action} ${shortcut}`,
      diagnostics: this.capability.diagnostics,
      backend: this.capability.backend
    };
  }
  getCapability(): TextAutomationCapability {
    return this.capability;
  }
  getDiagnostics(): string[] {
    return this.capability.diagnostics;
  }
}

describe("LinuxTextAutomationService", () => {
  it("uses wtype first on wlroots Wayland desktops", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: {
        WAYLAND_DISPLAY: "wayland-1",
        XDG_CURRENT_DESKTOP: "Hyprland",
        XDG_SESSION_TYPE: "wayland"
      },
      tools: ["wtype"]
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({ success: true, backend: "wtype", attemptedBackends: ["wtype"] });
    expect(calls).toEqual([{ command: "wtype", args: ["-M", "ctrl", "v", "-m", "ctrl"] }]);
  });

  it("uses terminal-safe paste and copy shortcuts", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: {
        WAYLAND_DISPLAY: "wayland-1",
        XDG_CURRENT_DESKTOP: "sway",
        XDG_SESSION_TYPE: "wayland"
      },
      target: {
        appName: "kitty",
        diagnostics: [],
        isElectron: false,
        isTerminal: true,
        windowTitle: "kitty"
      },
      tools: ["wtype"]
    });

    await service.initialize();
    await service.pasteClipboard();
    await service.copySelection();

    expect(calls).toEqual([
      { command: "wtype", args: ["-M", "ctrl", "-M", "shift", "v", "-m", "shift", "-m", "ctrl"] },
      { command: "wtype", args: ["-M", "ctrl", "-M", "shift", "c", "-m", "shift", "-m", "ctrl"] }
    ]);
  });

  it("falls back from xdotool to ydotool on X11", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: {
        DISPLAY: ":0",
        XDG_SESSION_TYPE: "x11"
      },
      failCommands: ["xdotool"],
      tools: ["xdotool", "ydotool"]
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({ success: true, backend: "ydotool", attemptedBackends: ["xdotool", "ydotool"] });
    expect(calls).toEqual([
      { command: "xdotool", args: ["key", "--clearmodifiers", "ctrl+v"] },
      { command: "ydotool", args: ["key", "-d", "12", "29:1", "47:1", "47:0", "29:0"] }
    ]);
  });

  it("uses the portal with the selected shortcut when tools are unavailable", async () => {
    const portal = new FakePortalBackend();
    portal.capability = {
      backend: "xdg_remote_desktop_keyboard",
      automationAvailable: true,
      permissionRequired: true,
      diagnostics: ["portal ready"]
    };
    const service = createService({
      env: {
        WAYLAND_DISPLAY: "wayland-1",
        XDG_CURRENT_DESKTOP: "GNOME",
        XDG_SESSION_TYPE: "wayland"
      },
      portal,
      target: {
        appName: "gnome-terminal",
        diagnostics: [],
        isElectron: false,
        isTerminal: true,
        windowTitle: "Terminal"
      }
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({ success: true, backend: "xdg_remote_desktop_keyboard" });
    expect(portal.shortcuts).toEqual(["ctrl_shift_v"]);
  });

  it("uses the native helper before tool fallbacks when it is executable", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: {
        DISPLAY: ":0",
        XDG_SESSION_TYPE: "x11"
      },
      helperPath: "/tmp/linux-fast-paste",
      target: {
        appName: "konsole",
        diagnostics: [],
        isElectron: false,
        isTerminal: true,
        windowTitle: "konsole"
      },
      tools: ["xdotool"]
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({ success: true, backend: "linux_native_helper", attemptedBackends: ["linux_native_helper"] });
    expect(calls).toEqual([{ command: "/tmp/linux-fast-paste", args: ["--shortcut", "shift-insert"] }]);
  });

  it("reports clipboard-only fallback when no backend is available", async () => {
    const service = createService();

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({ success: false, status: "unavailable", backend: "clipboard_only" });
    expect(service.getCapability()).toMatchObject({
      automationAvailable: false,
      availableBackends: [],
      backend: "clipboard_only"
    });
  });
});

function createService(options: {
  calls?: ExecCall[];
  env?: NodeJS.ProcessEnv;
  failCommands?: string[];
  helperPath?: string;
  portal?: FakePortalBackend;
  target?: Awaited<ReturnType<LinuxTargetProvider["capture"]>>;
  tools?: string[];
} = {}): LinuxTextAutomationService {
  const env = options.env ?? {};
  const tools = new Set(options.tools ?? []);
  const failCommands = new Set(options.failCommands ?? []);
  const calls = options.calls ?? [];
  const portal = options.portal ?? new FakePortalBackend();
  const target =
    options.target ??
    ({
      appName: "gedit",
      diagnostics: [],
      isElectron: false,
      isTerminal: false,
      windowTitle: "gedit"
    } satisfies Awaited<ReturnType<LinuxTargetProvider["capture"]>>);
  const targetProvider: LinuxTargetProvider = {
    async capture() {
      return target;
    },
    getEnvironment() {
      const session = (env.XDG_SESSION_TYPE || "").toLowerCase();
      const desktop = `${env.XDG_CURRENT_DESKTOP || ""} ${env.DESKTOP_SESSION || ""}`.toLowerCase();
      return {
        currentDesktop: env.XDG_CURRENT_DESKTOP || "",
        desktopSession: env.DESKTOP_SESSION || "",
        hasDisplay: Boolean(env.DISPLAY),
        hasWaylandDisplay: Boolean(env.WAYLAND_DISPLAY),
        isGnome: desktop.includes("gnome"),
        isKde: desktop.includes("kde") || desktop.includes("plasma"),
        isWlroots: /hyprland|sway|wlroots/.test(desktop),
        sessionType: session === "wayland" || env.WAYLAND_DISPLAY ? "wayland" : session === "x11" || env.DISPLAY ? "x11" : "unknown"
      };
    }
  };

  return new LinuxTextAutomationService({
    accessFile: async (path) => {
      if (path === options.helperPath) return;
      throw new Error("missing helper");
    },
    commandExists: async (command) => tools.has(command),
    env,
    execFileText: vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (failCommands.has(command)) throw new Error(`${command} failed`);
      return "";
    }),
    helperPaths: options.helperPath ? [options.helperPath] : [],
    platform: "linux",
    portalBackend: portal,
    targetService: targetProvider
  });
}
