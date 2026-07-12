import { describe, expect, it, vi } from "vitest";
import { dictationRunwayAction, performDictationRunwayAction } from "./dictation-runway";

describe("Home dictation runway", () => {
  it("starts an available idle dictation", async () => {
    const handlers = actionHandlers();
    const action = dictationRunwayAction({ status: "idle", unavailableReason: null, isActing: false });

    await performDictationRunwayAction(action, handlers);

    expect(action).toBe("start");
    expect(handlers.startDictation).toHaveBeenCalledOnce();
    expect(handlers.openSetup).not.toHaveBeenCalled();
    expect(handlers.stopDictation).not.toHaveBeenCalled();
  });

  it("is disabled while another dictation action is running", async () => {
    const handlers = actionHandlers();
    const action = dictationRunwayAction({ status: "idle", unavailableReason: null, isActing: true });

    await performDictationRunwayAction(action, handlers);

    expect(action).toBe("disabled");
    expect(handlers.openSetup).not.toHaveBeenCalled();
    expect(handlers.startDictation).not.toHaveBeenCalled();
    expect(handlers.stopDictation).not.toHaveBeenCalled();
  });

  it("opens setup instead of recording when dictation is unavailable", async () => {
    const handlers = actionHandlers();
    const action = dictationRunwayAction({
      status: "idle",
      unavailableReason: "No speech model is ready.",
      isActing: false
    });

    await performDictationRunwayAction(action, handlers);

    expect(action).toBe("setup");
    expect(handlers.openSetup).toHaveBeenCalledOnce();
    expect(handlers.startDictation).not.toHaveBeenCalled();
  });

  it("stops the active recording", async () => {
    const handlers = actionHandlers();
    const action = dictationRunwayAction({ status: "recording", unavailableReason: null, isActing: false });

    await performDictationRunwayAction(action, handlers);

    expect(action).toBe("stop");
    expect(handlers.stopDictation).toHaveBeenCalledOnce();
    expect(handlers.startDictation).not.toHaveBeenCalled();
  });

  it("is disabled while a dictation is being processed", async () => {
    const handlers = actionHandlers();
    const action = dictationRunwayAction({ status: "processing", unavailableReason: null, isActing: false });

    await performDictationRunwayAction(action, handlers);

    expect(action).toBe("disabled");
    expect(handlers.openSetup).not.toHaveBeenCalled();
    expect(handlers.startDictation).not.toHaveBeenCalled();
    expect(handlers.stopDictation).not.toHaveBeenCalled();
  });
});

function actionHandlers() {
  return {
    openSetup: vi.fn(),
    startDictation: vi.fn(async () => undefined),
    stopDictation: vi.fn(async () => undefined)
  };
}
