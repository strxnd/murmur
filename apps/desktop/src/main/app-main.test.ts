import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./electron-api");
  vi.doUnmock("./app-controller");
});

describe("application lifecycle", () => {
  it("owns a constructing controller so Quit can stop partial startup", async () => {
    const ready = deferred<void>();
    const initialization = deferred<void>();
    const disposal = deferred<void>();
    const handlers = new Map<string, (...args: never[]) => void>();
    const quit = vi.fn();
    const prepareToQuit = vi.fn();
    const dispose = vi.fn(() => disposal.promise);
    const initialize = vi.fn(() => initialization.promise);

    vi.doMock("./electron-api", () => ({
      app: {
        isPackaged: false,
        on: vi.fn((event: string, handler: (...args: never[]) => void) => handlers.set(event, handler)),
        quit,
        requestSingleInstanceLock: vi.fn(() => true),
        whenReady: vi.fn(() => ready.promise)
      },
      dialog: { showErrorBox: vi.fn() },
      globalShortcut: { unregisterAll: vi.fn() },
      Menu: { setApplicationMenu: vi.fn() }
    }));
    vi.doMock("./app-controller", () => ({
      AppController: vi.fn(function MockAppController() {
        return { initialize, prepareToQuit, cancelQuit: vi.fn(), dispose, showMainWindow: vi.fn() };
      })
    }));

    await import("./app-main");
    ready.resolve();
    await Promise.resolve();
    await Promise.resolve();

    handlers.get("before-quit")?.();
    expect(initialize).toHaveBeenCalledOnce();
    expect(prepareToQuit).toHaveBeenCalledOnce();

    const preventDefault = vi.fn();
    handlers.get("will-quit")?.({ preventDefault } as never);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    disposal.resolve();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());

    initialization.resolve();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
