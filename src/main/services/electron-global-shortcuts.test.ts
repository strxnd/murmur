import { describe, expect, it } from "vitest";
import {
  registerElectronShortcutActions,
  registerModeSelectorNavigationShortcuts,
  type ElectronShortcutRegistrar,
  type ElectronTransientShortcutRegistrar
} from "./electron-global-shortcuts";

describe("registerElectronShortcutActions", () => {
  it("reports registration metadata for the mode selector shortcut", () => {
    const registered = new Set<string>();
    const registrar: ElectronShortcutRegistrar = {
      register: (accelerator) => {
        registered.add(accelerator);
        return true;
      },
      isRegistered: (accelerator) => registered.has(accelerator)
    };

    const result = registerElectronShortcutActions(registrar, [
      {
        id: "activation",
        label: "activation",
        accelerator: "CommandOrControl+Alt+Space",
        onActivated: () => undefined
      },
      {
        id: "mode-selector",
        label: "mode selector",
        accelerator: "Alt+Shift+K",
        onActivated: () => undefined
      }
    ]);

    expect(result.actionResults["mode-selector"]).toEqual({
      registered: true,
      diagnostics: []
    });
  });

  it("temporarily registers mode selector navigation shortcuts and unregisters them", () => {
    const registered = new Map<string, () => void>();
    const calls: string[] = [];
    const registrar: ElectronTransientShortcutRegistrar = {
      register: (accelerator, callback) => {
        registered.set(accelerator, callback);
        return true;
      },
      isRegistered: (accelerator) => registered.has(accelerator),
      unregister: (accelerator) => {
        registered.delete(accelerator);
      }
    };

    const registration = registerModeSelectorNavigationShortcuts(registrar, {
      hide: () => calls.push("hide"),
      next: () => calls.push("next"),
      previous: () => calls.push("previous")
    });

    expect(registration.diagnostics).toEqual([]);
    expect(registration.registeredAccelerators).toEqual(["Escape", "Up", "Down"]);

    registered.get("Escape")?.();
    registered.get("Up")?.();
    registered.get("Down")?.();

    expect(calls).toEqual(["hide", "previous", "next"]);

    registration.unregister();

    expect([...registered.keys()]).toEqual([]);
    expect(registration.registeredAccelerators).toEqual([]);
  });

  it("reports mode selector navigation shortcuts already registered by Murmur", () => {
    const registered = new Set(["Up"]);
    const registrar: ElectronTransientShortcutRegistrar = {
      register: (accelerator) => {
        registered.add(accelerator);
        return true;
      },
      isRegistered: (accelerator) => registered.has(accelerator),
      unregister: (accelerator) => {
        registered.delete(accelerator);
      }
    };

    const registration = registerModeSelectorNavigationShortcuts(registrar, {
      hide: () => undefined,
      next: () => undefined,
      previous: () => undefined
    });

    expect(registration.registeredAccelerators).toEqual(["Escape", "Down"]);
    expect(registration.diagnostics).toEqual([
      "Unable to register mode selector previous mode shortcut globally: Up is already registered by Murmur."
    ]);
  });
});
