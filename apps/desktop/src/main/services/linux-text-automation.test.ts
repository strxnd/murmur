import { describe, expect, it, vi } from "vitest";
import { ExecFileTextError } from "./command";
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
  nextResult: AutomationResult | null = null;
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
    if (this.nextResult) return this.nextResult;
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
        classification: "terminal",
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
        classification: "terminal",
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
        classification: "terminal",
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

  it("uses Shift+Insert for an unclassified native Wayland target", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: {
        WAYLAND_DISPLAY: "wayland-1",
        XDG_CURRENT_DESKTOP: "GNOME",
        XDG_SESSION_TYPE: "wayland"
      },
      target: {
        classification: "unknown",
        diagnostics: ["Native GNOME target metadata unavailable."],
        isElectron: false,
        isTerminal: false
      },
      tools: ["wtype"]
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({ success: true, backend: "wtype" });
    expect(calls).toEqual([{ command: "wtype", args: ["-M", "shift", "-P", "Insert", "-p", "Insert", "-m", "shift"] }]);
  });

  it("does not retry paste after an external backend reports ambiguous delivery", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      ambiguousCommands: ["xdotool"],
      calls,
      env: {
        DISPLAY: ":0",
        XDG_SESSION_TYPE: "x11"
      },
      tools: ["xdotool", "ydotool"]
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({
      success: false,
      backend: "xdotool",
      attemptedBackends: ["xdotool"],
      failureDelivery: "ambiguous"
    });
    expect(calls).toEqual([{ command: "xdotool", args: ["key", "--clearmodifiers", "ctrl+v"] }]);
  });

  it("does not retry paste after the portal partially dispatches a shortcut", async () => {
    const calls: ExecCall[] = [];
    const portal = new FakePortalBackend();
    portal.capability = {
      backend: "xdg_remote_desktop_keyboard",
      automationAvailable: true,
      permissionRequired: true,
      diagnostics: ["portal ready"]
    };
    portal.nextResult = {
      success: false,
      status: "failed",
      message: "modifier dispatched before the portal connection failed",
      diagnostics: ["portal failed"],
      failureDelivery: "partial"
    };
    const service = createService({
      calls,
      env: {
        WAYLAND_DISPLAY: "wayland-1",
        XDG_CURRENT_DESKTOP: "GNOME",
        XDG_SESSION_TYPE: "wayland"
      },
      portal,
      tools: ["wtype"]
    });

    await service.initialize();
    const result = await service.pasteClipboard();

    expect(result).toMatchObject({
      success: false,
      backend: "xdg_remote_desktop_keyboard",
      attemptedBackends: ["xdg_remote_desktop_keyboard"],
      failureDelivery: "partial"
    });
    expect(calls).toEqual([]);
  });

  it("does not advertise the native helper without write access to uinput", async () => {
    const service = createService({
      env: {
        DISPLAY: ":0",
        XDG_SESSION_TYPE: "x11"
      },
      helperPath: "/tmp/linux-fast-paste",
      uinputAccessible: false
    });

    await service.initialize();

    expect(service.getCapability()).toMatchObject({
      automationAvailable: false,
      availableBackends: [],
      backend: "clipboard_only"
    });
    expect(service.getDiagnostics()).toContain(
      "Linux native text automation helper cannot access /dev/uinput; tool and portal fallbacks will be used."
    );
    expect(service.getCapability().setupHints).toContain(
      "Grant the current user write access to /dev/uinput before using the Linux native keyboard helper."
    );
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
  ambiguousCommands?: string[];
  failCommands?: string[];
  helperPath?: string;
  uinputAccessible?: boolean;
  portal?: FakePortalBackend;
  target?: Awaited<ReturnType<LinuxTargetProvider["capture"]>>;
  tools?: string[];
} = {}): LinuxTextAutomationService {
  const env = options.env ?? {};
  const tools = new Set(options.tools ?? []);
  const ambiguousCommands = new Set(options.ambiguousCommands ?? []);
  const failCommands = new Set(options.failCommands ?? []);
  const calls = options.calls ?? [];
  const portal = options.portal ?? new FakePortalBackend();
  const target =
    options.target ??
    ({
      appName: "gedit",
      classification: "non_terminal",
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
      if (path === "/dev/uinput" && options.uinputAccessible !== false) return;
      throw new Error("path unavailable");
    },
    commandExists: async (command) => tools.has(command),
    env,
    execFileText: vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (failCommands.has(command)) throw new ExecFileTextError(`${command} failed before dispatch`, "spawn");
      if (ambiguousCommands.has(command)) throw new ExecFileTextError(`${command} failed after dispatch`, "exit");
      return "";
    }),
    helperPaths: options.helperPath ? [options.helperPath] : [],
    platform: "linux",
    portalBackend: portal,
    targetService: targetProvider
  });
}
