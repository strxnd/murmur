import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationResult, SelectedTextAutomationResult, TextAutomationBackend, TextAutomationCapability } from "./text-automation";
import { TextAutomationService } from "./text-automation";
import { ContextService } from "./context";

const clipboardHarness = vi.hoisted(() => {
  const emptyImage = { isEmpty: () => true };
  let formats: string[] = [];
  let state = {
    text: "",
    html: "",
    rtf: "",
    image: emptyImage
  };
  const api = {
    availableFormats: vi.fn(() => formats),
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
    set: (next: Partial<typeof state>, nextFormats?: string[]) => {
      state = { text: "", html: "", rtf: "", image: emptyImage, ...next };
      formats =
        nextFormats ??
        [
          ...(state.text ? ["text/plain"] : []),
          ...(state.html ? ["text/html"] : []),
          ...(state.rtf ? ["text/rtf"] : []),
          ...(!state.image.isEmpty() ? ["image/png"] : [])
        ];
    }
  };
});

vi.mock("../electron-api", () => ({ clipboard: clipboardHarness.api }));

afterEach(() => {
  vi.useRealTimers();
});

class FakeBackend implements TextAutomationBackend {
  copyCalls = 0;
  copyStarted?: () => void;
  copyBlocked?: Promise<void>;
  onCopy: (() => void) | undefined;
  result: AutomationResult = { success: true, status: "success", message: "sent", diagnostics: [] };
  selectedTextCalls = 0;
  selectedTextResult: SelectedTextAutomationResult = {
    success: false,
    status: "unavailable",
    message: "Selected text reads are not supported.",
    diagnostics: []
  };
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
    this.copyStarted?.();
    await this.copyBlocked;
    this.onCopy?.();
    return this.result;
  }
  async readSelectedText(): Promise<SelectedTextAutomationResult> {
    this.selectedTextCalls += 1;
    return this.selectedTextResult;
  }
}

describe("ContextService", () => {
  it("restores the clipboard after selected text capture", async () => {
    const image = clipboardHarness.image();
    const backend = new FakeBackend();
    backend.onCopy = () => clipboardHarness.api.writeText("selected text");
    const context = new ContextService(new TextAutomationService(backend), 50, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}", image });

    const snapshot = await context.capture({ selectedText: true });

    expect(snapshot.selectedText).toBe("selected text");
    expect(backend.copyCalls).toBe(1);
    expect(clipboardHarness.get()).toEqual({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}", image });
  });

  it("does not restore an old snapshot over clipboard data copied after capture", async () => {
    const backend = new FakeBackend();
    backend.onCopy = () => clipboardHarness.api.writeText("selected text");
    const context = new ContextService(new TextAutomationService(backend), 50, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });
    clipboardHarness.api.readHTML.mockClear();
    clipboardHarness.api.readHTML
      .mockImplementationOnce(() => clipboardHarness.get().html)
      .mockImplementationOnce(() => clipboardHarness.get().html)
      .mockImplementationOnce(() => {
        const html = clipboardHarness.get().html;
        clipboardHarness.set({ text: "new user clipboard" });
        return html;
      });

    const snapshot = await context.capture({ selectedText: true });

    expect(snapshot.selectedText).toBe("selected text");
    expect(clipboardHarness.get().text).toBe("new user clipboard");
  });

  it("skips clipboard-based selection capture when the existing clipboard cannot be restored losslessly", async () => {
    const backend = new FakeBackend();
    backend.onCopy = () => clipboardHarness.api.writeText("selected text");
    const context = new ContextService(new TextAutomationService(backend), 50, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" }, ["application/x-custom"]);
    clipboardHarness.api.writeText.mockClear();

    const snapshot = await context.capture({ selectedText: true });

    expect(snapshot.selectedText).toBeUndefined();
    expect(snapshot.diagnostics).toContain(
      "Selected text capture was skipped to preserve unsupported clipboard formats."
    );
    expect(backend.copyCalls).toBe(0);
    expect(clipboardHarness.api.writeText).not.toHaveBeenCalled();
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("drops selected-text capture while it is queued after cancellation", async () => {
    const backend = new FakeBackend();
    const automation = new TextAutomationService(backend);
    let releaseQueue!: () => void;
    let markQueueOccupied!: () => void;
    const queueOccupied = new Promise<void>((resolve) => {
      markQueueOccupied = resolve;
    });
    const queueBlocked = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const blocker = automation.runExclusive(async () => {
      markQueueOccupied();
      await queueBlocked;
    });
    await queueOccupied;
    const context = new ContextService(automation, 500, 100, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });
    const controller = new AbortController();

    const capture = context.capture({ selectedText: true, signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    releaseQueue();
    await blocker;

    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.copyCalls).toBe(0);
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("aborts an in-flight selected-text capture before clipboard polling", async () => {
    const backend = new FakeBackend();
    let releaseCopy!: () => void;
    let markCopyStarted!: () => void;
    backend.copyBlocked = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const copyStarted = new Promise<void>((resolve) => {
      markCopyStarted = resolve;
    });
    backend.copyStarted = markCopyStarted;
    const context = new ContextService(new TextAutomationService(backend), 5_000, 1_000, fakePrimarySelection());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>" });
    const controller = new AbortController();

    const capture = context.capture({ selectedText: true, signal: controller.signal });
    await copyStarted;
    controller.abort();
    releaseCopy();

    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.copyCalls).toBe(1);
    expect(clipboardHarness.get()).toMatchObject({ text: "previous", html: "<b>previous</b>" });
  });

  it("returns no selected text when copy leaves the sentinel unchanged", async () => {
    const backend = new FakeBackend();
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture({ selectedText: true });

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

    const snapshot = await context.capture({ selectedText: true });

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

  it("does not read clipboard context unless the caller explicitly requests it", async () => {
    const backend = new FakeBackend();
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "private clipboard" });
    clipboardHarness.api.readText.mockClear();

    const snapshot = await context.capture({ selectedText: false, clipboardText: false });

    expect(snapshot.clipboardText).toBeUndefined();
    expect(clipboardHarness.api.readText).not.toHaveBeenCalled();
  });

  it("includes clipboard context only after observing a recent external change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const backend = new FakeBackend();
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    const tracking = context as unknown as { startClipboardTracking: () => void };
    clipboardHarness.set({ text: "hours-old secret" });
    tracking.startClipboardTracking();

    const stale = await context.capture({ clipboardText: true });
    expect(stale.clipboardText).toBeUndefined();

    clipboardHarness.set({ text: "fresh clipboard" });
    const fresh = await context.capture({ clipboardText: true });
    expect(fresh.clipboardText).toBe("fresh clipboard");

    vi.advanceTimersByTime(3001);
    const expired = await context.capture({ clipboardText: true });
    expect(expired.clipboardText).toBeUndefined();
    context.dispose();
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

    const snapshot = await context.capture({ selectedText: true });

    expect(snapshot.selectedText).toBe("selected primary");
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("uses macOS Accessibility selected text without copying when available", async () => {
    const backend = new FakeBackend();
    backend.capability = {
      backend: "macos_accessibility_helper",
      automationAvailable: true,
      permissionRequired: true,
      diagnostics: []
    };
    backend.selectedTextResult = {
      success: true,
      status: "success",
      message: "read",
      diagnostics: [],
      backend: "macos_accessibility_helper",
      text: "ax selected"
    };
    const context = new ContextService(new TextAutomationService(backend), 5, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture({ selectedText: true });

    expect(snapshot.selectedText).toBe("ax selected");
    expect(backend.selectedTextCalls).toBe(1);
    expect(backend.copyCalls).toBe(0);
    expect(clipboardHarness.get().text).toBe("previous");
  });

  it("falls back to clipboard copy when macOS Accessibility returns no selected text", async () => {
    const backend = new FakeBackend();
    backend.capability = {
      backend: "macos_accessibility_helper",
      automationAvailable: true,
      permissionRequired: true,
      diagnostics: []
    };
    backend.selectedTextResult = {
      success: true,
      status: "success",
      message: "read",
      diagnostics: [],
      backend: "macos_accessibility_helper"
    };
    backend.onCopy = () => clipboardHarness.api.writeText("copied selected text");
    const context = new ContextService(new TextAutomationService(backend), 50, 1, fakePrimarySelection());
    clipboardHarness.set({ text: "previous" });

    const snapshot = await context.capture({ selectedText: true });

    expect(snapshot.selectedText).toBe("copied selected text");
    expect(backend.selectedTextCalls).toBe(1);
    expect(backend.copyCalls).toBe(1);
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
