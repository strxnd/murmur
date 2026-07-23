import { randomBytes } from "node:crypto";
import * as dbusNative from "@homebridge/dbus-native";
import { murmurAppId } from "../../shared/app-identity";
import type { ActivationMode, GlobalShortcutActionId } from "../../shared/types";
import { DbusSessionConnection, type DbusMessage, type DbusMessageBus } from "./dbus-session-connection";

const portalDestination = "org.freedesktop.portal.Desktop";
const portalPath = "/org/freedesktop/portal/desktop";
const globalShortcutsInterface = "org.freedesktop.portal.GlobalShortcuts";
const hostRegistryInterface = "org.freedesktop.host.portal.Registry";
const propertiesInterface = "org.freedesktop.DBus.Properties";
const requestInterface = "org.freedesktop.portal.Request";
const sessionInterface = "org.freedesktop.portal.Session";
const dbusDestination = "org.freedesktop.DBus";
const dbusPath = "/org/freedesktop/DBus";
const dbusInterface = "org.freedesktop.DBus";
const portalTimeoutMs = 3000;
const interactivePortalTimeoutMs = 60000;

const shortcutActionIds: GlobalShortcutActionId[] = ["activation", "mode-selector"];

export interface XdgShortcutRegistrationResult {
  attempted: boolean;
  registered: boolean;
  pushToTalkRelease: boolean;
  triggerDescription?: string;
  diagnostics: string[];
  actionResults: Record<GlobalShortcutActionId, XdgShortcutActionResult>;
}

export interface XdgShortcutActionResult {
  registered: boolean;
  pushToTalkRelease: boolean;
  triggerDescription?: string;
  diagnostics: string[];
}

export interface XdgShortcutActionRegistration {
  id: GlobalShortcutActionId;
  accelerator: string;
  description: string;
  activationMode: ActivationMode;
  onActivated: () => void;
  onDeactivated: () => void;
}

export interface XdgGlobalShortcutRegistrationOptions {
  actions: XdgShortcutActionRegistration[];
}

export interface XdgGlobalShortcutDependencies {
  platform?: NodeJS.Platform | string;
  env?: NodeJS.ProcessEnv;
  createBus?: () => PortalMessageBus;
  onRegistrationLost?: (reason: string) => void;
  portalTimeoutMs?: number;
  interactiveTimeoutMs?: number;
}

type DbusNativeModule = typeof dbusNative & {
  sessionBus: (options?: Record<string, unknown>) => PortalMessageBus;
};

type PortalMessageBus = DbusMessageBus;

type DbusVardict = Array<[string, DbusVariant]>;
type DbusVariant = [string, unknown];

interface PortalRequestResponse {
  response: number;
  results: DbusVardict;
}

interface PendingRequestResponse {
  reject: (error: Error) => void;
  resolve: (response: PortalRequestResponse) => void;
  timer: NodeJS.Timeout;
}

interface ActiveRegistration {
  actions: Map<GlobalShortcutActionId, XdgShortcutActionRegistration>;
  sessionHandle: string;
}

const dbus = dbusNative as DbusNativeModule;

export class XdgGlobalShortcutService {
  private activeRegistration: ActiveRegistration | null = null;
  private sessionHandle: string | null = null;
  private matchRules = new Set<string>();
  private pendingResponses = new Map<string, PendingRequestResponse>();
  private completedResponses = new Map<string, PortalRequestResponse>();
  private lastBusError: string | null = null;
  private hostAppRegistered = false;
  private portalOwner: string | null = null;
  private unregistering = false;
  private readonly platform: NodeJS.Platform | string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly onRegistrationLost: (reason: string) => void;
  private readonly callTimeoutMs: number;
  private readonly interactiveTimeoutMs: number;
  private readonly connection: DbusSessionConnection<PortalMessageBus>;

  constructor(dependencies: XdgGlobalShortcutDependencies = {}) {
    this.platform = dependencies.platform ?? process.platform;
    this.env = dependencies.env ?? process.env;
    this.onRegistrationLost = dependencies.onRegistrationLost ?? (() => undefined);
    this.callTimeoutMs = dependencies.portalTimeoutMs ?? portalTimeoutMs;
    this.interactiveTimeoutMs = dependencies.interactiveTimeoutMs ?? interactivePortalTimeoutMs;
    const createBus = dependencies.createBus ?? (() => dbus.sessionBus({ ReturnLongjs: false }));
    this.connection = new DbusSessionConnection(createBus, this.handleMessage, this.handleConnectionLost);
  }

  async register(options: XdgGlobalShortcutRegistrationOptions): Promise<XdgShortcutRegistrationResult> {
    await this.unregister();

    const diagnostics: string[] = [];
    const actionResults = emptyActionResults();
    const result = (patch: Partial<XdgShortcutRegistrationResult>): XdgShortcutRegistrationResult => ({
      attempted: patch.attempted ?? false,
      registered: patch.registered ?? false,
      pushToTalkRelease: patch.pushToTalkRelease ?? false,
      triggerDescription: patch.triggerDescription,
      diagnostics: [...diagnostics, ...(patch.diagnostics ?? [])],
      actionResults: patch.actionResults ?? actionResults
    });

    if (this.platform !== "linux") {
      diagnostics.push("XDG Desktop Portal global shortcuts are only available on Linux.");
      return result({});
    }

    if (!this.env.DBUS_SESSION_BUS_ADDRESS) {
      diagnostics.push("No D-Bus session bus is available for XDG Desktop Portal global shortcuts.");
      return result({});
    }

    const requestedActions = options.actions.filter((action) => shortcutActionIds.includes(action.id));
    const bindableActions: Array<XdgShortcutActionRegistration & { preferredTrigger: string }> = [];

    for (const action of requestedActions) {
      const preferredTrigger = acceleratorToPortalTrigger(action.accelerator);
      if (!preferredTrigger) {
        actionResults[action.id].diagnostics.push(
          `${shortcutActionLabel(action.id)} shortcut "${action.accelerator}" cannot be represented as an XDG Desktop Portal trigger.`
        );
        continue;
      }
      bindableActions.push({ ...action, preferredTrigger });
    }

    if (bindableActions.length === 0) {
      return result({});
    }

    try {
      const bus = this.getBus();
      const uniqueName = await this.waitForUniqueBusName(bus);
      this.portalOwner = await this.getNameOwner(bus, portalDestination);
      await this.addMatch(portalOwnerChangedMatch());
      await this.registerHostApp(bus, diagnostics);
      const globalShortcutsVersion = await this.readGlobalShortcutsVersion(bus, diagnostics);
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
        responseTimeoutMs: this.callTimeoutMs
      });

      if (createResponse.response !== 0) {
        diagnostics.push(`XDG Desktop Portal shortcut session was not created: ${responseDescription(createResponse.response)}.`);
        return result({ attempted: true });
      }

      const sessionHandle = vardictString(createResponse.results, "session_handle");
      if (!sessionHandle) {
        diagnostics.push("XDG Desktop Portal did not return a shortcut session handle.");
        return result({ attempted: true });
      }

      this.sessionHandle = sessionHandle;

      const shortcuts = bindableActions.map((action) => [
        action.id,
        shortcutPropertiesForPortalVersion(action.description, action.preferredTrigger, globalShortcutsVersion)
      ]);
      const bindResponse = await this.callPortalRequest({
        bus,
        uniqueName,
        member: "BindShortcuts",
        signature: "oa(sa{sv})sa{sv}",
        body: [
          sessionHandle,
          shortcuts,
          "",
          makeVardict({
            handle_token: makeToken("bind")
          })
        ],
        responseTimeoutMs: this.interactiveTimeoutMs
      });

      if (bindResponse.response !== 0) {
        diagnostics.push(`XDG Desktop Portal shortcut binding was not completed: ${responseDescription(bindResponse.response)}.`);
        await this.unregister();
        return result({ attempted: true });
      }

      const activeActions = new Map<GlobalShortcutActionId, XdgShortcutActionRegistration>();
      for (const action of bindableActions) {
        const boundShortcut = findBoundShortcut(bindResponse.results, action.id);
        if (!boundShortcut) {
          actionResults[action.id].diagnostics.push(`XDG Desktop Portal did not bind the requested ${shortcutActionLabel(action.id)} shortcut.`);
          continue;
        }
        if (!boundShortcut.triggerDescription) {
          actionResults[action.id].diagnostics.push(
            `XDG Desktop Portal did not assign a system shortcut to ${portalActionId(action.id)}; assign it in system keyboard settings.`
          );
          continue;
        }

        activeActions.set(action.id, action);
        actionResults[action.id] = {
          registered: true,
          pushToTalkRelease: action.activationMode === "push_to_talk",
          triggerDescription: boundShortcut.triggerDescription || undefined,
          diagnostics: actionResults[action.id].diagnostics
        };
      }

      const activationResult = actionResults.activation;
      if (activeActions.size === 0) {
        await this.unregister();
        return result({ attempted: true });
      }

      await this.addMatch(globalShortcutsSignalMatch(this.portalOwner));
      await this.addMatch(sessionClosedMatch(sessionHandle, this.portalOwner));
      this.activeRegistration = {
        actions: activeActions,
        sessionHandle
      };

      return result({
        attempted: true,
        registered: true,
        pushToTalkRelease: activationResult.pushToTalkRelease,
        triggerDescription: activationResult.triggerDescription,
        actionResults
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(`XDG Desktop Portal global shortcut registration failed: ${message}.`);
      await this.unregister();
      return result({ attempted: true });
    }
  }

  async unregister(): Promise<void> {
    this.unregistering = true;
    try {
      this.activeRegistration = null;
      this.completedResponses.clear();
      for (const pending of this.pendingResponses.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("XDG Desktop Portal shortcut registration was cancelled."));
      }
      this.pendingResponses.clear();

      const sessionHandle = this.sessionHandle;
      this.sessionHandle = null;
      const bus = this.connection.currentBus();
      if (bus && sessionHandle) {
        await this.invoke({
          bus,
          path: sessionHandle,
          interfaceName: sessionInterface,
          member: "Close"
        }).catch(() => undefined);
      }

      await this.removeAllMatches();
    } finally {
      this.unregistering = false;
    }
  }

  dispose(): void {
    void this.unregister().finally(() => this.connection.dispose());
  }

  private getBus(): PortalMessageBus {
    if (!this.connection.currentBus()) this.lastBusError = null;
    return this.connection.getBus();
  }

  private async waitForUniqueBusName(bus: PortalMessageBus): Promise<string> {
    const startedAt = Date.now();
    while (!bus.name) {
      if (this.lastBusError) throw new Error(this.lastBusError);
      if (Date.now() - startedAt > this.callTimeoutMs) {
        throw new Error("Timed out waiting for the D-Bus session bus.");
      }
      await delay(20);
    }
    return bus.name;
  }

  private async callPortalRequest(options: {
    bus: PortalMessageBus;
    uniqueName: string;
    member: string;
    signature: string;
    body: unknown[];
    responseTimeoutMs: number;
  }): Promise<PortalRequestResponse> {
    const token = vardictString(options.body.at(-1), "handle_token") ?? makeToken("request");
    const expectedHandle = requestPathForToken(options.uniqueName, token);
    await this.addMatch(requestResponseMatch(expectedHandle, this.portalOwner));

    const requestHandle = await this.invoke<string>({
      bus: options.bus,
      path: portalPath,
      interfaceName: globalShortcutsInterface,
      member: options.member,
      signature: options.signature,
      body: options.body
    });

    const handle = requestHandle || expectedHandle;
    if (handle !== expectedHandle) {
      await this.addMatch(requestResponseMatch(handle, this.portalOwner));
    }

    try {
      return await this.waitForRequestResponse(handle, options.responseTimeoutMs);
    } catch (error) {
      await this.closeRequest(handle);
      throw error;
    } finally {
      await this.removeMatch(requestResponseMatch(expectedHandle, this.portalOwner));
      if (handle !== expectedHandle) {
        await this.removeMatch(requestResponseMatch(handle, this.portalOwner));
      }
    }
  }

  private async registerHostApp(bus: PortalMessageBus, diagnostics: string[]): Promise<void> {
    if (this.hostAppRegistered) return;

    try {
      await this.invoke<void>({
        bus,
        path: portalPath,
        interfaceName: hostRegistryInterface,
        member: "Register",
        signature: "sa{sv}",
        body: [murmurAppId, []]
      });
      this.hostAppRegistered = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already registered|already been registered/i.test(message)) {
        this.hostAppRegistered = true;
        return;
      }
      diagnostics.push(`XDG Desktop Portal app registration failed for ${murmurAppId}: ${message}.`);
    }
  }

  private async readGlobalShortcutsVersion(bus: PortalMessageBus, diagnostics: string[]): Promise<number> {
    try {
      const versionVariant = await this.invoke<DbusVariant>({
        bus,
        path: portalPath,
        interfaceName: propertiesInterface,
        member: "Get",
        signature: "ss",
        body: [globalShortcutsInterface, "version"]
      });
      const parsed = parseVariant(versionVariant);
      return typeof parsed?.value === "number" ? parsed.value : 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(`Unable to read XDG Desktop Portal global shortcuts version: ${message}.`);
      return 1;
    }
  }

  private invoke<T>(options: {
    bus: PortalMessageBus;
    path: string;
    interfaceName: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<T> {
    return this.connection.invoke<T>({
      bus: options.bus,
      message: {
        destination: options.interfaceName === dbusInterface ? dbusDestination : portalDestination,
        path: options.path,
        interface: options.interfaceName,
        member: options.member,
        signature: options.signature,
        body: options.body
      },
      timeoutMs: this.callTimeoutMs,
      timeoutMessage: `Timed out calling ${options.interfaceName}.${options.member}.`
    });
  }

  private getNameOwner(bus: PortalMessageBus, name: string): Promise<string> {
    return this.invoke<string>({
      bus,
      path: dbusPath,
      interfaceName: dbusInterface,
      member: "GetNameOwner",
      signature: "s",
      body: [name]
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
      body: [rule]
    });
    this.matchRules.add(rule);
  }

  private async removeMatch(rule: string): Promise<void> {
    const bus = this.connection.currentBus();
    if (!this.matchRules.has(rule) || !bus) return;
    this.matchRules.delete(rule);
    await this.invoke({
      bus,
      path: dbusPath,
      interfaceName: dbusInterface,
      member: "RemoveMatch",
      signature: "s",
      body: [rule]
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
        reject(new Error(`Timed out waiting for XDG Desktop Portal request response: ${handle}.`));
      }, timeoutMs);
      timer.unref();
      this.pendingResponses.set(handle, { reject, resolve, timer });
    });
  }

  private async closeRequest(handle: string): Promise<void> {
    const bus = this.connection.currentBus();
    if (!bus) return;
    await this.invoke({
      bus,
      path: handle,
      interfaceName: requestInterface,
      member: "Close"
    }).catch(() => undefined);
  }

  private readonly handleMessage = (message: DbusMessage): void => {
    if (message.sender === dbusDestination && message.interface === dbusInterface && message.member === "NameOwnerChanged") {
      const [name, oldOwner, newOwner] = message.body ?? [];
      if (name === portalDestination && oldOwner === this.portalOwner && newOwner !== this.portalOwner) {
        this.loseRegistration("XDG Desktop Portal restarted.");
      }
      return;
    }

    if (message.sender !== this.portalOwner) return;

    if (message.interface === requestInterface && message.member === "Response" && message.path) {
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
      return;
    }

    if (message.interface === sessionInterface && message.member === "Closed" && message.path === this.sessionHandle) {
      this.loseRegistration("XDG Desktop Portal shortcut session closed.");
      return;
    }

    if (message.interface !== globalShortcutsInterface || !this.activeRegistration) return;
    if (message.member !== "Activated" && message.member !== "Deactivated") return;

    const [sessionHandle, id] = message.body ?? [];
    if (sessionHandle !== this.activeRegistration.sessionHandle) return;
    if (id !== "activation" && id !== "mode-selector") return;
    const action = this.activeRegistration.actions.get(id);
    if (!action) return;

    if (message.member === "Activated") {
      action.onActivated();
    } else {
      action.onDeactivated();
    }
  };

  private readonly handleConnectionLost = (error: Error): void => {
    this.lastBusError = error.message;
    this.loseRegistration(`D-Bus session connection failed: ${error.message}`);
  };

  private loseRegistration(reason: string): void {
    const wasRegistered = this.activeRegistration !== null;
    this.activeRegistration = null;
    this.sessionHandle = null;
    this.portalOwner = null;
    this.hostAppRegistered = false;
    this.matchRules.clear();
    this.completedResponses.clear();
    for (const [handle, pending] of this.pendingResponses) {
      clearTimeout(pending.timer);
      this.pendingResponses.delete(handle);
      pending.reject(new Error(reason));
    }
    this.connection.reset(new Error(reason));
    if (wasRegistered && !this.unregistering) this.onRegistrationLost(reason);
  }
}

export function shortcutDescriptionForActivationMode(mode: ActivationMode): string {
  return mode === "push_to_talk" ? "Push to talk with Murmur" : "Toggle Murmur recording";
}

export function shortcutDescriptionForModeSelector(): string {
  return "Show Murmur mode selector";
}

export function acceleratorToPortalTrigger(accelerator: string): string | null {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  const seenModifiers = new Set<string>();
  const keys: string[] = [];

  for (const token of tokens) {
    const modifier = portalModifier(token);
    if (modifier === "unsupported") return null;
    if (modifier) {
      if (!seenModifiers.has(modifier)) {
        seenModifiers.add(modifier);
        modifiers.push(modifier);
      }
      continue;
    }

    const key = portalKey(token);
    if (!key) return null;
    keys.push(key);
  }

  if (keys.length !== 1) return null;
  return [...modifiers, keys[0]].join("+");
}

export function shortcutPropertiesForPortalVersion(description: string, preferredTrigger: string, version: number): DbusVardict {
  const properties: Record<string, string> = { description };
  if (version >= 2) {
    properties.preferred_trigger = preferredTrigger;
  }
  return makeVardict(properties);
}

function portalActionId(id: GlobalShortcutActionId): string {
  return `${murmurAppId}:${id}`;
}

function emptyActionResults(): Record<GlobalShortcutActionId, XdgShortcutActionResult> {
  return {
    activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
    "mode-selector": { registered: false, pushToTalkRelease: false, diagnostics: [] }
  };
}

function shortcutActionLabel(id: GlobalShortcutActionId): string {
  return id === "activation" ? "activation" : "mode selector";
}

function portalModifier(token: string): string | null | "unsupported" {
  switch (normalizeToken(token)) {
    case "commandorcontrol":
    case "cmdorctrl":
    case "control":
    case "ctrl":
      return "CTRL";
    case "alt":
    case "option":
      return "ALT";
    case "shift":
      return "SHIFT";
    case "super":
    case "meta":
    case "command":
    case "cmd":
      return "LOGO";
    case "altgr":
      return "unsupported";
    default:
      return null;
  }
}

function portalKey(token: string): string | null {
  const normalized = normalizeToken(token);

  if (/^[a-z]$/.test(normalized)) return normalized;
  if (/^[0-9]$/.test(normalized)) return normalized;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(normalized)) return normalized.toUpperCase();

  return keyMap[normalized] ?? null;
}

const keyMap: Record<string, string> = {
  "`": "grave",
  "-": "minus",
  "=": "equal",
  "[": "bracketleft",
  "]": "bracketright",
  "\\": "backslash",
  ";": "semicolon",
  "'": "apostrophe",
  ",": "comma",
  ".": "period",
  "/": "slash",
  "+": "plus",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  backquote: "grave",
  backslash: "backslash",
  backspace: "BackSpace",
  bracketleft: "bracketleft",
  bracketright: "bracketright",
  comma: "comma",
  delete: "Delete",
  down: "Down",
  end: "End",
  enter: "Return",
  equal: "equal",
  escape: "Escape",
  esc: "Escape",
  grave: "grave",
  home: "Home",
  insert: "Insert",
  left: "Left",
  minus: "minus",
  pagedown: "Page_Down",
  pageup: "Page_Up",
  period: "period",
  plus: "plus",
  quote: "apostrophe",
  return: "Return",
  right: "Right",
  semicolon: "semicolon",
  slash: "slash",
  space: "space",
  tab: "Tab",
  up: "Up"
};

function normalizeToken(token: string): string {
  return token.replace(/\s+/g, "").toLowerCase();
}

function makeVardict(values: Record<string, string>): DbusVardict {
  return Object.entries(values).map(([key, value]) => [key, ["s", value]]);
}

function vardictString(value: unknown, key: string): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const entry = (value as Array<[unknown, unknown]>).find(([candidate]) => candidate === key);
  if (!entry) return undefined;
  const variant = parseVariant(entry[1]);
  return typeof variant?.value === "string" ? variant.value : undefined;
}

function findBoundShortcut(results: DbusVardict, id: string): { triggerDescription?: string } | null {
  const shortcutsVariant = parseVariant(results.find(([key]) => key === "shortcuts")?.[1]);
  if (!Array.isArray(shortcutsVariant?.value)) return null;

  for (const shortcut of shortcutsVariant.value) {
    if (!Array.isArray(shortcut) || shortcut.length < 2 || shortcut[0] !== id) continue;
    const properties = shortcut[1] as DbusVardict;
    return {
      triggerDescription: vardictString(properties, "trigger_description")
    };
  }

  return null;
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

function requestResponseMatch(handle: string, sender: string | null): string {
  return `type='signal'${sender ? `,sender='${sender}'` : ""},path='${handle}',interface='${requestInterface}',member='Response'`;
}

function globalShortcutsSignalMatch(sender: string | null): string {
  return `type='signal'${sender ? `,sender='${sender}'` : ""},path='${portalPath}',interface='${globalShortcutsInterface}'`;
}

function sessionClosedMatch(sessionHandle: string, sender: string | null): string {
  return `type='signal'${sender ? `,sender='${sender}'` : ""},path='${sessionHandle}',interface='${sessionInterface}',member='Closed'`;
}

function portalOwnerChangedMatch(): string {
  return `type='signal',sender='${dbusDestination}',path='${dbusPath}',interface='${dbusInterface}',member='NameOwnerChanged',arg0='${portalDestination}'`;
}

function makeToken(prefix: string): string {
  return `murmur_${prefix}_${randomBytes(8).toString("hex")}`;
}

function responseDescription(response: number): string {
  if (response === 1) return "the user cancelled the request";
  if (response === 2) return "the request ended without being completed";
  return `portal response ${response}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
