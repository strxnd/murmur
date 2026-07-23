import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  acceleratorToPortalTrigger,
  XdgGlobalShortcutService,
  shortcutDescriptionForActivationMode,
  shortcutDescriptionForModeSelector,
  shortcutPropertiesForPortalVersion
} from "./xdg-global-shortcuts";

describe("acceleratorToPortalTrigger", () => {
  it("maps supported Electron accelerators to portal triggers", () => {
    expect(acceleratorToPortalTrigger("Alt+R")).toBe("ALT+r");
    expect(acceleratorToPortalTrigger("CommandOrControl+Alt+Space")).toBe("CTRL+ALT+space");
    expect(acceleratorToPortalTrigger("Super+Shift+F9")).toBe("LOGO+SHIFT+F9");
    expect(acceleratorToPortalTrigger("CommandOrControl+Left")).toBe("CTRL+Left");
    expect(acceleratorToPortalTrigger("Shift+Return")).toBe("SHIFT+Return");
    expect(acceleratorToPortalTrigger("Alt+,")).toBe("ALT+comma");
    expect(acceleratorToPortalTrigger("Alt+Shift+K")).toBe("ALT+SHIFT+k");
  });

  it("rejects unsupported accelerators", () => {
    expect(acceleratorToPortalTrigger("AltGr+R")).toBeNull();
    expect(acceleratorToPortalTrigger("VolumeUp")).toBeNull();
    expect(acceleratorToPortalTrigger("Alt+VolumeUp")).toBeNull();
    expect(acceleratorToPortalTrigger("CommandOrControl+Alt")).toBeNull();
    expect(acceleratorToPortalTrigger("CommandOrControl+A+B")).toBeNull();
  });

  it("normalizes duplicate modifiers", () => {
    expect(acceleratorToPortalTrigger("Alt+Alt+R")).toBe("ALT+r");
    expect(acceleratorToPortalTrigger("CommandOrControl+Control+Space")).toBe("CTRL+space");
  });

  it("maps CommandOrControl to CTRL on Linux portal triggers", () => {
    expect(acceleratorToPortalTrigger("CommandOrControl+K")).toBe("CTRL+k");
  });
});

describe("shortcutDescriptionForActivationMode", () => {
  it("chooses the portal description for each activation mode", () => {
    expect(shortcutDescriptionForActivationMode("push_to_talk")).toBe("Push to talk with Murmur");
    expect(shortcutDescriptionForActivationMode("toggle")).toBe("Toggle Murmur recording");
    expect(shortcutDescriptionForModeSelector()).toBe("Show Murmur mode selector");
  });
});

class FakeGlobalShortcutsBus {
  readonly connection = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
  readonly calls: Array<{ body?: unknown[]; interface?: string; member?: string; path?: string }> = [];
  name = ":1.77";
  private requestCount = 0;

  constructor(private readonly bindDelayMs = 0) {
    this.connection.end = vi.fn();
  }

  invoke(
    message: { body?: unknown[]; interface?: string; member?: string; path?: string },
    callback: (error: Error | null, value?: unknown) => void
  ): void {
    this.calls.push(message);
    if (message.interface === "org.freedesktop.DBus" && message.member === "GetNameOwner") {
      callback(null, ":1.10");
      return;
    }
    if (message.interface === "org.freedesktop.DBus" || message.interface === "org.freedesktop.host.portal.Registry") {
      callback(null);
      return;
    }
    if (message.interface === "org.freedesktop.DBus.Properties") {
      callback(null, ["u", 2]);
      return;
    }
    if (message.interface === "org.freedesktop.portal.GlobalShortcuts" && message.member) {
      const handle = `/org/freedesktop/portal/desktop/request/1_77/request${++this.requestCount}`;
      callback(null, handle);
      const response =
        message.member === "CreateSession"
          ? [0, [["session_handle", ["s", "/org/freedesktop/portal/desktop/session/1_77/murmur"]]]]
          : [
              0,
              [
                [
                  "shortcuts",
                  ["a(sa{sv})", [["activation", [["trigger_description", ["s", "ALT+SHIFT+r"]]]]]]
                ]
              ]
            ];
      setTimeout(() => {
        this.connection.emit("message", {
          sender: ":1.10",
          path: handle,
          interface: "org.freedesktop.portal.Request",
          member: "Response",
          body: response
        });
      }, message.member === "BindShortcuts" ? this.bindDelayMs : 0);
      return;
    }
    callback(null);
  }
}

describe("XdgGlobalShortcutService", () => {
  it("uses an interactive deadline and reports each shortcut action independently", async () => {
    const bus = new FakeGlobalShortcutsBus(15);
    const service = new XdgGlobalShortcutService({
      platform: "linux",
      env: { DBUS_SESSION_BUS_ADDRESS: "session" },
      createBus: () => bus as never,
      portalTimeoutMs: 5,
      interactiveTimeoutMs: 50
    });

    const result = await service.register({
      actions: [
        {
          id: "activation",
          accelerator: "Alt+Shift+R",
          description: "Toggle Murmur recording",
          activationMode: "toggle",
          onActivated: vi.fn(),
          onDeactivated: vi.fn()
        },
        {
          id: "mode-selector",
          accelerator: "Alt+Shift+K",
          description: "Show Murmur mode selector",
          activationMode: "toggle",
          onActivated: vi.fn(),
          onDeactivated: vi.fn()
        }
      ]
    });

    expect(result.actionResults.activation.registered).toBe(true);
    expect(result.actionResults["mode-selector"].registered).toBe(false);
  });

  it("authenticates portal signals and invalidates registration when the session closes", async () => {
    const bus = new FakeGlobalShortcutsBus();
    const activated = vi.fn();
    const onRegistrationLost = vi.fn();
    const service = new XdgGlobalShortcutService({
      platform: "linux",
      env: { DBUS_SESSION_BUS_ADDRESS: "session" },
      createBus: () => bus as never,
      onRegistrationLost
    });
    await service.register({
      actions: [
        {
          id: "activation",
          accelerator: "Alt+Shift+R",
          description: "Toggle Murmur recording",
          activationMode: "toggle",
          onActivated: activated,
          onDeactivated: vi.fn()
        }
      ]
    });

    const sessionHandle = "/org/freedesktop/portal/desktop/session/1_77/murmur";
    bus.connection.emit("message", {
      sender: ":1.99",
      path: "/org/freedesktop/portal/desktop",
      interface: "org.freedesktop.portal.GlobalShortcuts",
      member: "Activated",
      body: [sessionHandle, "activation"]
    });
    bus.connection.emit("message", {
      sender: ":1.10",
      path: "/org/freedesktop/portal/desktop",
      interface: "org.freedesktop.portal.GlobalShortcuts",
      member: "Activated",
      body: [sessionHandle, "activation"]
    });
    expect(activated).toHaveBeenCalledOnce();

    bus.connection.emit("message", {
      sender: ":1.10",
      path: sessionHandle,
      interface: "org.freedesktop.portal.Session",
      member: "Closed",
      body: []
    });
    expect(onRegistrationLost).toHaveBeenCalledOnce();
    expect(bus.connection.end).toHaveBeenCalledOnce();
  });
});

describe("shortcutPropertiesForPortalVersion", () => {
  it("omits preferred triggers for portal versions that do not support them", () => {
    expect(shortcutPropertiesForPortalVersion("Toggle Murmur recording", "CTRL+ALT+space", 1)).toEqual([
      ["description", ["s", "Toggle Murmur recording"]]
    ]);
  });

  it("includes preferred triggers for portal versions that support them", () => {
    expect(shortcutPropertiesForPortalVersion("Toggle Murmur recording", "CTRL+ALT+space", 2)).toEqual([
      ["description", ["s", "Toggle Murmur recording"]],
      ["preferred_trigger", ["s", "CTRL+ALT+space"]]
    ]);
  });
});
