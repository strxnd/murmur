import { randomBytes } from "node:crypto";
import * as dbusNative from "@homebridge/dbus-native";
import type { BusConnection, MessageBus } from "@homebridge/dbus-native";
import { murmurAppId } from "../../shared/app-identity";
import type { AutomationResult, ShortcutAutomationBackend, TextAutomationCapability, TextAutomationShortcut } from "./text-automation";

const portalDestination = "org.freedesktop.portal.Desktop";
const portalPath = "/org/freedesktop/portal/desktop";
const remoteDesktopInterface = "org.freedesktop.portal.RemoteDesktop";
const hostRegistryInterface = "org.freedesktop.host.portal.Registry";
const propertiesInterface = "org.freedesktop.DBus.Properties";
const requestInterface = "org.freedesktop.portal.Request";
const sessionInterface = "org.freedesktop.portal.Session";
const dbusDestination = "org.freedesktop.DBus";
const dbusPath = "/org/freedesktop/DBus";
const dbusInterface = "org.freedesktop.DBus";
const keyboardDeviceType = 1;
const keyStateReleased = 0;
const keyStatePressed = 1;
const leftControlKeycode = 29;
const leftShiftKeycode = 42;
const cKeycode = 46;
const vKeycode = 47;
const insertKeycode = 110;
const probeTimeoutMs = 3000;
const portalRequestTimeoutMs = 60000;
const permissionThrottleMs = 60000;
const postSessionReadyDelayMs = 150;
const shortcutEventDelayMs = 20;
const unavailableDiagnostic = "XDG RemoteDesktop keyboard portal unavailable; clipboard-only fallback will be used.";
const readyDiagnostic = "XDG RemoteDesktop keyboard portal available.";
const keyboardUnavailableDiagnostic = "XDG RemoteDesktop portal does not expose keyboard control.";
const permissionDeniedDiagnostic = "Paste automation permission was not granted; output copied to clipboard.";

type DbusNativeModule = typeof dbusNative & {
  sessionBus: (options?: Record<string, unknown>) => PortalMessageBus;
};

type PortalBusConnection = BusConnection & {
  end?: () => void;
};

type PortalMessageBus = MessageBus & {
  connection: PortalBusConnection;
  name?: string;
};

type DbusVardict = Array<[string, DbusVariant]>;
type DbusVariant = [string, unknown];
type DbusVardictValue = string | number | boolean;

interface DbusMessage {
  path?: string;
  interface?: string;
  member?: string;
  body?: unknown[];
}

interface PortalRequestResponse {
  response: number;
  results: DbusVardict;
}

interface PendingRequestResponse {
  reject: (error: Error) => void;
  resolve: (response: PortalRequestResponse) => void;
  timer: NodeJS.Timeout;
}

export interface XdgRemoteDesktopKeyboardDependencies {
  platform?: NodeJS.Platform | string;
  env?: NodeJS.ProcessEnv;
  createBus?: () => PortalMessageBus;
  now?: () => number;
}

const dbus = dbusNative as DbusNativeModule;

export class XdgRemoteDesktopKeyboardService implements ShortcutAutomationBackend {
  private bus: PortalMessageBus | null = null;
  private matchRules = new Set<string>();
  private pendingResponses = new Map<string, PendingRequestResponse>();
  private completedResponses = new Map<string, PortalRequestResponse>();
  private sessionHandle: string | null = null;
  private lastBusError: string | null = null;
  private lastPermissionDeniedAt = 0;
  private hostAppRegistered = false;
  private capability: TextAutomationCapability = {
    backend: "clipboard_only",
    automationAvailable: false,
    permissionRequired: false,
    diagnostics: [unavailableDiagnostic]
  };

  private readonly platform: NodeJS.Platform | string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly createBus: () => PortalMessageBus;
  private readonly now: () => number;

  constructor(dependencies: XdgRemoteDesktopKeyboardDependencies = {}) {
    this.platform = dependencies.platform ?? process.platform;
    this.env = dependencies.env ?? process.env;
    this.createBus = dependencies.createBus ?? (() => dbus.sessionBus({ ReturnLongjs: false }));
    this.now = dependencies.now ?? (() => Date.now());
  }

  async initialize(): Promise<void> {
    if (this.platform !== "linux" || !this.env.DBUS_SESSION_BUS_ADDRESS) {
      this.setUnavailable([unavailableDiagnostic]);
      return;
    }

    try {
      const bus = this.getBus();
      await this.waitForUniqueBusName(bus, probeTimeoutMs);
      await this.registerHostApp(bus);
      const availableDeviceTypes = await this.readAvailableDeviceTypes(bus);
      if ((availableDeviceTypes & keyboardDeviceType) !== keyboardDeviceType) {
        this.capability = {
          backend: "clipboard_only",
          automationAvailable: false,
          permissionRequired: false,
          diagnostics: [keyboardUnavailableDiagnostic]
        };
        return;
      }

      this.capability = {
        backend: "xdg_remote_desktop_keyboard",
        automationAvailable: true,
        permissionRequired: true,
        diagnostics: [readyDiagnostic]
      };
    } catch {
      this.setUnavailable([unavailableDiagnostic]);
    }
  }

  dispose(): void {
    void this.closeSession().finally(() => {
      for (const pending of this.pendingResponses.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("XDG RemoteDesktop keyboard automation was disposed."));
      }
      this.pendingResponses.clear();
      this.completedResponses.clear();
      this.bus?.connection.removeListener("message", this.handleMessage);
      this.bus?.connection.removeListener("error", this.handleBusError);
      this.bus?.connection.end?.();
      this.bus = null;
    });
  }

  pasteClipboard(): Promise<AutomationResult> {
    return this.sendKeyboardShortcut("ctrl_v", "paste");
  }

  copySelection(): Promise<AutomationResult> {
    return this.sendKeyboardShortcut("ctrl_c", "copy");
  }

  sendKeyboardShortcut(shortcut: TextAutomationShortcut, action: "paste" | "copy"): Promise<AutomationResult> {
    return this.sendShortcut(action, shortcut);
  }

  getCapability(): TextAutomationCapability {
    return {
      ...this.capability,
      diagnostics: this.getDiagnostics()
    };
  }

  getDiagnostics(): string[] {
    return this.capability.diagnostics;
  }

  private async sendShortcut(action: "paste" | "copy", shortcut: TextAutomationShortcut): Promise<AutomationResult> {
    if (!this.capability.automationAvailable) {
      await this.initialize();
      if (!this.capability.automationAvailable) {
        return this.result(false, "unavailable", unavailableMessage(action));
      }
    }

    if (this.now() - this.lastPermissionDeniedAt < permissionThrottleMs) {
      return this.result(false, "denied", permissionDeniedDiagnostic);
    }

    try {
      const sessionHandle = await this.ensureSession();
      await delay(postSessionReadyDelayMs);
      await this.sendKeyboardShortcutSequence(sessionHandle, shortcut);
      return this.result(true, "success", action === "paste" ? "Paste shortcut sent." : "Copy shortcut sent.");
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof PortalPermissionError) {
        this.lastPermissionDeniedAt = this.now();
        this.addDiagnostic(permissionDeniedDiagnostic);
        await this.closeSession();
        return this.result(false, "denied", permissionDeniedDiagnostic);
      }

      await this.resetPortalConnection();
      const failureMessage =
        action === "paste"
          ? `Paste automation failed; output left on clipboard. ${message}`
          : `Selected text automation failed. ${message}`;
      this.addDiagnostic(failureMessage);
      return this.result(false, "failed", failureMessage);
    }
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionHandle) return this.sessionHandle;

    const bus = this.getBus();
    const uniqueName = await this.waitForUniqueBusName(bus, probeTimeoutMs);
    await this.registerHostApp(bus);
    const createResponse = await this.callPortalRequest({
      bus,
      uniqueName,
      member: "CreateSession",
      signature: "a{sv}",
      body: [
        makeVardict({
          handle_token: makeToken("create"),
          session_handle_token: makeToken("session")
        })
      ],
      timeoutMs: probeTimeoutMs
    });

    if (createResponse.response !== 0) {
      throw new PortalPermissionError(`RemoteDesktop session was not created: ${responseDescription(createResponse.response)}.`);
    }

    const sessionHandle = vardictString(createResponse.results, "session_handle");
    if (!sessionHandle) {
      throw new Error("XDG RemoteDesktop did not return a session handle.");
    }

    this.sessionHandle = sessionHandle;

    const selectResponse = await this.callPortalRequest({
      bus,
      uniqueName,
      member: "SelectDevices",
      signature: "oa{sv}",
      body: [
        sessionHandle,
        makeVardict({
          handle_token: makeToken("select"),
          types: keyboardDeviceType,
          persist_mode: 1
        })
      ],
      timeoutMs: portalRequestTimeoutMs
    });

    if (selectResponse.response !== 0) {
      throw new PortalPermissionError(`RemoteDesktop keyboard devices were not selected: ${responseDescription(selectResponse.response)}.`);
    }

    const startResponse = await this.callPortalRequest({
      bus,
      uniqueName,
      member: "Start",
      signature: "osa{sv}",
      body: [
        sessionHandle,
        "",
        makeVardict({
          handle_token: makeToken("start")
        })
      ],
      timeoutMs: portalRequestTimeoutMs
    });

    if (startResponse.response !== 0) {
      throw new PortalPermissionError(`RemoteDesktop session was not started: ${responseDescription(startResponse.response)}.`);
    }

    const devices = vardictUint(startResponse.results, "devices") ?? 0;
    if ((devices & keyboardDeviceType) !== keyboardDeviceType) {
      throw new PortalPermissionError("RemoteDesktop session did not grant keyboard control.");
    }

    return sessionHandle;
  }

  private async sendKeyboardShortcutSequence(sessionHandle: string, shortcut: TextAutomationShortcut): Promise<void> {
    const sequence = keySequenceForShortcut(shortcut);
    const pressedModifiers: number[] = [];
    try {
      for (const modifier of sequence.modifiers) {
        await this.notifyKeycode(sessionHandle, modifier, keyStatePressed);
        pressedModifiers.push(modifier);
        await delay(shortcutEventDelayMs);
      }
      await this.notifyKeycode(sessionHandle, sequence.key, keyStatePressed);
      await delay(shortcutEventDelayMs);
      await this.notifyKeycode(sessionHandle, sequence.key, keyStateReleased);
      await delay(shortcutEventDelayMs);
      for (const modifier of [...pressedModifiers].reverse()) {
        await this.notifyKeycode(sessionHandle, modifier, keyStateReleased);
        await delay(shortcutEventDelayMs);
        pressedModifiers.pop();
      }
    } catch (error) {
      for (const modifier of [...pressedModifiers].reverse()) {
        await this.notifyKeycode(sessionHandle, modifier, keyStateReleased).catch(() => undefined);
      }
      throw error;
    }
  }

  private notifyKeycode(sessionHandle: string, keycode: number, state: number): Promise<void> {
    if (!this.bus) throw new Error("No D-Bus session bus is available.");
    return this.invoke<void>({
      bus: this.bus,
      path: portalPath,
      interfaceName: remoteDesktopInterface,
      member: "NotifyKeyboardKeycode",
      signature: "oa{sv}iu",
      body: [sessionHandle, [], keycode, state],
      timeoutMs: probeTimeoutMs
    });
  }

  private getBus(): PortalMessageBus {
    if (this.bus) return this.bus;

    const bus = this.createBus();
    bus.connection.on("message", this.handleMessage);
    bus.connection.on("error", this.handleBusError);
    this.bus = bus;
    return bus;
  }

  private async waitForUniqueBusName(bus: PortalMessageBus, timeoutMs: number): Promise<string> {
    const startedAt = this.now();
    while (!bus.name) {
      if (this.lastBusError) throw new Error(this.lastBusError);
      if (this.now() - startedAt > timeoutMs) {
        throw new Error("Timed out waiting for the D-Bus session bus.");
      }
      await delay(20);
    }
    return bus.name;
  }

  private async readAvailableDeviceTypes(bus: PortalMessageBus): Promise<number> {
    const deviceTypesVariant = await this.invoke<DbusVariant>({
      bus,
      path: portalPath,
      interfaceName: propertiesInterface,
      member: "Get",
      signature: "ss",
      body: [remoteDesktopInterface, "AvailableDeviceTypes"],
      timeoutMs: probeTimeoutMs
    });
    const parsed = parseVariant(deviceTypesVariant);
    return typeof parsed?.value === "number" ? parsed.value : 0;
  }

  private async registerHostApp(bus: PortalMessageBus): Promise<void> {
    if (this.hostAppRegistered) return;

    try {
      await this.invoke<void>({
        bus,
        path: portalPath,
        interfaceName: hostRegistryInterface,
        member: "Register",
        signature: "sa{sv}",
        body: [murmurAppId, []],
        timeoutMs: probeTimeoutMs
      });
      this.hostAppRegistered = true;
    } catch (error) {
      const message = errorMessage(error);
      if (/already registered|already been registered/i.test(message)) {
        this.hostAppRegistered = true;
        return;
      }
      this.addDiagnostic(`XDG Desktop Portal app registration failed for ${murmurAppId}: ${message}.`);
    }
  }

  private async callPortalRequest(options: {
    bus: PortalMessageBus;
    uniqueName: string;
    member: string;
    signature: string;
    body: unknown[];
    timeoutMs: number;
  }): Promise<PortalRequestResponse> {
    const token = vardictString(options.body.at(-1), "handle_token") ?? makeToken("request");
    const expectedHandle = requestPathForToken(options.uniqueName, token);
    await this.addMatch(requestResponseMatch(expectedHandle));

    const requestHandle = await this.invoke<string>({
      bus: options.bus,
      path: portalPath,
      interfaceName: remoteDesktopInterface,
      member: options.member,
      signature: options.signature,
      body: options.body,
      timeoutMs: probeTimeoutMs
    });

    const handle = requestHandle || expectedHandle;
    if (handle !== expectedHandle) {
      await this.addMatch(requestResponseMatch(handle));
    }

    try {
      return await this.waitForRequestResponse(handle, options.timeoutMs);
    } catch (error) {
      await this.closeRequest(handle);
      throw error;
    } finally {
      await this.removeMatch(requestResponseMatch(expectedHandle));
      if (handle !== expectedHandle) {
        await this.removeMatch(requestResponseMatch(handle));
      }
    }
  }

  private invoke<T>(options: {
    bus: PortalMessageBus;
    path: string;
    interfaceName: string;
    member: string;
    signature?: string;
    body?: unknown[];
    timeoutMs: number;
  }): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out calling ${options.interfaceName}.${options.member}.`));
      }, options.timeoutMs);
      timer.unref();

      options.bus.invoke(
        {
          destination: options.interfaceName === dbusInterface ? dbusDestination : portalDestination,
          path: options.path,
          interface: options.interfaceName,
          member: options.member,
          signature: options.signature,
          body: options.body
        },
        (error, value) => {
          clearTimeout(timer);
          if (error) {
            reject(new Error(errorMessage(error)));
            return;
          }
          resolve(value as T);
        }
      );
    });
  }

  private async addMatch(rule: string): Promise<void> {
    if (this.matchRules.has(rule)) return;
    const bus = this.getBus();
    await this.invoke({
      bus,
      path: dbusPath,
      interfaceName: dbusInterface,
      member: "AddMatch",
      signature: "s",
      body: [rule],
      timeoutMs: probeTimeoutMs
    });
    this.matchRules.add(rule);
  }

  private async removeMatch(rule: string): Promise<void> {
    if (!this.matchRules.has(rule) || !this.bus) return;
    this.matchRules.delete(rule);
    await this.invoke({
      bus: this.bus,
      path: dbusPath,
      interfaceName: dbusInterface,
      member: "RemoveMatch",
      signature: "s",
      body: [rule],
      timeoutMs: probeTimeoutMs
    }).catch(() => undefined);
  }

  private async removeAllMatches(): Promise<void> {
    const rules = [...this.matchRules];
    await Promise.all(rules.map((rule) => this.removeMatch(rule)));
  }

  private waitForRequestResponse(handle: string, timeoutMs: number): Promise<PortalRequestResponse> {
    const completed = this.completedResponses.get(handle);
    if (completed) {
      this.completedResponses.delete(handle);
      return Promise.resolve(completed);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(handle);
        reject(new Error(`Timed out waiting for XDG RemoteDesktop request response: ${handle}.`));
      }, timeoutMs);
      timer.unref();
      this.pendingResponses.set(handle, { reject, resolve, timer });
    });
  }

  private async closeRequest(handle: string): Promise<void> {
    if (!this.bus) return;
    await this.invoke({
      bus: this.bus,
      path: handle,
      interfaceName: requestInterface,
      member: "Close",
      timeoutMs: probeTimeoutMs
    }).catch(() => undefined);
  }

  private async closeSession(): Promise<void> {
    const sessionHandle = this.sessionHandle;
    this.sessionHandle = null;
    if (this.bus && sessionHandle) {
      await this.invoke({
        bus: this.bus,
        path: sessionHandle,
        interfaceName: sessionInterface,
        member: "Close",
        timeoutMs: probeTimeoutMs
      }).catch(() => undefined);
    }
    await this.removeAllMatches();
  }

  private async resetPortalConnection(): Promise<void> {
    await this.closeSession();
    this.completedResponses.clear();
    this.lastBusError = null;
    this.bus?.connection.removeListener("message", this.handleMessage);
    this.bus?.connection.removeListener("error", this.handleBusError);
    this.bus?.connection.end?.();
    this.bus = null;
    this.hostAppRegistered = false;
  }

  private setUnavailable(diagnostics: string[]): void {
    this.capability = {
      backend: "clipboard_only",
      automationAvailable: false,
      permissionRequired: false,
      diagnostics
    };
  }

  private addDiagnostic(message: string): void {
    if (this.capability.diagnostics.includes(message)) return;
    this.capability = {
      ...this.capability,
      diagnostics: [...this.capability.diagnostics, message]
    };
  }

  private result(
    success: boolean,
    status: AutomationResult["status"],
    message: string
  ): AutomationResult {
    return {
      success,
      status,
      message,
      diagnostics: this.getDiagnostics()
    };
  }

  private readonly handleMessage = (message: DbusMessage): void => {
    if (message.interface !== requestInterface || message.member !== "Response" || !message.path) return;

    const [response, results] = message.body ?? [];
    const parsed = {
      response: typeof response === "number" ? response : 2,
      results: Array.isArray(results) ? (results as DbusVardict) : []
    };
    const pending = this.pendingResponses.get(message.path);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingResponses.delete(message.path);
      pending.resolve(parsed);
    } else {
      this.completedResponses.set(message.path, parsed);
    }
  };

  private readonly handleBusError = (error: Error): void => {
    this.lastBusError = error.message;
    this.sessionHandle = null;
    for (const [handle, pending] of this.pendingResponses) {
      clearTimeout(pending.timer);
      this.pendingResponses.delete(handle);
      pending.reject(error);
    }
  };
}

class PortalPermissionError extends Error {}

function unavailableMessage(action: "paste" | "copy"): string {
  return action === "paste"
    ? "XDG RemoteDesktop keyboard portal unavailable; output copied to clipboard."
    : "XDG RemoteDesktop keyboard portal unavailable; selected text capture skipped.";
}

function makeVardict(values: Record<string, DbusVardictValue>): DbusVardict {
  return Object.entries(values).map(([key, value]) => [key, variantForValue(value)]);
}

function variantForValue(value: DbusVardictValue): DbusVariant {
  if (typeof value === "string") return ["s", value];
  if (typeof value === "boolean") return ["b", value];
  return ["u", value];
}

function vardictString(value: unknown, key: string): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const entry = (value as Array<[unknown, unknown]>).find(([candidate]) => candidate === key);
  if (!entry) return undefined;
  const variant = parseVariant(entry[1]);
  return typeof variant?.value === "string" ? variant.value : undefined;
}

function vardictUint(value: unknown, key: string): number | undefined {
  if (!Array.isArray(value)) return undefined;
  const entry = (value as Array<[unknown, unknown]>).find(([candidate]) => candidate === key);
  if (!entry) return undefined;
  const variant = parseVariant(entry[1]);
  return typeof variant?.value === "number" ? variant.value : undefined;
}

function parseVariant(value: unknown): { signature: string; value: unknown } | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [signature, variantValue] = value;

  if (typeof signature === "string") {
    return { signature, value: variantValue };
  }

  if (Array.isArray(signature)) {
    const rawValues = Array.isArray(variantValue) ? variantValue : [variantValue];
    return {
      signature: signature.map(signatureNodeToString).join(""),
      value: rawValues.length === 1 ? rawValues[0] : rawValues
    };
  }

  return null;
}

function signatureNodeToString(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const typedNode = node as { type?: string; child?: unknown[] };
  if (!typedNode.type) return "";
  if (typedNode.type === "(") return `(${(typedNode.child ?? []).map(signatureNodeToString).join("")})`;
  if (typedNode.type === "{") return `{${(typedNode.child ?? []).map(signatureNodeToString).join("")}}`;
  if (typedNode.type === "a") return `a${(typedNode.child ?? []).map(signatureNodeToString).join("")}`;
  return typedNode.type;
}

function requestPathForToken(uniqueName: string, token: string): string {
  const sender = uniqueName.replace(/^:/, "").replace(/\./g, "_");
  return `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
}

function requestResponseMatch(handle: string): string {
  return `type='signal',path='${handle}',interface='${requestInterface}',member='Response'`;
}

function makeToken(prefix: string): string {
  return `murmur_${prefix}_${randomBytes(8).toString("hex")}`;
}

function responseDescription(response: number): string {
  if (response === 1) return "the user cancelled the request";
  if (response === 2) return "the request ended without being completed";
  return `portal response ${response}`;
}

function keySequenceForShortcut(shortcut: TextAutomationShortcut): { key: number; modifiers: number[] } {
  if (shortcut === "ctrl_v") return { key: vKeycode, modifiers: [leftControlKeycode] };
  if (shortcut === "ctrl_shift_v") return { key: vKeycode, modifiers: [leftControlKeycode, leftShiftKeycode] };
  if (shortcut === "shift_insert") return { key: insertKeycode, modifiers: [leftShiftKeycode] };
  if (shortcut === "ctrl_shift_c") return { key: cKeycode, modifiers: [leftControlKeycode, leftShiftKeycode] };
  return { key: cKeycode, modifiers: [leftControlKeycode] };
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const typedError = error as { name?: string; message?: string };
  if (typedError.name && typedError.message) return `${typedError.name}: ${typedError.message}`;
  if (typedError.message) return typedError.message;
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
