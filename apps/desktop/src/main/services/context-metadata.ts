import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as dbusNative from "@homebridge/dbus-native";
import type { BusConnection, MessageBus } from "@homebridge/dbus-native";
import type { ContextSnapshot } from "../../shared/types";
import { commandExists, execFileText } from "./command";
import { MacosAutomationHelper } from "./macos-automation-helper";
import { detectNativeShortcutBackends } from "./native-global-shortcuts";

const metadataTimeoutMs = 1200;
const kdeTimeoutMs = 3000;
const dbusServiceName = "dev.murmur.Context";
const dbusObjectPath = "/dev/murmur/Context";
const dbusInterfaceName = "dev.murmur.Context";
const dbusRequestNameDoNotQueue = 4;
const dbusRequestNamePrimaryOwner = 1;
const dbusRequestNameAlreadyOwner = 4;

export type ContextMetadataBackend = "x11" | "hyprland" | "gnome_shell" | "kde_kwin" | "macos_accessibility_helper";

export interface ContextCommandAvailability {
  gdbus: boolean;
  gnomeShellEval?: boolean;
  hyprctl: boolean;
  qdbus: boolean;
  qdbus6: boolean;
  xdotool: boolean;
  xprop: boolean;
}

type ActiveWindowMetadata = Pick<ContextSnapshot, "appName" | "appId" | "windowId" | "windowTitle">;

type ContextEnv = Partial<
  Record<"DBUS_SESSION_BUS_ADDRESS" | "HYPRLAND_INSTANCE_SIGNATURE" | "XDG_CURRENT_DESKTOP" | "XDG_SESSION_TYPE", string>
>;

type DbusNativeModule = typeof dbusNative & {
  sessionBus: (options?: Record<string, unknown>) => ContextMessageBus;
};

type ContextBusConnection = BusConnection & {
  end?: () => void;
};

type ContextMessageBus = MessageBus & {
  connection: ContextBusConnection;
  exportInterface?: (implementation: Record<string, (...args: unknown[]) => unknown>, path: string, iface: DbusExportedInterface) => void;
  releaseName?: (name: string, callback: (error?: DbusError) => void) => void;
  requestName?: (name: string, flags: number, callback: (error?: DbusError, result?: number) => void) => void;
};

interface DbusExportedInterface {
  name: string;
  methods: Record<string, [string, string]>;
}

interface DbusError {
  name?: string;
  message?: unknown;
}

interface PendingKdeRequest {
  reject: (error: Error) => void;
  resolve: (metadata: ActiveWindowMetadata | null) => void;
  timer: NodeJS.Timeout;
}

const dbus = dbusNative as DbusNativeModule;

type MacosMetadataHelper = Pick<MacosAutomationHelper, "activeWindow" | "status">;

export class DesktopMetadataService {
  private backends: ContextMetadataBackend[] = [];
  private commands: ContextCommandAvailability = emptyCommandAvailability();
  private diagnostics: string[] = [];
  private kdeBus: ContextMessageBus | null = null;
  private kdeCallbackServiceExported = false;
  private kdeCallbackServiceRequested = false;
  private pendingKdeRequests = new Map<string, PendingKdeRequest>();

  constructor(
    private readonly macosHelper: MacosMetadataHelper = new MacosAutomationHelper(),
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async initialize(): Promise<void> {
    this.commands = await detectCommandAvailability(process.env, this.platform);
    const macosHelperAvailable = this.platform === "darwin" && this.macosHelper.status().helperAvailable;
    this.backends = detectContextMetadataBackends({
      commands: this.commands,
      env: process.env,
      platform: this.platform,
      macosHelperAvailable
    });
    this.diagnostics = metadataDiagnostics(this.backends, this.commands, process.env, this.platform);
  }

  dispose(): void {
    for (const [token, pending] of this.pendingKdeRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Desktop metadata capture was cancelled."));
      this.pendingKdeRequests.delete(token);
    }
    if (this.kdeCallbackServiceRequested && this.kdeBus?.releaseName) {
      this.kdeBus.releaseName(dbusServiceName, () => undefined);
    }
    this.kdeBus?.connection.end?.();
    this.kdeBus = null;
    this.kdeCallbackServiceExported = false;
    this.kdeCallbackServiceRequested = false;
  }

  getDiagnostics(): string[] {
    return this.diagnostics;
  }

  hasAppMetadataProvider(): boolean {
    return this.backends.length > 0;
  }

  async capture(diagnostics: string[]): Promise<ActiveWindowMetadata> {
    if (this.backends.length === 0) {
      diagnostics.push(this.diagnostics[0] ?? "Active app metadata unavailable: no supported desktop metadata provider was detected.");
      return {};
    }

    for (const backend of this.backends) {
      try {
        const metadata = await this.captureWithBackend(backend);
        if (metadata && hasActiveWindowMetadata(metadata)) return metadata;
        diagnostics.push(`${backendLabel(backend)} did not return an active window.`);
      } catch (error) {
        diagnostics.push(`${backendLabel(backend)} active app metadata failed: ${errorMessage(error)}.`);
        if (backend === "macos_accessibility_helper") this.refreshMacosHelperAvailability();
      }
    }

    return {};
  }

  private refreshMacosHelperAvailability(): void {
    const status = this.macosHelper.status();
    if (status.helperAvailable) return;
    this.backends = this.backends.filter((backend) => backend !== "macos_accessibility_helper");
    this.diagnostics = status.diagnostics.length
      ? status.diagnostics.map((diagnostic) => `Active app metadata unavailable: ${diagnostic}`)
      : ["Active app metadata unavailable: macOS automation helper was not found."];
  }

  private captureWithBackend(backend: ContextMetadataBackend): Promise<ActiveWindowMetadata | null> {
    if (backend === "x11") return captureX11ActiveWindow();
    if (backend === "hyprland") return captureHyprlandActiveWindow();
    if (backend === "gnome_shell") return captureGnomeShellActiveWindow();
    if (backend === "macos_accessibility_helper") return captureMacosActiveWindow(this.macosHelper);
    return this.captureKdeActiveWindow();
  }

  private async captureKdeActiveWindow(): Promise<ActiveWindowMetadata | null> {
    const qdbusCommand = this.commands.qdbus6 ? "qdbus6" : this.commands.qdbus ? "qdbus" : null;
    if (!qdbusCommand) throw new Error("qdbus/qdbus6 is unavailable.");
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error("No D-Bus session bus is available.");

    await this.ensureKdeCallbackService();

    const token = randomBytes(8).toString("hex");
    const scriptName = `murmurActiveWindow${token}`;
    const scriptDir = mkdtempSync(join(tmpdir(), "murmur-kwin-context-"));
    const scriptPath = join(scriptDir, "active-window.js");
    writeFileSync(scriptPath, kdeActiveWindowScript(token));

    const request = this.createKdeRequest(token);
    let scriptId: string | null = null;
    let runError: unknown;

    try {
      await execFileText(qdbusCommand, ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", scriptName], metadataTimeoutMs).catch(
        () => undefined
      );
      const loadOutput = await execFileText(
        qdbusCommand,
        ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", scriptPath, scriptName],
        metadataTimeoutMs
      );
      scriptId = parseKdeScriptId(loadOutput);
      if (scriptId) {
        await execFileText(qdbusCommand, ["org.kde.KWin", `/Scripting/Script${scriptId}`, "org.kde.kwin.Script.run"], metadataTimeoutMs);
      } else {
        await execFileText(qdbusCommand, ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.start"], metadataTimeoutMs);
      }
    } catch (error) {
      runError = error;
    }

    if (runError) {
      this.clearKdeRequest(token);
      await this.cleanupKdeScript(qdbusCommand, scriptName, scriptId).catch(() => undefined);
      rmSync(scriptDir, { recursive: true, force: true });
      throw runError;
    }

    try {
      return await request.promise;
    } finally {
      this.clearKdeRequest(token);
      await this.cleanupKdeScript(qdbusCommand, scriptName, scriptId).catch(() => undefined);
      rmSync(scriptDir, { recursive: true, force: true });
    }
  }

  private createKdeRequest(token: string): { promise: Promise<ActiveWindowMetadata | null> } {
    const promise = new Promise<ActiveWindowMetadata | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingKdeRequests.delete(token);
        reject(new Error("Timed out waiting for KWin active window metadata."));
      }, kdeTimeoutMs);
      timer.unref();
      this.pendingKdeRequests.set(token, { reject, resolve, timer });
    });

    return { promise };
  }

  private clearKdeRequest(token: string): void {
    const pending = this.pendingKdeRequests.get(token);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingKdeRequests.delete(token);
  }

  private async cleanupKdeScript(qdbusCommand: "qdbus" | "qdbus6", scriptName: string, scriptId: string | null): Promise<void> {
    if (scriptId) {
      await execFileText(qdbusCommand, ["org.kde.KWin", `/Scripting/Script${scriptId}`, "org.kde.kwin.Script.stop"], metadataTimeoutMs).catch(
        () => undefined
      );
    }
    await execFileText(qdbusCommand, ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", scriptName], metadataTimeoutMs).catch(
      () => undefined
    );
  }

  private async ensureKdeCallbackService(): Promise<void> {
    const bus = this.getKdeBus();
    if (!this.kdeCallbackServiceRequested) {
      const requestResult = await this.requestName(bus, dbusServiceName);
      if (requestResult !== dbusRequestNamePrimaryOwner && requestResult !== dbusRequestNameAlreadyOwner) {
        throw new Error(`D-Bus name ${dbusServiceName} is already owned.`);
      }
      this.kdeCallbackServiceRequested = true;
    }

    if (this.kdeCallbackServiceExported) return;
    if (!bus.exportInterface) {
      throw new Error("@homebridge/dbus-native does not expose D-Bus service export support.");
    }

    bus.exportInterface(
      {
        ReportActiveWindow: (payload: unknown) => this.handleKdeActiveWindowReport(payload)
      },
      dbusObjectPath,
      {
        name: dbusInterfaceName,
        methods: {
          ReportActiveWindow: ["s", ""]
        }
      }
    );
    this.kdeCallbackServiceExported = true;
  }

  private handleKdeActiveWindowReport(payload: unknown): void {
    if (typeof payload !== "string") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }

    const token = cleanString(parsed.token);
    if (!token) return;
    const pending = this.pendingKdeRequests.get(token);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingKdeRequests.delete(token);
    pending.resolve(normalizeActiveWindowMetadata(parsed));
  }

  private getKdeBus(): ContextMessageBus {
    if (this.kdeBus) return this.kdeBus;
    this.kdeBus = dbus.sessionBus({ ReturnLongjs: false });
    return this.kdeBus;
  }

  private requestName(bus: ContextMessageBus, name: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!bus.requestName) {
        reject(new Error("@homebridge/dbus-native does not expose D-Bus name ownership support."));
        return;
      }

      const timer = setTimeout(() => reject(new Error(`Timed out requesting D-Bus name ${name}.`)), metadataTimeoutMs);
      timer.unref();
      bus.requestName(name, dbusRequestNameDoNotQueue, (error, result) => {
        clearTimeout(timer);
        if (error) {
          reject(new Error(`${error.name ?? "D-Bus error"}: ${String(error.message ?? "")}`));
          return;
        }
        resolve(result ?? 0);
      });
    });
  }
}

export function detectContextMetadataBackends({
  commands = emptyCommandAvailability(),
  env = process.env,
  platform = process.platform,
  macosHelperAvailable = false
}: {
  commands?: Partial<ContextCommandAvailability>;
  env?: ContextEnv;
  platform?: NodeJS.Platform;
  macosHelperAvailable?: boolean;
} = {}): ContextMetadataBackend[] {
  if (platform === "darwin") return macosHelperAvailable ? ["macos_accessibility_helper"] : [];
  if (platform !== "linux") return [];

  const backends: ContextMetadataBackend[] = [];
  const sessionType = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const nativeBackends = detectNativeShortcutBackends(env, platform);

  if (sessionType === "x11" && commands.xdotool && commands.xprop) {
    backends.push("x11");
  }

  if (nativeBackends.includes("hyprland_bind") && commands.hyprctl) {
    backends.push("hyprland");
  }

  if (nativeBackends.includes("gnome_custom_shortcut") && commands.gdbus && commands.gnomeShellEval !== false) {
    backends.push("gnome_shell");
  }

  if (nativeBackends.includes("kde_kglobalaccel") && (commands.qdbus6 || commands.qdbus) && env.DBUS_SESSION_BUS_ADDRESS) {
    backends.push("kde_kwin");
  }

  return [...new Set(backends)];
}

export function parseHyprlandActiveWindow(output: string): ActiveWindowMetadata | null {
  const parsed = JSON.parse(output) as Record<string, unknown>;
  return normalizeActiveWindowMetadata({
    appId: parsed.class ?? parsed.initialClass,
    appName: parsed.class ?? parsed.initialClass,
    windowId: parsed.address,
    windowTitle: parsed.title ?? parsed.initialTitle
  });
}

export function parseGnomeShellEvalOutput(output: string): ActiveWindowMetadata | null {
  const tuple = parseGvariantBooleanStringTuple(output);
  if (!tuple?.ok || !tuple.value) return null;
  const parsed = JSON.parse(tuple.value) as Record<string, unknown>;
  return normalizeActiveWindowMetadata(parsed);
}

export function parseX11ActiveWindow(titleOutput: string, xpropOutput: string, windowId?: string): ActiveWindowMetadata | null {
  const classNames = parseWmClass(xpropOutput);
  return normalizeActiveWindowMetadata({
    appId: classNames[1] ?? classNames[0],
    appName: classNames[1] ?? classNames[0],
    windowId,
    windowTitle: titleOutput
  });
}

function metadataDiagnostics(
  backends: ContextMetadataBackend[],
  commands: ContextCommandAvailability,
  env: ContextEnv,
  platform: NodeJS.Platform
): string[] {
  if (platform === "darwin") {
    return backends.length > 0
      ? ["Active app metadata available via macOS automation helper."]
      : ["Active app metadata unavailable: macOS automation helper was not found."];
  }

  if (platform !== "linux") {
    return ["Active app metadata unavailable: desktop metadata providers are only implemented for Linux sessions."];
  }

  if (backends.length > 0) {
    return [`Active app metadata available via ${backends.map(backendLabel).join(", ")}.`];
  }

  const nativeBackends = detectNativeShortcutBackends(env, platform);
  const sessionType = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const diagnostics = ["Active app metadata unavailable: no supported desktop metadata provider was detected."];

  if (sessionType === "x11" && (!commands.xdotool || !commands.xprop)) {
    diagnostics.push("X11 active app metadata requires xdotool and xprop.");
  }
  if (nativeBackends.includes("hyprland_bind") && !commands.hyprctl) {
    diagnostics.push("Hyprland active app metadata requires hyprctl.");
  }
  if (nativeBackends.includes("gnome_custom_shortcut")) {
    if (!commands.gdbus) diagnostics.push("GNOME active app metadata requires gdbus.");
    else if (commands.gnomeShellEval === false) diagnostics.push("GNOME active app metadata requires org.gnome.Shell.Eval access.");
  }
  if (nativeBackends.includes("kde_kglobalaccel")) {
    if (!commands.qdbus6 && !commands.qdbus) diagnostics.push("KDE active app metadata requires qdbus6 or qdbus.");
    if (!env.DBUS_SESSION_BUS_ADDRESS) diagnostics.push("KDE active app metadata requires a D-Bus session bus.");
  }

  return diagnostics;
}

async function detectCommandAvailability(env: ContextEnv, platform: NodeJS.Platform): Promise<ContextCommandAvailability> {
  const [gdbus, hyprctl, qdbus, qdbus6, xdotool, xprop] = await Promise.all([
    commandExists("gdbus"),
    commandExists("hyprctl"),
    commandExists("qdbus"),
    commandExists("qdbus6"),
    commandExists("xdotool"),
    commandExists("xprop")
  ]);

  const nativeBackends = detectNativeShortcutBackends(env, platform);
  const gnomeShellEval =
    gdbus && nativeBackends.includes("gnome_custom_shortcut") ? await isGnomeShellEvalAvailable().catch(() => false) : undefined;

  return { gdbus, gnomeShellEval, hyprctl, qdbus, qdbus6, xdotool, xprop };
}

async function isGnomeShellEvalAvailable(): Promise<boolean> {
  const output = await execFileText(
    "gdbus",
    [
      "call",
      "--session",
      "--dest",
      "org.gnome.Shell",
      "--object-path",
      "/org/gnome/Shell",
      "--method",
      "org.gnome.Shell.Eval",
      "1"
    ],
    metadataTimeoutMs
  );
  return parseGvariantBooleanStringTuple(output)?.ok === true;
}

async function captureHyprlandActiveWindow(): Promise<ActiveWindowMetadata | null> {
  const output = await execFileText("hyprctl", ["activewindow", "-j"], metadataTimeoutMs);
  return parseHyprlandActiveWindow(output);
}

async function captureGnomeShellActiveWindow(): Promise<ActiveWindowMetadata | null> {
  const output = await execFileText(
    "gdbus",
    [
      "call",
      "--session",
      "--dest",
      "org.gnome.Shell",
      "--object-path",
      "/org/gnome/Shell",
      "--method",
      "org.gnome.Shell.Eval",
      gnomeShellActiveWindowScript()
    ],
    metadataTimeoutMs
  );
  const metadata = parseGnomeShellEvalOutput(output);
  if (!metadata) throw new Error(`GNOME Shell Eval returned no active window metadata: ${output.trim() || "empty response"}`);
  return metadata;
}

async function captureX11ActiveWindow(): Promise<ActiveWindowMetadata | null> {
  const windowId = await execFileText("xdotool", ["getactivewindow"], metadataTimeoutMs);
  const [titleOutput, xpropOutput] = await Promise.all([
    execFileText("xdotool", ["getwindowname", windowId], metadataTimeoutMs).catch(() => ""),
    execFileText("xprop", ["-id", windowId, "WM_CLASS"], metadataTimeoutMs).catch(() => "")
  ]);
  return parseX11ActiveWindow(titleOutput, xpropOutput, windowId);
}

function captureMacosActiveWindow(helper: MacosMetadataHelper): Promise<ActiveWindowMetadata | null> {
  const result = helper.activeWindow();
  if (!result.ok) throw new Error(result.error ?? "macOS active-window helper failed.");
  return Promise.resolve(
    normalizeActiveWindowMetadata({
      appName: result.appName,
      appId: result.appId,
      windowId: result.trusted === true ? result.windowId : undefined,
      windowTitle: result.trusted === true ? result.windowTitle : undefined
    })
  );
}

function normalizeActiveWindowMetadata(input: Record<string, unknown>): ActiveWindowMetadata | null {
  const appId = cleanString(input.appId);
  const appName = cleanString(input.appName) ?? appId;
  const windowId = cleanString(input.windowId);
  const windowTitle = cleanString(input.windowTitle);
  const metadata = { appName, appId, windowId, windowTitle };
  return hasActiveWindowMetadata(metadata) ? metadata : null;
}

function hasActiveWindowMetadata(metadata: ActiveWindowMetadata): boolean {
  return Boolean(metadata.appName || metadata.appId || metadata.windowId || metadata.windowTitle);
}

function parseWmClass(output: string): string[] {
  const match = output.match(/WM_CLASS(?:\([^)]*\))?\s*=\s*(.+)$/m);
  if (!match) return [];
  const values: string[] = [];
  const regex = /"((?:\\"|[^"])*)"/g;
  let valueMatch: RegExpExecArray | null;

  while ((valueMatch = regex.exec(match[1])) !== null) {
    const value = cleanString(valueMatch[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));
    if (value) values.push(value);
  }

  if (values.length > 0) return values;
  const fallback = cleanString(match[1]);
  return fallback ? [fallback] : [];
}

function parseGvariantBooleanStringTuple(output: string): { ok: boolean; value: string } | null {
  const match = output.trim().match(/^\((true|false),\s*'(.*)'\)$/s);
  if (!match) return null;
  return {
    ok: match[1] === "true",
    value: unescapeGvariantString(match[2])
  };
}

function unescapeGvariantString(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\" || index === value.length - 1) {
      result += character;
      continue;
    }

    index += 1;
    const escaped = value[index];
    if (escaped === "n") result += "\n";
    else if (escaped === "r") result += "\r";
    else if (escaped === "t") result += "\t";
    else result += escaped;
  }
  return result;
}

function parseKdeScriptId(output: string): string | null {
  return output.match(/\d+/)?.[0] ?? null;
}

function kdeActiveWindowScript(token: string): string {
  return `
(function () {
  function text(value) {
    if (value === undefined || value === null) return "";
    return String(value);
  }
  function prop(object, name) {
    try {
      return object && object[name] !== undefined ? text(object[name]) : "";
    } catch (error) {
      return "";
    }
  }

  var win = workspace.activeWindow || workspace.activeClient || null;
  var payload = { token: ${JSON.stringify(token)} };
  if (win) {
    payload.windowTitle = prop(win, "caption") || prop(win, "captionNormal");
    payload.windowId = prop(win, "internalId") || prop(win, "windowId");
    payload.appId = prop(win, "desktopFileName") || prop(win, "resourceClass") || prop(win, "resourceName");
    payload.appName = prop(win, "resourceClass") || prop(win, "desktopFileName") || prop(win, "resourceName");
  }

  callDBus(
    ${JSON.stringify(dbusServiceName)},
    ${JSON.stringify(dbusObjectPath)},
    ${JSON.stringify(dbusInterfaceName)},
    "ReportActiveWindow",
    JSON.stringify(payload)
  );
})();
`;
}

function gnomeShellActiveWindowScript(): string {
  return `
(() => {
  const win = global.display.focus_window;
  const text = (value) => value === null || value === undefined ? "" : String(value);
  const call = (name) => {
    try {
      return win && typeof win[name] === "function" ? text(win[name]()) : "";
    } catch (error) {
      return "";
    }
  };
  if (!win) return JSON.stringify({});
  return JSON.stringify({
    appId: call("get_gtk_application_id") || call("get_wm_class_instance") || call("get_wm_class"),
    appName: call("get_wm_class") || call("get_gtk_application_id") || call("get_wm_class_instance"),
    windowId: call("get_stable_sequence") || call("get_id"),
    windowTitle: call("get_title")
  });
})()
`;
}

function backendLabel(backend: ContextMetadataBackend): string {
  if (backend === "x11") return "X11";
  if (backend === "hyprland") return "Hyprland";
  if (backend === "gnome_shell") return "GNOME Shell";
  if (backend === "macos_accessibility_helper") return "macOS automation helper";
  return "KWin";
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = String(value).trim();
  return cleaned.length > 0 && cleaned !== "(null)" ? cleaned : undefined;
}

function emptyCommandAvailability(): ContextCommandAvailability {
  return {
    gdbus: false,
    gnomeShellEval: undefined,
    hyprctl: false,
    qdbus: false,
    qdbus6: false,
    xdotool: false,
    xprop: false
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
