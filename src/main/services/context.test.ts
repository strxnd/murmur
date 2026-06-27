import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationResult, TextAutomationBackend, TextAutomationCapability } from "./text-automation";
import { TextAutomationService } from "./text-automation";
import { ContextService } from "./context";

const clipboardHarness = vi.hoisted(() => {
  const emptyImage = { isEmpty: () => true };
  let state = {
    text: "",
    html: "",
    rtf: "",
    image: emptyImage
  };
  const api = {
    clear: vi.fn(() => {
      state = { text: "", html: "", rtf: "", image: emptyImage };
    }),
    readHTML: vi.fn(() => state.html),
    readImage: vi.fn(() => state.image),
    readRTF: vi.fn(() => state.rtf),
    readText: vi.fn(() => state.text),
    write: vi.fn((data: { html?: string; image?: typeof emptyImage; rtf?: string; text?: string }) => {
      state = {
        text: data.text ?? "",
        html: data.html ?? "",
        rtf: data.rtf ?? "",
        image: data.image ?? emptyImage
      };
    }),
    writeText: vi.fn((text: string) => {
      state = { text, html: "", rtf: "", image: emptyImage };
    })
  };

  return {
    api,
    image: (empty = false) => ({ isEmpty: () => empty }),
    get: () => state,
    set: (next: Partial<typeof state>) => {
      state = { text: "", html: "", rtf: "", image: emptyImage, ...next };
    }
  };
});

vi.mock("../electron-api", () => ({ clipboard: clipboardHarness.api }));

afterEach(() => {
  vi.useRealTimers();
});

class FakeBackend implements TextAutomationBackend {
  copyCalls = 0;
  onCopy: (() => void) | undefined;
  result: AutomationResult = { success: true, status: "success", message: "sent", diagnostics: [] };
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
    return { success: false, status: "unavailable", message: "unused", diagnostics: [] };
  }
  async copySelection(): Promise<AutomationResult> {
    this.copyCalls += 1;
    this.onCopy?.();
    return this.result;
  }
}

describe("ContextService", () => {
  it("restores the clipboard after selected text capture", async () => {
    const image = clipboardHarness.image();
    const backend = new FakeBackend();
    backend.onCopy = () => clipboardHarness.api.writeText("selected text");
    const context = new ContextService(new TextAutomationService(backend), 50, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}", image });

    const snapshot = await context.capture();

    expect(snapshot.selectedText).toBe("selected text");
    expect(backend.copyCalls).toBe(1);
    expect(clipboardHarness.get()).toEqual({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}", image });
  });

  it("returns no selected text when copy leaves the sentinel unchanged", async () => {
    const backend = new FakeBackend();
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture();

    expect(snapshot.selectedText).toBeUndefined();
    expect(backend.copyCalls).toBe(1);
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("skips selected text capture when automation is unavailable", async () => {
    const backend = new FakeBackend();
    backend.capability = {
      backend: "clipboard_only",
      automationAvailable: false,
      permissionRequired: false,
      diagnostics: ["unavailable"]
    };
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture();

    expect(snapshot.selectedText).toBeUndefined();
    expect(backend.copyCalls).toBe(0);
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("skips selected text capture when disabled by the caller", async () => {
    const backend = new FakeBackend();
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture({ selectedText: false });

    expect(snapshot.selectedText).toBeUndefined();
    expect(backend.copyCalls).toBe(0);
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("uses PRIMARY selection when clipboard copy does not change text", async () => {
    let primary = "old primary";
    const backend = new FakeBackend();
    backend.onCopy = () => {
      primary = "selected primary";
    };
    const context = new ContextService(new TextAutomationService(backend), 5, 1, {
      async readPrimaryText(): Promise<string | undefined> {
        return primary;
      }
    });
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture();

    expect(snapshot.selectedText).toBe("selected primary");
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("disposes clipboard tracking and ignores duplicate starts", () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    const tracking = context as unknown as { startClipboardTracking: () => void };
    clipboardHarness.api.readText.mockClear();

    tracking.startClipboardTracking();
    tracking.startClipboardTracking();

    expect(clipboardHarness.api.readText).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(clipboardHarness.api.readText).toHaveBeenCalledTimes(2);

    context.dispose();
    const callsAfterDispose = clipboardHarness.api.readText.mock.calls.length;
    vi.advanceTimersByTime(3000);

    expect(clipboardHarness.api.readText).toHaveBeenCalledTimes(callsAfterDispose);
  });
});

function fakePrimarySelection(): { readPrimaryText: () => Promise<string | undefined> } {
  return {
    async readPrimaryText(): Promise<string | undefined> {
      return undefined;
    }
  };
}
