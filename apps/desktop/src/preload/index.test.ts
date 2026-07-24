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
    await harness.api.refreshCodex();
    await harness.api.startCodexLogin();
    await harness.api.cancelCodexLogin();
    await harness.api.logoutCodex();
    harness.api.publishRecordingLevel({ sessionId: "session-1", level: 0.5 });

    expect(harness.invoke).toHaveBeenCalledWith("settings:update", { theme: "light" });
    expect(harness.invoke).toHaveBeenCalledWith("onboarding:dictation-scope", { active: true });
    expect(harness.invoke).toHaveBeenCalledWith("codex:refresh");
    expect(harness.invoke).toHaveBeenCalledWith("codex:login-start");
    expect(harness.invoke).toHaveBeenCalledWith("codex:login-cancel");
    expect(harness.invoke).toHaveBeenCalledWith("codex:logout");
    expect(harness.send).toHaveBeenCalledWith("recording:level", { sessionId: "session-1", level: 0.5 });
  });

  it("exposes only focused APIs to auxiliary renderer roles", async () => {
    const pill = await loadPreloadHarness("pill");
    expect(pill.api.getPillState).toBeTypeOf("function");
    expect(pill.api.onRecordingLevel).toBeTypeOf("function");
    expect(pill.api.getState).toBeUndefined();
    expect(pill.api.clearLocalData).toBeUndefined();

    const selector = await loadPreloadHarness("mode-selector");
    expect(selector.api.getModeSelectorState).toBeTypeOf("function");
    expect(selector.api.selectModeFromSelector).toBeTypeOf("function");
    expect(selector.api.updateSettings).toBeUndefined();
    expect(selector.api.startDictation).toBeUndefined();
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

async function loadPreloadHarness(role: "main" | "pill" | "mode-selector" = "main"): Promise<{
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

  const originalArgv = process.argv;
  process.argv = [...originalArgv.filter((argument) => !argument.startsWith("--murmur-renderer-role=")), `--murmur-renderer-role=${role}`];
  try {
    await import("./index");
  } finally {
    process.argv = originalArgv;
  }
  if (!api) throw new Error("Preload API was not exposed.");
  return { api, invoke, send, on, removeListener };
}
