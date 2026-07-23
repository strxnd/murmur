import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AutomationResult, TextAutomationBackend, TextAutomationCapability } from "./text-automation";
import { TextAutomationService } from "./text-automation";
import { XdgRemoteDesktopKeyboardService } from "./xdg-remote-desktop-keyboard";

const leftControlKeycode = 29;
const cKeycode = 46;
const vKeycode = 47;

interface FakePortalOptions {
  availableDeviceTypes?: number;
  createResponse?: number;
  selectResponse?: number;
  startResponse?: number;
  startDevices?: number;
  startRestoreTokens?: string[];
  portalMissing?: boolean;
  failNotifyAt?: number;
}

interface FakeDbusCall {
  body?: unknown[];
  destination?: string;
  interface?: string;
  member?: string;
  path?: string;
  signature?: string;
}

class FakePortalBus {
  readonly connection = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
  readonly calls: FakeDbusCall[] = [];
  readonly keyEvents: Array<{ keycode: number; state: number }> = [];
  name = ":1.77";
  private notifyCount = 0;
  private requestCount = 0;
  private startCount = 0;

  constructor(private readonly options: FakePortalOptions = {}) {
    this.connection.end = vi.fn();
  }

  invoke(message: FakeDbusCall, callback: (error: Error | null, value?: unknown) => void): void {
    this.calls.push(message);

    if (message.interface === "org.freedesktop.DBus" && message.member === "GetNameOwner") {
      callback(null, ":1.10");
      return;
    }

    if (message.interface === "org.freedesktop.DBus" && (message.member === "AddMatch" || message.member === "RemoveMatch")) {
      callback(null);
      return;
    }

    if (message.interface === "org.freedesktop.DBus.Properties" && message.member === "Get") {
      if (this.options.portalMissing) {
        callback(dbusError("org.freedesktop.DBus.Error.UnknownInterface", "RemoteDesktop is unavailable"));
        return;
      }
      callback(null, ["u", this.options.availableDeviceTypes ?? 1]);
      return;
    }

    if (message.interface === "org.freedesktop.portal.RemoteDesktop" && message.member === "NotifyKeyboardKeycode") {
      const [, , keycode, state] = message.body ?? [];
      this.keyEvents.push({ keycode: Number(keycode), state: Number(state) });
      this.notifyCount += 1;
      if (this.options.failNotifyAt === this.notifyCount) {
        callback(dbusError("org.freedesktop.DBus.Error.Failed", "synthetic key failure"));
        return;
      }
      callback(null);
      return;
    }

    if (message.interface === "org.freedesktop.portal.RemoteDesktop" && isPortalRequest(message.member)) {
      const member = message.member;
      const handle = `/org/freedesktop/portal/desktop/request/1_77/request${++this.requestCount}`;
      callback(null, handle);
      queueMicrotask(() => {
        this.connection.emit("message", {
          sender: ":1.10",
          path: handle,
          interface: "org.freedesktop.portal.Request",
          member: "Response",
          body: this.responseBody(member)
        });
      });
      return;
    }

    if (
      (message.interface === "org.freedesktop.portal.Request" || message.interface === "org.freedesktop.portal.Session") &&
      message.member === "Close"
    ) {
      callback(null);
      return;
    }

    callback(null);
  }

  memberCalls(member: string): FakeDbusCall[] {
    return this.calls.filter((call) => call.member === member);
  }

  private responseBody(member: string): unknown[] {
    if (member === "CreateSession") {
      return [
        this.options.createResponse ?? 0,
        [["session_handle", ["s", "/org/freedesktop/portal/desktop/session/1_77/murmur"]]]
      ];
    }
    if (member === "SelectDevices") {
      return [this.options.selectResponse ?? 0, []];
    }
    const restoreToken = this.options.startRestoreTokens?.[this.startCount++];
    return [
      this.options.startResponse ?? 0,
      [
        ["devices", ["u", this.options.startDevices ?? 1]],
        ...(restoreToken ? [["restore_token", ["s", restoreToken]]] : [])
      ]
    ];
  }
}

class FakeBackend implements TextAutomationBackend {
  calls: string[] = [];
  capability: TextAutomationCapability = {
    backend: "xdg_remote_desktop_keyboard",
    automationAvailable: true,
    permissionRequired: true,
    diagnostics: []
  };

  async initialize(): Promise<void> {}
  dispose(): void {}
  getCapability(): TextAutomationCapability {
    return this.capability;
  }
  getDiagnostics(): string[] {
    return this.capability.diagnostics;
  }
  async pasteClipboard(): Promise<AutomationResult> {
    this.calls.push("paste:start");
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.calls.push("paste:end");
    return { success: true, status: "success", message: "pasted", diagnostics: [] };
  }
  async copySelection(): Promise<AutomationResult> {
    this.calls.push("copy:start");
    this.calls.push("copy:end");
    return { success: true, status: "success", message: "copied", diagnostics: [] };
  }
}

describe("TextAutomationService", () => {
  it("is unavailable without a D-Bus session", async () => {
    const noDbus = new TextAutomationService(new XdgRemoteDesktopKeyboardService({ platform: "linux", env: {} } as never));
    await noDbus.initialize();
    expect(noDbus.getCapability()).toMatchObject({ automationAvailable: false, permissionRequired: false });
  });

  it("is unavailable when the RemoteDesktop portal is missing", async () => {
    const bus = new FakePortalBus({ portalMissing: true });
    const service = automationWithBus(bus);

    await service.initialize();

    expect(service.getCapability().automationAvailable).toBe(false);
    expect(service.getDiagnostics()).toContain("XDG RemoteDesktop keyboard portal unavailable; clipboard-only fallback will be used.");
  });

  it("is unavailable when the keyboard device type is missing", async () => {
    const bus = new FakePortalBus({ availableDeviceTypes: 2 });
    const service = automationWithBus(bus);

    await service.initialize();

    expect(service.getCapability().automationAvailable).toBe(false);
    expect(service.getDiagnostics()).toContain("XDG RemoteDesktop portal does not expose keyboard control.");
  });

  it("falls back without throwing when permission is denied or cancelled", async () => {
    let now = 1_000;
    const bus = new FakePortalBus({ startResponse: 1 });
    const service = automationWithBus(bus, () => now);
    await service.initialize();

    const result = await service.pasteClipboard();
    const createAttempts = bus.memberCalls("CreateSession").length;
    now += 1_000;
    const throttled = await service.copySelection();

    expect(result).toMatchObject({ success: false, status: "denied" });
    expect(throttled).toMatchObject({ success: false, status: "denied" });
    expect(bus.memberCalls("CreateSession")).toHaveLength(createAttempts);
  });

  it("emits paste and copy key down/up events in order", async () => {
    const bus = new FakePortalBus();
    const service = automationWithBus(bus);
    await service.initialize();

    await expect(service.pasteClipboard()).resolves.toMatchObject({ success: true });
    await expect(service.copySelection()).resolves.toMatchObject({ success: true });

    expect(bus.keyEvents).toEqual([
      { keycode: leftControlKeycode, state: 1 },
      { keycode: vKeycode, state: 1 },
      { keycode: vKeycode, state: 0 },
      { keycode: leftControlKeycode, state: 0 },
      { keycode: leftControlKeycode, state: 1 },
      { keycode: cKeycode, state: 1 },
      { keycode: cKeycode, state: 0 },
      { keycode: leftControlKeycode, state: 0 }
    ]);
  });

  it("reuses and rotates the RemoteDesktop restore token after connection recovery", async () => {
    const bus = new FakePortalBus({ startRestoreTokens: ["restore-one", "restore-two"] });
    const service = automationWithBus(bus);
    await service.initialize();

    await expect(service.pasteClipboard()).resolves.toMatchObject({ success: true });
    bus.connection.emit("error", new Error("session bus disconnected"));
    await expect(service.pasteClipboard()).resolves.toMatchObject({ success: true });

    const selectCalls = bus.memberCalls("SelectDevices");
    expect(selectCalls).toHaveLength(2);
    expect(selectCalls[0].body?.[1]).not.toContainEqual(["restore_token", ["s", "restore-one"]]);
    expect(selectCalls[1].body?.[1]).toContainEqual(["restore_token", ["s", "restore-one"]]);
  });

  it("attempts to release the modifier after a partial shortcut failure", async () => {
    const bus = new FakePortalBus({ failNotifyAt: 2 });
    const service = automationWithBus(bus);
    await service.initialize();

    await expect(service.pasteClipboard()).resolves.toMatchObject({ success: false, status: "failed" });

    expect(bus.keyEvents).toEqual([
      { keycode: leftControlKeycode, state: 1 },
      { keycode: vKeycode, state: 1 },
      { keycode: leftControlKeycode, state: 0 }
    ]);
    expect(bus.calls.some((call) => call.interface === "org.freedesktop.portal.Session" && call.member === "Close")).toBe(true);
  });

  it("serializes automation calls", async () => {
    const backend = new FakeBackend();
    const service = new TextAutomationService(backend);

    await Promise.all([service.pasteClipboard(), service.copySelection()]);

    expect(backend.calls).toEqual(["paste:start", "paste:end", "copy:start", "copy:end"]);
  });

  it("drops a queued exclusive operation when its owner is cancelled", async () => {
    const backend = new FakeBackend();
    const service = new TextAutomationService(backend);
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = service.runExclusive(() => firstBlocked);
    const controller = new AbortController();
    const staleOperation = vi.fn(async () => undefined);
    const second = service.runExclusive(staleOperation, controller.signal);

    controller.abort();
    releaseFirst();
    await first;

    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(staleOperation).not.toHaveBeenCalled();
  });

  it("serializes clipboard-scoped operations against direct automation calls", async () => {
    const backend = new FakeBackend();
    const service = new TextAutomationService(backend);
    const events: string[] = [];

    const scopedOperation = service.runExclusive(async () => {
      events.push("exclusive:start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push("exclusive:end");
    });
    const directAutomation = service.copySelection().then(() => {
      events.push("copy:done");
    });

    await Promise.all([scopedOperation, directAutomation]);

    expect(events).toEqual(["exclusive:start", "exclusive:end", "copy:done"]);
    expect(backend.calls).toEqual(["copy:start", "copy:end"]);
  });
});

function automationWithBus(bus: FakePortalBus, now: () => number = () => Date.now()): TextAutomationService {
  return new TextAutomationService(
    new XdgRemoteDesktopKeyboardService({
      platform: "linux",
      env: { DBUS_SESSION_BUS_ADDRESS: "session" },
      createBus: () => bus,
      now
    } as never)
  );
}

function isPortalRequest(member: string | undefined): member is "CreateSession" | "SelectDevices" | "Start" {
  return member === "CreateSession" || member === "SelectDevices" || member === "Start";
}

function dbusError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
