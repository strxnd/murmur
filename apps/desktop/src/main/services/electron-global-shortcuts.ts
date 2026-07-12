import type { GlobalShortcutActionId } from "../../shared/types";

export interface ElectronShortcutActionRegistration {
  id: GlobalShortcutActionId;
  label: string;
  accelerator: string;
  onActivated: () => void;
}

export interface ElectronShortcutActionResult {
  registered: boolean;
  diagnostics: string[];
}

export interface ElectronShortcutRegistrationResult {
  actionResults: Record<GlobalShortcutActionId, ElectronShortcutActionResult>;
}

export interface ElectronShortcutRegistrar {
  register: (accelerator: string, callback: () => void) => boolean;
  isRegistered: (accelerator: string) => boolean;
}

export interface ElectronTransientShortcutRegistrar extends ElectronShortcutRegistrar {
  unregister: (accelerator: string) => void;
}

export function registerElectronShortcutActions(
  registrar: ElectronShortcutRegistrar,
  actions: ElectronShortcutActionRegistration[]
): ElectronShortcutRegistrationResult {
  const actionResults = emptyActionResults();

  for (const action of actions) {
    const diagnostics: string[] = [];
    try {
      const registered = registrar.register(action.accelerator, action.onActivated);
      const isRegistered = registered && registrar.isRegistered(action.accelerator);
      if (!isRegistered) {
        diagnostics.push(`Unable to register ${action.label} hotkey globally: ${action.accelerator}`);
      }
      actionResults[action.id] = { registered: isRegistered, diagnostics };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actionResults[action.id] = {
        registered: false,
        diagnostics: [`Invalid ${action.label} hotkey "${action.accelerator}": ${message}`]
      };
    }
  }

  return { actionResults };
}

type ModeSelectorNavigationAction = "hide" | "next" | "previous";

interface ModeSelectorNavigationShortcut {
  accelerator: string;
  action: ModeSelectorNavigationAction;
  label: string;
}

export interface ModeSelectorNavigationShortcutCallbacks {
  hide: () => void;
  next: () => void;
  previous: () => void;
}

export interface ModeSelectorNavigationShortcutRegistration {
  diagnostics: string[];
  registeredAccelerators: string[];
  unregister: () => void;
}

const modeSelectorNavigationShortcuts: ModeSelectorNavigationShortcut[] = [
  { accelerator: "Escape", action: "hide", label: "hide selector" },
  { accelerator: "Up", action: "previous", label: "previous mode" },
  { accelerator: "Down", action: "next", label: "next mode" }
];

export function registerModeSelectorNavigationShortcuts(
  registrar: ElectronTransientShortcutRegistrar,
  callbacks: ModeSelectorNavigationShortcutCallbacks
): ModeSelectorNavigationShortcutRegistration {
  const diagnostics: string[] = [];
  const registeredAccelerators: string[] = [];

  for (const shortcut of modeSelectorNavigationShortcuts) {
    try {
      if (registrar.isRegistered(shortcut.accelerator)) {
        diagnostics.push(
          `Unable to register mode selector ${shortcut.label} shortcut globally: ${shortcut.accelerator} is already registered by Murmur.`
        );
        continue;
      }

      const registered = registrar.register(shortcut.accelerator, callbacks[shortcut.action]);
      const isRegistered = registered && registrar.isRegistered(shortcut.accelerator);
      if (isRegistered) {
        registeredAccelerators.push(shortcut.accelerator);
      } else {
        diagnostics.push(`Unable to register mode selector ${shortcut.label} shortcut globally: ${shortcut.accelerator}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(`Invalid mode selector ${shortcut.label} shortcut "${shortcut.accelerator}": ${message}`);
    }
  }

  return {
    diagnostics,
    registeredAccelerators,
    unregister: () => {
      for (const accelerator of registeredAccelerators.splice(0)) {
        registrar.unregister(accelerator);
      }
    }
  };
}

function emptyActionResults(): Record<GlobalShortcutActionId, ElectronShortcutActionResult> {
  return {
    activation: { registered: false, diagnostics: [] },
    "mode-selector": { registered: false, diagnostics: [] }
  };
}
