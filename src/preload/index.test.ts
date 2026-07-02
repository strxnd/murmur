import { afterEach, describe, expect, it, vi } from "vitest";
import type { MurmurApi } from "./index";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("electron");
});

describe("preload API", () => {
  it("maps renderer settings and recording calls to stable IPC channels", async () => {
    const harness = await loadPreloadHarness();

    await harness.api.updateSettings({ theme: "light" });
    await harness.api.setOnboardingDictationScope(true);
    harness.api.publishRecordingLevel({ sessionId: "session-1", level: 0.5 });

    expect(harness.invoke).toHaveBeenCalledWith("settings:update", { theme: "light" });
    expect(harness.invoke).toHaveBeenCalledWith("onboarding:dictation-scope", { active: true });
    expect(harness.send).toHaveBeenCalledWith("recording:level", { sessionId: "session-1", level: 0.5 });
  });

  it("returns listener cleanup functions that remove the exact IPC listener", async () => {
    const harness = await loadPreloadHarness();
    const callback = vi.fn();

    const unsubscribe = harness.api.onStateChanged(callback);
    const listener = harness.on.mock.calls[0]?.[1];
    listener?.({} as never, { marker: "state" });
    unsubscribe();

    expect(harness.on).toHaveBeenCalledWith("state:changed", listener);
    expect(callback).toHaveBeenCalledWith({ marker: "state" });
    expect(harness.removeListener).toHaveBeenCalledWith("state:changed", listener);
  });
});

async function loadPreloadHarness(): Promise<{
  api: MurmurApi;
  invoke: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  let api: MurmurApi | null = null;
  const invoke = vi.fn().mockResolvedValue({});
  const send = vi.fn();
  const on = vi.fn();
  const removeListener = vi.fn();

  vi.doMock("electron", () => ({
    contextBridge: {
      exposeInMainWorld: vi.fn((_name: string, exposedApi: MurmurApi) => {
        api = exposedApi;
      })
    },
    ipcRenderer: {
      invoke,
      send,
      on,
      removeListener
    }
  }));

  await import("./index");
  if (!api) throw new Error("Preload API was not exposed.");
  return { api, invoke, send, on, removeListener };
}
