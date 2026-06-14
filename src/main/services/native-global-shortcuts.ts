import { execFile } from "node:child_process";
import * as dbusNative from "@homebridge/dbus-native";
import type { BusConnection, MessageBus } from "@homebridge/dbus-native";
import type { ActivationMode } from "../../shared/types";

const dbusServiceName = "dev.murmur.App";
const dbusObjectPath = "/dev/murmur/App";
const dbusCallbackInterface = "dev.murmur.App";
const dbusDestination = "org.freedesktop.DBus";
const dbusPath = "/org/freedesktop/DBus";
const dbusInterface = "org.freedesktop.DBus";
const dbusRequestNameDoNotQueue = 4;
const dbusRequestNamePrimaryOwner = 1;
const dbusRequestNameAlreadyOwner = 4;
const commandTimeoutMs = 3000;
const nativeTimeoutMs = 3000;

const gnomeMediaKeysSchema = "org.gnome.settings-daemon.plugins.media-keys";
const gnomeCustomKeybindingSchema = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const gnomeKeybindingPath = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/murmur/";

const kdeDestination = "org.kde.kglobalaccel";
const kdePath = "/kglobalaccel";
const kdeInterface = "org.kde.KGlobalAccel";
const kdeComponentName = "murmur";
const kdeActionName = "activation";
const kdeComponentFriendlyName = "Murmur";
const kdeActionFriendlyName = "Murmur activation";
const kdeComponentPath = `/component/${kdeComponentName}`;
const kdeComponentInterface = "org.kde.kglobalaccel.Component";

export type NativeDesktopShortcutBackend = "gnome_custom_shortcut" | "kde_kglobalaccel" | "hyprland_bind";

export interface NativeDesktopShortcutRegistrationOptions {
  accelerator: string;
  description: string;
  activationMode: ActivationMode;
  onActivated: () => void;
  onDeactivated: () => void;
  onPressedWithoutRelease: () => void;
}

export interface NativeDesktopShortcutRegistrationResult {
  attempted: boolean;
  registered: boolean;
  backend?: NativeDesktopShortcutBackend;
  pushToTalkRelease: boolean;
  triggerDescription?: string;
  diagnostics: string[];
}

type DbusNativeModule = typeof dbusNative & {
  sessionBus: (options?: Record<string, unknown>) => NativeMessageBus;
  messageType: { methodCall: number; methodReturn: number; error: number; signal: number };
};

type NativeBusConnection = BusConnection & {
  end?: () => void;
};

interface DbusExportedInterface {
  name: string;
  methods: Record<string, [string, string]>;
}

type NativeMessageBus = MessageBus & {
  connection: NativeBusConnection;
  name?: string;
  exportInterface?: (implementation: Record<string, () => void>, path: string, iface: DbusExportedInterface) => void;
  releaseName?: (name: string, callback: (error?: DbusError) => void) => void;
  requestName?: (name: string, flags: number, callback: (error?: DbusError, result?: number) => void) => void;
};

interface DbusError {
  name?: string;
  message?: unknown;
}

interface DbusMessage {
  path?: string;
  interface?: string;
  member?: string;
  body?: unknown[];
}

interface ActiveNativeRegistration {
  activationMode: ActivationMode;
  backend: NativeDesktopShortcutBackend;
  onActivated: () => void;
  onDeactivated: () => void;
  onPressedWithoutRelease: () => void;
  pushToTalkRelease: boolean;
}

interface HyprlandBinding {
  bindKey: string;
  key: string;
  mods: string;
}

const dbus = dbusNative as DbusNativeModule;

export class NativeDesktopGlobalShortcutService {
  private bus: NativeMessageBus | null = null;
  private activeRegistration: ActiveNativeRegistration | null = null;
  private callbackServiceExported = false;
  private callbackServiceRequested = false;
  private gnomeRegistered = false;
  private hyprlandBinding: HyprlandBinding | null = null;
  private kdeRegistered = false;
  private matchRules = new Set<string>();

  async register(options: NativeDesktopShortcutRegistrationOptions): Promise<NativeDesktopShortcutRegistrationResult> {
    await this.unregister();

    const diagnostics: string[] = [];
    const result = (patch: Partial<NativeDesktopShortcutRegistrationResult>): NativeDesktopShortcutRegistrationResult => ({
      attempted: patch.attempted ?? false,
      registered: patch.registered ?? false,
      backend: patch.backend,
      pushToTalkRelease: patch.pushToTalkRelease ?? false,
      triggerDescription: patch.triggerDescription,
      diagnostics: [...diagnostics, ...(patch.diagnostics ?? [])]
    });

    if (process.platform !== "linux") return result({});

    const backends = detectNativeShortcutBackends();
    if (backends.length === 0) {
      diagnostics.push("No GNOME, KDE, or Hyprland native shortcut backend was detected.");
      return result({});
    }

    if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
      diagnostics.push("No D-Bus session bus is available for native desktop global shortcuts.");
      return result({ attempted: true });
    }

    for (const backend of backends) {
      try {
        const registered = await this.registerBackend(backend, options, diagnostics);
        if (registered.registered) return result({ attempted: true, ...registered });
        await this.unregister();
      } catch (error) {
        diagnostics.push(`${backendLabel(backend)} shortcut registration failed: ${errorMessage(error)}.`);
        await this.unregister();
      }
    }

    return result({ attempted: true });
  }

  async unregister(): Promise<void> {
    this.activeRegistration = null;

    if (this.gnomeRegistered) {
      this.gnomeRegistered = false;
      await this.unregisterGnome().catch(() => undefined);
    }

    if (this.hyprlandBinding) {
      const binding = this.hyprlandBinding;
      this.hyprlandBinding = null;
      await execFileOutput("hyprctl", ["keyword", "unbind", binding.bindKey], commandTimeoutMs).catch(() => undefined);
    }

    if (this.kdeRegistered) {
      this.kdeRegistered = false;
      await this.unregisterKde().catch(() => undefined);
    }

    await this.removeAllMatches();
  }

  dispose(): void {
    void this.unregister().finally(() => {
      if (this.callbackServiceRequested && this.bus?.releaseName) {
        this.bus.releaseName(dbusServiceName, () => undefined);
      }
      this.bus?.connection.removeListener("message", this.handleMessage);
      this.bus?.connection.end?.();
      this.bus = null;
      this.callbackServiceExported = false;
      this.callbackServiceRequested = false;
    });
  }

  private async registerBackend(
    backend: NativeDesktopShortcutBackend,
    options: NativeDesktopShortcutRegistrationOptions,
    diagnostics: string[]
  ): Promise<Partial<NativeDesktopShortcutRegistrationResult> & { registered: boolean }> {
    if (backend === "gnome_custom_shortcut") return this.registerGnome(options, diagnostics);
    if (backend === "hyprland_bind") return this.registerHyprland(options, diagnostics);
    return this.registerKde(options, diagnostics);
  }

  private async registerGnome(
    options: NativeDesktopShortcutRegistrationOptions,
    diagnostics: string[]
  ): Promise<Partial<NativeDesktopShortcutRegistrationResult> & { registered: boolean }> {
    const shortcut = acceleratorToGnomeShortcut(options.accelerator);
    if (!shortcut) {
      diagnostics.push(`GNOME custom shortcuts do not support activation shortcut "${options.accelerator}".`);
      return { registered: false };
    }

    if (!(await commandExists("dbus-send"))) {
      throw new Error("dbus-send is unavailable.");
    }

    await this.ensureCallbackService();
    const existing = await this.getGnomeKeybindingPaths();
    const conflict = await this.findGnomeConflict(shortcut, existing, gnomeKeybindingPath);
    if (conflict) {
      diagnostics.push(`GNOME custom shortcut "${shortcut}" is already used by another custom shortcut.`);
      return { registered: false };
    }

    const command = dbusSendCommand("Activate");
    await execFileOutput("gsettings", ["set", `${gnomeCustomKeybindingSchema}:${gnomeKeybindingPath}`, "name", options.description], commandTimeoutMs);
    await execFileOutput("gsettings", ["set", `${gnomeCustomKeybindingSchema}:${gnomeKeybindingPath}`, "binding", shortcut], commandTimeoutMs);
    await execFileOutput("gsettings", ["set", `${gnomeCustomKeybindingSchema}:${gnomeKeybindingPath}`, "command", command], commandTimeoutMs);

    if (!existing.includes(gnomeKeybindingPath)) {
      await execFileOutput(
        "gsettings",
        ["set", gnomeMediaKeysSchema, "custom-keybindings", formatGsettingsStringList([...existing, gnomeKeybindingPath])],
        commandTimeoutMs
      );
    }

    this.gnomeRegistered = true;
    this.activeRegistration = {
      activationMode: options.activationMode,
      backend: "gnome_custom_shortcut",
      onActivated: options.onActivated,
      onDeactivated: options.onDeactivated,
      onPressedWithoutRelease: options.onPressedWithoutRelease,
      pushToTalkRelease: false
    };

    return {
      backend: "gnome_custom_shortcut",
      registered: true,
      pushToTalkRelease: false,
      triggerDescription: shortcut
    };
  }

  private async unregisterGnome(): Promise<void> {
    const existing = await this.getGnomeKeybindingPaths();
    const filtered = existing.filter((path) => path !== gnomeKeybindingPath);
    await execFileOutput("gsettings", ["set", gnomeMediaKeysSchema, "custom-keybindings", formatGsettingsStringList(filtered)], commandTimeoutMs);
    await execFileOutput("gsettings", ["reset", `${gnomeCustomKeybindingSchema}:${gnomeKeybindingPath}`, "name"], commandTimeoutMs).catch(() => undefined);
    await execFileOutput("gsettings", ["reset", `${gnomeCustomKeybindingSchema}:${gnomeKeybindingPath}`, "binding"], commandTimeoutMs).catch(() => undefined);
    await execFileOutput("gsettings", ["reset", `${gnomeCustomKeybindingSchema}:${gnomeKeybindingPath}`, "command"], commandTimeoutMs).catch(() => undefined);
  }

  private async getGnomeKeybindingPaths(): Promise<string[]> {
    const output = await execFileOutput("gsettings", ["get", gnomeMediaKeysSchema, "custom-keybindings"], commandTimeoutMs);
    return parseGsettingsStringList(output);
  }

  private async findGnomeConflict(shortcut: string, paths: string[], ownPath: string): Promise<string | null> {
    const normalizedShortcut = normalizeGnomeShortcut(shortcut);
    for (const path of paths) {
      if (path === ownPath) continue;
      try {
        const output = await execFileOutput("gsettings", ["get", `${gnomeCustomKeybindingSchema}:${path}`, "binding"], commandTimeoutMs);
        const binding = stripGsettingsString(output.trim());
        if (normalizeGnomeShortcut(binding) === normalizedShortcut) return path;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async registerHyprland(
    options: NativeDesktopShortcutRegistrationOptions,
    diagnostics: string[]
  ): Promise<Partial<NativeDesktopShortcutRegistrationResult> & { registered: boolean }> {
    await execFileOutput("hyprctl", ["version"], commandTimeoutMs).catch((error) => {
      throw new Error(`hyprctl is unavailable: ${errorMessage(error)}`);
    });

    const binding = acceleratorToHyprlandBinding(options.accelerator);
    if (!binding) {
      diagnostics.push(`Hyprland bind does not support activation shortcut "${options.accelerator}".`);
      return { registered: false };
    }

    if (!(await commandExists("dbus-send"))) {
      throw new Error("dbus-send is unavailable.");
    }

    await this.ensureCallbackService();
    await execFileOutput("hyprctl", ["keyword", "bind", `${binding.bindKey}, exec, ${dbusSendCommand("Activate")}`], commandTimeoutMs);

    const pushToTalkRelease = options.activationMode === "push_to_talk";
    if (pushToTalkRelease) {
      try {
        await execFileOutput("hyprctl", ["keyword", "bindr", `${binding.bindKey}, exec, ${dbusSendCommand("Deactivate")}`], commandTimeoutMs);
      } catch (error) {
        await execFileOutput("hyprctl", ["keyword", "unbind", binding.bindKey], commandTimeoutMs).catch(() => undefined);
        throw new Error(`Hyprland release bind failed: ${errorMessage(error)}`);
      }
    }

    this.hyprlandBinding = binding;
    this.activeRegistration = {
      activationMode: options.activationMode,
      backend: "hyprland_bind",
      onActivated: options.onActivated,
      onDeactivated: options.onDeactivated,
      onPressedWithoutRelease: options.onPressedWithoutRelease,
      pushToTalkRelease
    };

    return {
      backend: "hyprland_bind",
      registered: true,
      pushToTalkRelease,
      triggerDescription: binding.bindKey
    };
  }

  private async registerKde(
    options: NativeDesktopShortcutRegistrationOptions,
    diagnostics: string[]
  ): Promise<Partial<NativeDesktopShortcutRegistrationResult> & { registered: boolean }> {
    const qtKey = acceleratorToKdeQtKey(options.accelerator);
    if (qtKey === null) {
      diagnostics.push(`KDE KGlobalAccel does not support activation shortcut "${options.accelerator}".`);
      return { registered: false };
    }

    const bus = this.getBus();
    const actionId = kdeActionId();
    await this.addMatch(kdeSignalMatch("globalShortcutPressed"));

    const conflict = await this.findKdeConflict(qtKey);
    if (conflict) {
      diagnostics.push(`KDE KGlobalAccel shortcut "${options.accelerator}" is already owned by another component.`);
      return { registered: false };
    }

    await this.invoke({
      bus,
      destination: kdeDestination,
      path: kdePath,
      interfaceName: kdeInterface,
      member: "unRegister",
      signature: "as",
      body: [actionId]
    }).catch(() => undefined);
    await this.invoke({
      bus,
      destination: kdeDestination,
      path: kdePath,
      interfaceName: kdeInterface,
      member: "doRegister",
      signature: "as",
      body: [actionId]
    });
    const assigned = await this.invoke<unknown>({
      bus,
      destination: kdeDestination,
      path: kdePath,
      interfaceName: kdeInterface,
      member: "setShortcut",
      signature: "asaiu",
      body: [actionId, [qtKey], 0x02]
    });

    const assignedKey = Array.isArray(assigned) ? assigned[0] : undefined;
    if (typeof assignedKey === "number" && assignedKey !== qtKey) {
      await this.unregisterKde().catch(() => undefined);
      diagnostics.push(`KDE KGlobalAccel assigned a different shortcut than "${options.accelerator}".`);
      return { registered: false };
    }

    this.kdeRegistered = true;
    this.activeRegistration = {
      activationMode: options.activationMode,
      backend: "kde_kglobalaccel",
      onActivated: options.onActivated,
      onDeactivated: options.onDeactivated,
      onPressedWithoutRelease: options.onPressedWithoutRelease,
      pushToTalkRelease: false
    };

    return {
      backend: "kde_kglobalaccel",
      registered: true,
      pushToTalkRelease: false,
      triggerDescription: options.accelerator
    };
  }

  private async unregisterKde(): Promise<void> {
    if (!this.bus) return;
    await this.invoke({
      bus: this.bus,
      destination: kdeDestination,
      path: kdePath,
      interfaceName: kdeInterface,
      member: "unRegister",
      signature: "as",
      body: [kdeActionId()]
    });
  }

  private async findKdeConflict(qtKey: number): Promise<boolean> {
    try {
      const owners = await this.invoke<unknown>({
        bus: this.getBus(),
        destination: kdeDestination,
        path: kdePath,
        interfaceName: kdeInterface,
        member: "globalShortcutsByKey",
        signature: "aii",
        body: [[qtKey], 0]
      });
      if (!Array.isArray(owners)) return false;
      return owners.some((owner) => Array.isArray(owner) && owner[0] !== kdeComponentName);
    } catch {
      return false;
    }
  }

  private async ensureCallbackService(): Promise<void> {
    const bus = this.getBus();
    if (!this.callbackServiceRequested) {
      const requestResult = await this.requestName(bus, dbusServiceName);
      if (requestResult !== dbusRequestNamePrimaryOwner && requestResult !== dbusRequestNameAlreadyOwner) {
        throw new Error(`D-Bus name ${dbusServiceName} is already owned.`);
      }
      this.callbackServiceRequested = true;
    }

    if (this.callbackServiceExported) return;
    if (!bus.exportInterface) {
      throw new Error("@homebridge/dbus-native does not expose D-Bus service export support.");
    }
    bus.exportInterface(
      {
        Activate: () => this.handleActivated(),
        Deactivate: () => this.handleDeactivated()
      },
      dbusObjectPath,
      {
        name: dbusCallbackInterface,
        methods: {
          Activate: ["", ""],
          Deactivate: ["", ""]
        }
      }
    );
    this.callbackServiceExported = true;
  }

  private getBus(): NativeMessageBus {
    if (this.bus) return this.bus;
    const bus = dbus.sessionBus({ ReturnLongjs: false });
    bus.connection.on("message", this.handleMessage);
    this.bus = bus;
    return bus;
  }

  private requestName(bus: NativeMessageBus, name: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!bus.requestName) {
        reject(new Error("@homebridge/dbus-native does not expose D-Bus name ownership support."));
        return;
      }

      const timer = setTimeout(() => reject(new Error(`Timed out requesting D-Bus name ${name}.`)), nativeTimeoutMs);
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

  private invoke<T>(options: {
    bus: NativeMessageBus;
    destination: string;
    path: string;
    interfaceName: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out calling ${options.interfaceName}.${options.member}.`));
      }, nativeTimeoutMs);
      timer.unref();

      options.bus.invoke(
        {
          destination: options.destination,
          path: options.path,
          interface: options.interfaceName,
          member: options.member,
          signature: options.signature,
          body: options.body
        },
        (error, value) => {
          clearTimeout(timer);
          if (error) {
            reject(new Error(`${error.name}: ${String(error.message)}`));
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
      destination: dbusDestination,
      path: dbusPath,
      interfaceName: dbusInterface,
      member: "AddMatch",
      signature: "s",
      body: [rule]
    });
    this.matchRules.add(rule);
  }

  private async removeMatch(rule: string): Promise<void> {
    if (!this.matchRules.has(rule) || !this.bus) return;
    this.matchRules.delete(rule);
    await this.invoke({
      bus: this.bus,
      destination: dbusDestination,
      path: dbusPath,
      interfaceName: dbusInterface,
      member: "RemoveMatch",
      signature: "s",
      body: [rule]
    }).catch(() => undefined);
  }

  private async removeAllMatches(): Promise<void> {
    await Promise.all([...this.matchRules].map((rule) => this.removeMatch(rule)));
  }

  private readonly handleMessage = (message: DbusMessage): void => {
    if (message.interface !== kdeComponentInterface || message.member !== "globalShortcutPressed") return;
    if (message.path !== kdeComponentPath) return;
    const [, actionUnique] = message.body ?? [];
    if (actionUnique !== kdeActionName && actionUnique !== kdeActionFriendlyName) return;
    this.handleActivated();
  };

  private handleActivated(): void {
    const registration = this.activeRegistration;
    if (!registration) return;
    if (registration.activationMode === "push_to_talk" && !registration.pushToTalkRelease) {
      registration.onPressedWithoutRelease();
      return;
    }
    registration.onActivated();
  }

  private handleDeactivated(): void {
    const registration = this.activeRegistration;
    if (!registration || registration.activationMode !== "push_to_talk" || !registration.pushToTalkRelease) return;
    registration.onDeactivated();
  }
}

export function detectNativeShortcutBackends(
  env: Partial<Record<"HYPRLAND_INSTANCE_SIGNATURE" | "XDG_CURRENT_DESKTOP" | "XDG_SESSION_TYPE", string>> = process.env,
  platform = process.platform
): NativeDesktopShortcutBackend[] {
  if (platform !== "linux") return [];

  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
  const backends: NativeDesktopShortcutBackend[] = [];

  if (desktop.includes("gnome") || desktop.includes("ubuntu") || desktop.includes("unity")) {
    backends.push("gnome_custom_shortcut");
  }

  if (env.XDG_SESSION_TYPE === "wayland" && (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes("hyprland"))) {
    backends.push("hyprland_bind");
  }

  if (desktop.includes("kde")) {
    backends.push("kde_kglobalaccel");
  }

  return backends;
}

export function acceleratorToGnomeShortcut(accelerator: string): string | null {
  const parsed = parseAccelerator(accelerator);
  if (!parsed || !parsed.key) return null;

  const modifiers = parsed.modifiers.map((modifier) => gnomeModifierMap[modifier]).filter(Boolean);
  if (modifiers.length !== parsed.modifiers.length) return null;

  const key = gnomeKey(parsed.key);
  if (!key) return null;
  return `${modifiers.join("")}${key}`;
}

export function acceleratorToHyprlandBinding(accelerator: string): HyprlandBinding | null {
  const parsed = parseAccelerator(accelerator, { allowModifierOnly: true });
  if (!parsed) return null;

  const modifiers = parsed.modifiers.map((modifier) => hyprlandModifierMap[modifier]).filter(Boolean);
  if (modifiers.length !== parsed.modifiers.length) return null;

  let key = parsed.key ? hyprlandKey(parsed.key) : null;
  const bindingModifiers = [...modifiers];
  if (!key) {
    if (bindingModifiers.length < 2) return null;
    const triggerModifier = bindingModifiers.pop();
    key = triggerModifier ? hyprlandModifierTriggerKeys[triggerModifier] : null;
  }
  if (!key) return null;

  const uniqueModifiers = [...new Set(bindingModifiers)];
  return {
    bindKey: uniqueModifiers.length > 0 ? `${uniqueModifiers.join(" ")}, ${key}` : `, ${key}`,
    key,
    mods: uniqueModifiers.join(" ")
  };
}

export function acceleratorToKdeQtKey(accelerator: string): number | null {
  const parsed = parseAccelerator(accelerator, { allowModifierOnly: true });
  if (!parsed) return null;

  let qtKey = 0;
  for (const modifier of parsed.modifiers) {
    const value = kdeModifierMap[modifier];
    if (!value) return null;
    qtKey |= value;
  }

  if (parsed.key) {
    const key = kdeKey(parsed.key);
    if (!key) return null;
    qtKey |= key;
  }

  return qtKey === 0 ? null : qtKey;
}

interface ParsedAccelerator {
  key: string | null;
  modifiers: string[];
}

function parseAccelerator(accelerator: string, options: { allowModifierOnly?: boolean } = {}): ParsedAccelerator | null {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const token of tokens) {
    const normalized = normalizeToken(token);
    if (unsupportedModifiers.has(normalized)) return null;
    const modifier = normalizedModifierMap[normalized];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    keys.push(token);
  }

  if (keys.length > 1) return null;
  if (keys.length === 0 && !options.allowModifierOnly) return null;
  return { key: keys[0] ?? null, modifiers };
}

const unsupportedModifiers = new Set(["altgr"]);
const normalizedModifierMap: Record<string, string> = {
  alt: "alt",
  cmd: "super",
  cmdorctrl: "control",
  command: "super",
  commandorcontrol: "control",
  control: "control",
  ctrl: "control",
  meta: "super",
  option: "alt",
  shift: "shift",
  super: "super",
  win: "super"
};

const gnomeModifierMap: Record<string, string> = {
  alt: "<Alt>",
  control: "<Control>",
  shift: "<Shift>",
  super: "<Super>"
};

const hyprlandModifierMap: Record<string, string> = {
  alt: "ALT",
  control: "CTRL",
  shift: "SHIFT",
  super: "SUPER"
};

const hyprlandModifierTriggerKeys: Record<string, string> = {
  ALT: "Alt_L",
  CTRL: "Control_L",
  SHIFT: "Shift_L",
  SUPER: "Super_L"
};

const kdeModifierMap: Record<string, number> = {
  alt: 0x08000000,
  control: 0x04000000,
  shift: 0x02000000,
  super: 0x10000000
};

function gnomeKey(key: string): string | null {
  const normalized = normalizeToken(key);
  if (/^[a-z]$/.test(normalized)) return normalized;
  if (/^[0-9]$/.test(normalized)) return normalized;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(normalized)) return normalized.toUpperCase();
  return gnomeKeyMap[normalized] ?? null;
}

function hyprlandKey(key: string): string | null {
  const normalized = normalizeToken(key);
  if (/^[a-z]$/.test(normalized)) return normalized.toUpperCase();
  if (/^[0-9]$/.test(normalized)) return normalized;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(normalized)) return normalized.toUpperCase();
  return hyprlandKeyMap[normalized] ?? null;
}

function kdeKey(key: string): number | null {
  const normalized = normalizeToken(key);
  if (/^[a-z]$/.test(normalized)) return normalized.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(normalized)) return normalized.charCodeAt(0);
  const fKey = normalized.match(/^f([1-9]|1[0-9]|2[0-4])$/);
  if (fKey) return 0x0100002f + Number(fKey[1]);
  return kdeKeyMap[normalized] ?? null;
}

const gnomeKeyMap: Record<string, string> = {
  "`": "grave",
  "'": "apostrophe",
  ",": "comma",
  "-": "minus",
  ".": "period",
  "/": "slash",
  "\\": "backslash",
  "[": "bracketleft",
  "]": "bracketright",
  "=": "equal",
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
  grave: "grave",
  home: "Home",
  insert: "Insert",
  left: "Left",
  minus: "minus",
  pagedown: "Page_Down",
  pageup: "Page_Up",
  period: "period",
  plus: "plus",
  printscreen: "Print",
  quote: "apostrophe",
  return: "Return",
  right: "Right",
  scrolllock: "Scroll_Lock",
  semicolon: "semicolon",
  slash: "slash",
  space: "space",
  tab: "Tab",
  up: "Up"
};

const hyprlandKeyMap: Record<string, string> = {
  "`": "grave",
  "'": "apostrophe",
  ",": "comma",
  "-": "minus",
  ".": "period",
  "/": "slash",
  "\\": "backslash",
  "[": "bracketleft",
  "]": "bracketright",
  "=": "equal",
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
  grave: "grave",
  home: "Home",
  insert: "Insert",
  left: "Left",
  minus: "minus",
  pagedown: "Page_Down",
  pageup: "Page_Up",
  period: "period",
  plus: "plus",
  printscreen: "Print",
  quote: "apostrophe",
  return: "Return",
  right: "Right",
  scrolllock: "Scroll_Lock",
  semicolon: "semicolon",
  slash: "slash",
  space: "space",
  tab: "Tab",
  up: "Up"
};

const kdeKeyMap: Record<string, number> = {
  "`": 0x60,
  "'": 0x27,
  ",": 0x2c,
  "-": 0x2d,
  ".": 0x2e,
  "/": 0x2f,
  "\\": 0x5c,
  "[": 0x5b,
  "]": 0x5d,
  "=": 0x3d,
  arrowdown: 0x01000015,
  arrowleft: 0x01000012,
  arrowright: 0x01000014,
  arrowup: 0x01000013,
  backquote: 0x60,
  backslash: 0x5c,
  backspace: 0x01000003,
  bracketleft: 0x5b,
  bracketright: 0x5d,
  comma: 0x2c,
  delete: 0x01000007,
  down: 0x01000015,
  end: 0x01000011,
  enter: 0x01000005,
  equal: 0x3d,
  escape: 0x01000000,
  grave: 0x60,
  home: 0x01000010,
  insert: 0x01000006,
  left: 0x01000012,
  minus: 0x2d,
  pagedown: 0x01000017,
  pageup: 0x01000016,
  period: 0x2e,
  plus: 0x2b,
  printscreen: 0x01000009,
  quote: 0x27,
  return: 0x01000004,
  right: 0x01000014,
  scrolllock: 0x01000026,
  semicolon: 0x3b,
  slash: 0x2f,
  space: 0x20,
  tab: 0x01000001,
  up: 0x01000013
};

function normalizeToken(token: string): string {
  return token.replace(/\s+/g, "").toLowerCase();
}

function parseGsettingsStringList(output: string): string[] {
  const match = output.match(/\[([^\]]*)\]/);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(",")
    .map((entry) => stripGsettingsString(entry.trim()))
    .filter(Boolean);
}

function formatGsettingsStringList(values: string[]): string {
  return `[${values.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(", ")}]`;
}

function stripGsettingsString(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function normalizeGnomeShortcut(shortcut: string): string {
  const modifiers: string[] = [];
  const key = shortcut.replace(/<(\w+)>/g, (_match, modifier: string) => {
    modifiers.push(modifier.toLowerCase() === "primary" ? "control" : modifier.toLowerCase());
    return "";
  });
  modifiers.sort();
  return `${modifiers.map((modifier) => `<${modifier}>`).join("")}${key.toLowerCase()}`;
}

function dbusSendCommand(method: "Activate" | "Deactivate"): string {
  return `dbus-send --session --type=method_call --dest=${dbusServiceName} ${dbusObjectPath} ${dbusCallbackInterface}.${method}`;
}

function kdeActionId(): string[] {
  return [kdeComponentName, kdeActionName, kdeComponentFriendlyName, kdeActionFriendlyName];
}

function kdeSignalMatch(member: string): string {
  return `type='signal',sender='${kdeDestination}',path='${kdeComponentPath}',interface='${kdeComponentInterface}',member='${member}'`;
}

function backendLabel(backend: NativeDesktopShortcutBackend): string {
  if (backend === "gnome_custom_shortcut") return "GNOME";
  if (backend === "hyprland_bind") return "Hyprland";
  return "KDE";
}

function execFileOutput(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ""}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function commandExists(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(file, [], { timeout: commandTimeoutMs }, (error) => {
      if (!error) {
        resolve(true);
        return;
      }
      resolve((error as NodeJS.ErrnoException).code !== "ENOENT");
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
