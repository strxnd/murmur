import { execFile } from "node:child_process";
import * as dbusNative from "@homebridge/dbus-native";
import type { BusConnection, MessageBus } from "@homebridge/dbus-native";
import type { ActivationMode, GlobalShortcutActionId } from "../../shared/types";

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

const kdeDestination = "org.kde.kglobalaccel";
const kdePath = "/kglobalaccel";
const kdeInterface = "org.kde.KGlobalAccel";
const kdeComponentName = "murmur";
const kdeComponentFriendlyName = "Murmur";
const kdeComponentPath = `/component/${kdeComponentName}`;
const kdeComponentInterface = "org.kde.kglobalaccel.Component";

const shortcutActionIds: GlobalShortcutActionId[] = ["activation", "mode-selector"];
const shortcutActionDefinitions: Record<
  GlobalShortcutActionId,
  {
    dbusMethod: "Activate" | "Deactivate" | "ModeSelector";
    gnomePath: string;
    kdeActionName: string;
    kdeActionFriendlyName: string;
    label: string;
  }
> = {
  activation: {
    dbusMethod: "Activate",
    gnomePath: "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/murmur/",
    kdeActionName: "activation",
    kdeActionFriendlyName: "Murmur activation",
    label: "activation"
  },
  "mode-selector": {
    dbusMethod: "ModeSelector",
    gnomePath: "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/murmur-mode-selector/",
    kdeActionName: "mode-selector",
    kdeActionFriendlyName: "Murmur mode selector",
    label: "mode selector"
  }
};

export type NativeDesktopShortcutBackend = "gnome_custom_shortcut" | "kde_kglobalaccel" | "hyprland_bind";

export interface NativeDesktopShortcutActionRegistration {
  id: GlobalShortcutActionId;
  accelerator: string;
  description: string;
  activationMode: ActivationMode;
  onActivated: () => void;
  onDeactivated: () => void;
  onPressedWithoutRelease: () => void;
}

export interface NativeDesktopShortcutRegistrationOptions {
  actions: NativeDesktopShortcutActionRegistration[];
}

export interface NativeDesktopShortcutRegistrationResult {
  attempted: boolean;
  registered: boolean;
  backend?: NativeDesktopShortcutBackend;
  pushToTalkRelease: boolean;
  triggerDescription?: string;
  diagnostics: string[];
  actionResults: Record<GlobalShortcutActionId, NativeDesktopShortcutActionResult>;
}

export interface NativeDesktopShortcutActionResult {
  registered: boolean;
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

interface RegisteredHyprlandBinding extends HyprlandBinding {
  releaseBindKey?: string;
}

const dbus = dbusNative as DbusNativeModule;

export class NativeDesktopGlobalShortcutService {
  private bus: NativeMessageBus | null = null;
  private activeRegistrations = new Map<GlobalShortcutActionId, ActiveNativeRegistration>();
  private callbackServiceExported = false;
  private callbackServiceRequested = false;
  private gnomeRegistered = new Set<GlobalShortcutActionId>();
  private hyprlandBindings = new Map<GlobalShortcutActionId, RegisteredHyprlandBinding>();
  private kdeRegistered = new Set<GlobalShortcutActionId>();
  private matchRules = new Set<string>();

  async register(options: NativeDesktopShortcutRegistrationOptions): Promise<NativeDesktopShortcutRegistrationResult> {
    await this.unregister();

    const diagnostics: string[] = [];
    const actionResults = emptyActionResults();
    const result = (patch: Partial<NativeDesktopShortcutRegistrationResult>): NativeDesktopShortcutRegistrationResult => ({
      attempted: patch.attempted ?? false,
      registered: patch.registered ?? false,
      backend: patch.backend,
      pushToTalkRelease: patch.pushToTalkRelease ?? false,
      triggerDescription: patch.triggerDescription,
      diagnostics: [...diagnostics, ...(patch.diagnostics ?? [])],
      actionResults: patch.actionResults ?? actionResults
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
    this.activeRegistrations.clear();

    if (this.gnomeRegistered.size > 0) {
      const registered = new Set(this.gnomeRegistered);
      this.gnomeRegistered.clear();
      await this.unregisterGnome().catch(() => undefined);
      for (const id of registered) this.activeRegistrations.delete(id);
    }

    if (this.hyprlandBindings.size > 0) {
      const bindings = [...this.hyprlandBindings.values()];
      this.hyprlandBindings.clear();
      await Promise.all(
        bindings.flatMap((binding) => [
          execFileOutput("hyprctl", ["keyword", "unbind", binding.bindKey], commandTimeoutMs).catch(() => undefined),
          binding.releaseBindKey
            ? execFileOutput("hyprctl", ["keyword", "unbind", binding.releaseBindKey], commandTimeoutMs).catch(() => undefined)
            : Promise.resolve("")
        ])
      );
    }

    if (this.kdeRegistered.size > 0) {
      this.kdeRegistered.clear();
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
    if (!(await commandExists("dbus-send"))) {
      throw new Error("dbus-send is unavailable.");
    }

    await this.ensureCallbackService();
    const existing = await this.getGnomeKeybindingPaths();
    const ownPaths = shortcutActionIds.map((id) => shortcutActionDefinitions[id].gnomePath);
    const nextPaths = [...existing];
    const actionResults = emptyActionResults();
    const usedShortcuts = new Set<string>();

    for (const action of options.actions) {
      const definition = shortcutActionDefinitions[action.id];
      const shortcut = acceleratorToGnomeShortcut(action.accelerator);
      if (!shortcut) {
        actionResults[action.id].diagnostics.push(
          `GNOME custom shortcuts do not support ${definition.label} shortcut "${action.accelerator}".`
        );
        continue;
      }
      const normalizedShortcut = normalizeGnomeShortcut(shortcut);
      if (usedShortcuts.has(normalizedShortcut)) {
        actionResults[action.id].diagnostics.push(`GNOME custom shortcut "${shortcut}" is already used by another Murmur shortcut.`);
        continue;
      }
      usedShortcuts.add(normalizedShortcut);

      const conflict = await this.findGnomeConflict(shortcut, existing, ownPaths);
      if (conflict) {
        actionResults[action.id].diagnostics.push(`GNOME custom shortcut "${shortcut}" is already used by another custom shortcut.`);
        continue;
      }

      const command = dbusSendCommand(definition.dbusMethod);
      await execFileOutput(
        "gsettings",
        ["set", `${gnomeCustomKeybindingSchema}:${definition.gnomePath}`, "name", action.description],
        commandTimeoutMs
      );
      await execFileOutput(
        "gsettings",
        ["set", `${gnomeCustomKeybindingSchema}:${definition.gnomePath}`, "binding", shortcut],
        commandTimeoutMs
      );
      await execFileOutput(
        "gsettings",
        ["set", `${gnomeCustomKeybindingSchema}:${definition.gnomePath}`, "command", command],
        commandTimeoutMs
      );

      if (!nextPaths.includes(definition.gnomePath)) {
        nextPaths.push(definition.gnomePath);
      }

      const pushToTalkRelease = false;
      this.gnomeRegistered.add(action.id);
      this.activeRegistrations.set(action.id, {
        activationMode: action.activationMode,
        backend: "gnome_custom_shortcut",
        onActivated: action.onActivated,
        onDeactivated: action.onDeactivated,
        onPressedWithoutRelease: action.onPressedWithoutRelease,
        pushToTalkRelease
      });
      actionResults[action.id] = {
        registered: true,
        pushToTalkRelease,
        triggerDescription: shortcut,
        diagnostics: actionResults[action.id].diagnostics
      };
    }

    const activationResult = actionResults.activation;
    if (!activationResult.registered) {
      return { registered: false, actionResults };
    }

    if (nextPaths.length !== existing.length || nextPaths.some((path, index) => path !== existing[index])) {
      await execFileOutput(
        "gsettings",
        ["set", gnomeMediaKeysSchema, "custom-keybindings", formatGsettingsStringList(nextPaths)],
        commandTimeoutMs
      );
    }

    return {
      backend: "gnome_custom_shortcut",
      registered: true,
      pushToTalkRelease: activationResult.pushToTalkRelease,
      triggerDescription: activationResult.triggerDescription,
      actionResults
    };
  }

  private async unregisterGnome(): Promise<void> {
    const existing = await this.getGnomeKeybindingPaths();
    const ownPaths = new Set(shortcutActionIds.map((id) => shortcutActionDefinitions[id].gnomePath));
    const filtered = existing.filter((path) => !ownPaths.has(path));
    await execFileOutput("gsettings", ["set", gnomeMediaKeysSchema, "custom-keybindings", formatGsettingsStringList(filtered)], commandTimeoutMs);
    for (const path of ownPaths) {
      await execFileOutput("gsettings", ["reset", `${gnomeCustomKeybindingSchema}:${path}`, "name"], commandTimeoutMs).catch(() => undefined);
      await execFileOutput("gsettings", ["reset", `${gnomeCustomKeybindingSchema}:${path}`, "binding"], commandTimeoutMs).catch(() => undefined);
      await execFileOutput("gsettings", ["reset", `${gnomeCustomKeybindingSchema}:${path}`, "command"], commandTimeoutMs).catch(() => undefined);
    }
  }

  private async getGnomeKeybindingPaths(): Promise<string[]> {
    const output = await execFileOutput("gsettings", ["get", gnomeMediaKeysSchema, "custom-keybindings"], commandTimeoutMs);
    return parseGsettingsStringList(output);
  }

  private async findGnomeConflict(shortcut: string, paths: string[], ownPaths: string[]): Promise<string | null> {
    const normalizedShortcut = normalizeGnomeShortcut(shortcut);
    const ownPathSet = new Set(ownPaths);
    for (const path of paths) {
      if (ownPathSet.has(path)) continue;
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

    if (!(await commandExists("dbus-send"))) {
      throw new Error("dbus-send is unavailable.");
    }

    await this.ensureCallbackService();
    const actionResults = emptyActionResults();
    const usedBindKeys = new Set<string>();

    for (const action of options.actions) {
      const definition = shortcutActionDefinitions[action.id];
      const binding = acceleratorToHyprlandBinding(action.accelerator);
      if (!binding) {
        actionResults[action.id].diagnostics.push(`Hyprland bind does not support ${definition.label} shortcut "${action.accelerator}".`);
        continue;
      }
      if (usedBindKeys.has(binding.bindKey)) {
        actionResults[action.id].diagnostics.push(`Hyprland bind "${binding.bindKey}" is already used by another Murmur shortcut.`);
        continue;
      }
      usedBindKeys.add(binding.bindKey);

      await execFileOutput(
        "hyprctl",
        ["keyword", "bind", `${binding.bindKey}, exec, ${dbusSendCommand(definition.dbusMethod)}`],
        commandTimeoutMs
      );

      const pushToTalkRelease = action.id === "activation" && action.activationMode === "push_to_talk";
      let releaseBindKey: string | undefined;
      if (pushToTalkRelease) {
        try {
          await execFileOutput("hyprctl", ["keyword", "bindr", `${binding.bindKey}, exec, ${dbusSendCommand("Deactivate")}`], commandTimeoutMs);
          releaseBindKey = binding.bindKey;
        } catch (error) {
          await execFileOutput("hyprctl", ["keyword", "unbind", binding.bindKey], commandTimeoutMs).catch(() => undefined);
          throw new Error(`Hyprland release bind failed: ${errorMessage(error)}`);
        }
      }

      this.hyprlandBindings.set(action.id, { ...binding, releaseBindKey });
      this.activeRegistrations.set(action.id, {
        activationMode: action.activationMode,
        backend: "hyprland_bind",
        onActivated: action.onActivated,
        onDeactivated: action.onDeactivated,
        onPressedWithoutRelease: action.onPressedWithoutRelease,
        pushToTalkRelease
      });
      actionResults[action.id] = {
        registered: true,
        pushToTalkRelease,
        triggerDescription: binding.bindKey,
        diagnostics: actionResults[action.id].diagnostics
      };
    }

    const activationResult = actionResults.activation;
    if (!activationResult.registered) {
      return { registered: false, actionResults };
    }

    return {
      backend: "hyprland_bind",
      registered: true,
      pushToTalkRelease: activationResult.pushToTalkRelease,
      triggerDescription: activationResult.triggerDescription,
      actionResults
    };
  }

  private async registerKde(
    options: NativeDesktopShortcutRegistrationOptions,
    diagnostics: string[]
  ): Promise<Partial<NativeDesktopShortcutRegistrationResult> & { registered: boolean }> {
    const bus = this.getBus();
    await this.addMatch(kdeSignalMatch("globalShortcutPressed"));
    const actionResults = emptyActionResults();
    const usedQtKeys = new Set<number>();

    for (const action of options.actions) {
      const definition = shortcutActionDefinitions[action.id];
      const qtKey = acceleratorToKdeQtKey(action.accelerator);
      if (qtKey === null) {
        actionResults[action.id].diagnostics.push(`KDE KGlobalAccel does not support ${definition.label} shortcut "${action.accelerator}".`);
        continue;
      }
      if (usedQtKeys.has(qtKey)) {
        actionResults[action.id].diagnostics.push(`KDE KGlobalAccel shortcut "${action.accelerator}" is already used by another Murmur shortcut.`);
        continue;
      }
      usedQtKeys.add(qtKey);

      const conflict = await this.findKdeConflict(qtKey);
      if (conflict) {
        actionResults[action.id].diagnostics.push(`KDE KGlobalAccel shortcut "${action.accelerator}" is already owned by another component.`);
        continue;
      }

      const actionId = kdeActionId(action.id);
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
        await this.invoke({
          bus,
          destination: kdeDestination,
          path: kdePath,
          interfaceName: kdeInterface,
          member: "unRegister",
          signature: "as",
          body: [actionId]
        }).catch(() => undefined);
        actionResults[action.id].diagnostics.push(`KDE KGlobalAccel assigned a different shortcut than "${action.accelerator}".`);
        continue;
      }

      this.kdeRegistered.add(action.id);
      this.activeRegistrations.set(action.id, {
        activationMode: action.activationMode,
        backend: "kde_kglobalaccel",
        onActivated: action.onActivated,
        onDeactivated: action.onDeactivated,
        onPressedWithoutRelease: action.onPressedWithoutRelease,
        pushToTalkRelease: false
      });
      actionResults[action.id] = {
        registered: true,
        pushToTalkRelease: false,
        triggerDescription: action.accelerator,
        diagnostics: actionResults[action.id].diagnostics
      };
    }

    const activationResult = actionResults.activation;
    if (!activationResult.registered) {
      return { registered: false, actionResults };
    }

    return {
      backend: "kde_kglobalaccel",
      registered: true,
      pushToTalkRelease: activationResult.pushToTalkRelease,
      triggerDescription: activationResult.triggerDescription,
      actionResults
    };
  }

  private async unregisterKde(): Promise<void> {
    if (!this.bus) return;
    await Promise.all(
      shortcutActionIds.map((id) =>
        this.invoke({
          bus: this.bus!,
          destination: kdeDestination,
          path: kdePath,
          interfaceName: kdeInterface,
          member: "unRegister",
          signature: "as",
          body: [kdeActionId(id)]
        }).catch(() => undefined)
      )
    );
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
        Activate: () => this.handleActivated("activation"),
        Deactivate: () => this.handleDeactivated("activation"),
        ModeSelector: () => this.handleActivated("mode-selector")
      },
      dbusObjectPath,
      {
        name: dbusCallbackInterface,
        methods: {
          Activate: ["", ""],
          Deactivate: ["", ""],
          ModeSelector: ["", ""]
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
    const actionId = kdeActionIdFromSignal(actionUnique);
    if (!actionId) return;
    this.handleActivated(actionId);
  };

  private handleActivated(actionId: GlobalShortcutActionId): void {
    const registration = this.activeRegistrations.get(actionId);
    if (!registration) return;
    if (registration.activationMode === "push_to_talk" && !registration.pushToTalkRelease) {
      registration.onPressedWithoutRelease();
      return;
    }
    registration.onActivated();
  }

  private handleDeactivated(actionId: GlobalShortcutActionId): void {
    const registration = this.activeRegistrations.get(actionId);
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

function dbusSendCommand(method: "Activate" | "Deactivate" | "ModeSelector"): string {
  return `dbus-send --session --type=method_call --dest=${dbusServiceName} ${dbusObjectPath} ${dbusCallbackInterface}.${method}`;
}

function kdeActionId(id: GlobalShortcutActionId): string[] {
  const definition = shortcutActionDefinitions[id];
  return [kdeComponentName, definition.kdeActionName, kdeComponentFriendlyName, definition.kdeActionFriendlyName];
}

function kdeActionIdFromSignal(actionUnique: unknown): GlobalShortcutActionId | null {
  for (const id of shortcutActionIds) {
    const definition = shortcutActionDefinitions[id];
    if (actionUnique === definition.kdeActionName || actionUnique === definition.kdeActionFriendlyName) return id;
  }
  return null;
}

function kdeSignalMatch(member: string): string {
  return `type='signal',sender='${kdeDestination}',path='${kdeComponentPath}',interface='${kdeComponentInterface}',member='${member}'`;
}

function backendLabel(backend: NativeDesktopShortcutBackend): string {
  if (backend === "gnome_custom_shortcut") return "GNOME";
  if (backend === "hyprland_bind") return "Hyprland";
  return "KDE";
}

function emptyActionResults(): Record<GlobalShortcutActionId, NativeDesktopShortcutActionResult> {
  return {
    activation: { registered: false, pushToTalkRelease: false, diagnostics: [] },
    "mode-selector": { registered: false, pushToTalkRelease: false, diagnostics: [] }
  };
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
