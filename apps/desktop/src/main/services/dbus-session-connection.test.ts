import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DbusSessionConnection } from "./dbus-session-connection";

class FakeBus {
  readonly connection = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
  name = ":1.55";
  invoke = vi.fn();

  constructor() {
    this.connection.end = vi.fn();
  }
}

describe("DbusSessionConnection", () => {
  it("owns connection errors and rejects pending calls without an uncaught error event", async () => {
    const bus = new FakeBus();
    const onLost = vi.fn();
    const connection = new DbusSessionConnection(() => bus as never, vi.fn(), onLost);
    const pending = connection.invoke({
      message: { destination: "test", path: "/test", interface: "test", member: "Wait" },
      timeoutMs: 1000,
      timeoutMessage: "timed out"
    });

    expect(() => bus.connection.emit("error", new Error("disconnected"))).not.toThrow();
    await expect(pending).rejects.toThrow("disconnected");
    expect(bus.connection.end).toHaveBeenCalledOnce();
    expect(onLost).toHaveBeenCalledWith(expect.objectContaining({ message: "disconnected" }));
    expect(() => bus.connection.emit("error", new Error("late transport error"))).not.toThrow();
  });

  it("closes a no-reply bus on timeout so dbus-native reply cookies cannot accumulate", async () => {
    const bus = new FakeBus();
    const connection = new DbusSessionConnection(() => bus as never, vi.fn(), vi.fn());

    await expect(
      connection.invoke({
        message: { destination: "test", path: "/test", interface: "test", member: "NeverReplies" },
        timeoutMs: 5,
        timeoutMessage: "synthetic timeout"
      })
    ).rejects.toThrow("synthetic timeout");

    expect(bus.connection.end).toHaveBeenCalledOnce();
    expect(connection.currentBus()).toBeNull();
  });
});
