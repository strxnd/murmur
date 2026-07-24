import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { isSupportedMacosReleaseAccelerator, MacosEventTapReleaseService } from "./macos-event-tap-hotkeys";

function createWatcher() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

describe("MacosEventTapReleaseService", () => {
  it("rejects accelerators the native release helper cannot observe", () => {
    expect(isSupportedMacosReleaseAccelerator("CommandOrControl+Shift+Space")).toBe(true);
    expect(isSupportedMacosReleaseAccelerator("CommandOrControl+F8")).toBe(false);
    expect(isSupportedMacosReleaseAccelerator("Hyper+Space")).toBe(false);
  });

  it("reports a watcher that exits after readiness as unavailable", async () => {
    const processPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const child = createWatcher();
    const onUnavailable = vi.fn();
    const service = new MacosEventTapReleaseService({
      startReleaseWatcher: vi.fn(() => child)
    } as never);

    const registration = service.register("CommandOrControl+Shift+Space", vi.fn(), onUnavailable);
    child.stdout.write(`${JSON.stringify({ ok: true, event: "ready" })}\n`);
    await expect(registration).resolves.toMatchObject({ registered: true });

    child.emit("exit", 17);

    expect(onUnavailable).toHaveBeenCalledWith(["macOS event-tap helper exited with code 17."]);
    processPlatform.mockRestore();
  });

  it("does not report intentional unregister as watcher failure", async () => {
    const processPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const child = createWatcher();
    const onUnavailable = vi.fn();
    const service = new MacosEventTapReleaseService({
      startReleaseWatcher: vi.fn(() => child)
    } as never);

    const registration = service.register("CommandOrControl+Shift+Space", vi.fn(), onUnavailable);
    child.stdout.write(`${JSON.stringify({ ok: true, event: "ready" })}\n`);
    await registration;
    service.unregister();
    child.emit("exit", null);

    expect(child.kill).toHaveBeenCalledOnce();
    expect(onUnavailable).not.toHaveBeenCalled();
    processPlatform.mockRestore();
  });
});
