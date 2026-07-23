import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AutomationResult, TextAutomationBackend, TextAutomationCapability } from "./text-automation";
import { TextAutomationService } from "./text-automation";
import { PasteService, type ClipboardPasteLease } from "./paste";

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

class FakeBackend implements TextAutomationBackend {
  pasteCalls = 0;
  pasteStarted?: () => void;
  pasteBlocked?: Promise<void>;
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
    this.pasteCalls += 1;
    this.pasteStarted?.();
    await this.pasteBlocked;
    return this.result;
  }
  async copySelection(): Promise<AutomationResult> {
    return { success: false, status: "unavailable", message: "unused", diagnostics: [] };
  }
}

const successMessage = "Paste shortcut sent; previous clipboard restored when still owned by Murmur.";

describe("PasteService", () => {
  it("restores the complete previous clipboard after successful automation", async () => {
    const image = clipboardHarness.image();
    const backend = new FakeBackend();
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}", image });

    const result = await service.insertText("processed output");

    expect(result).toEqual({ pasted: true, message: successMessage });
    expect(backend.pasteCalls).toBe(1);
    expect(clipboardHarness.get()).toEqual({
      text: "previous",
      html: "<b>previous</b>",
      rtf: "{\\rtf1 previous}",
      image
    });
  });

  it("does not dispatch paste after the owning dictation is cancelled", async () => {
    const backend = new FakeBackend();
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}" });
    let releaseWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const service = new PasteService(new TextAutomationService(backend), 0, {
      async writeTextForPaste(text: string): Promise<ClipboardPasteLease> {
        markWriteStarted();
        await writeBlocked;
        clipboardHarness.api.writeText(text);
        return fakeLease();
      }
    });
    const controller = new AbortController();

    const result = service.insertText("stale output", controller.signal);
    await writeStarted;
    controller.abort();
    releaseWrite();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.pasteCalls).toBe(0);
    expect(clipboardHarness.get()).toMatchObject({
      text: "previous",
      html: "<b>previous</b>",
      rtf: "{\\rtf1 previous}"
    });
  });

  it("restores the previous clipboard after a confirmed paste even if cancellation arrives during dispatch", async () => {
    const backend = new FakeBackend();
    let releasePaste!: () => void;
    let markPasteStarted!: () => void;
    backend.pasteBlocked = new Promise<void>((resolve) => {
      releasePaste = resolve;
    });
    const pasteStarted = new Promise<void>((resolve) => {
      markPasteStarted = resolve;
    });
    backend.pasteStarted = markPasteStarted;
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}" });
    const controller = new AbortController();

    const result = service.insertText("processed output", controller.signal);
    await pasteStarted;
    controller.abort();
    releasePaste();

    await expect(result).resolves.toEqual({ pasted: true, message: successMessage });
    expect(clipboardHarness.get()).toMatchObject({
      text: "previous",
      html: "<b>previous</b>",
      rtf: "{\\rtf1 previous}"
    });
  });

  it("does not overwrite clipboard data copied by the user during paste dispatch", async () => {
    const backend = new FakeBackend();
    backend.pasteStarted = () => clipboardHarness.api.writeText("new user clipboard");
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>" });

    const result = await service.insertText("processed output");

    expect(result).toEqual({ pasted: true, message: successMessage });
    expect(clipboardHarness.get().text).toBe("new user clipboard");
  });

  it("leaves output on the clipboard when automation fails", async () => {
    const backend = new FakeBackend();
    backend.result = {
      success: false,
      status: "failed",
      message: "Paste automation failed; output left on clipboard. org.freedesktop.DBus.Error.Failed",
      diagnostics: []
    };
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>" });

    const result = await service.insertText("processed output");

    expect(result.pasted).toBe(false);
    expect(result.message).toContain("org.freedesktop.DBus.Error.Failed");
    expect(clipboardHarness.get().text).toBe("processed output");
  });

  it("supports clipboard-only delivery without dispatching automation", async () => {
    const backend = new FakeBackend();
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous" });

    const result = await service.copyText("processed output");

    expect(result).toEqual({ pasted: false, message: "Automatic paste was skipped; output left on the clipboard." });
    expect(backend.pasteCalls).toBe(0);
    expect(clipboardHarness.get().text).toBe("processed output");
  });

  it("keeps command fallback concerns out of PasteService", () => {
    const source = readFileSync(new URL("./paste.ts", import.meta.url), "utf8");

    expect(source).not.toContain("execFile");
  });
});

function fakeLinuxClipboard(): { writeTextForPaste: (text: string) => Promise<ClipboardPasteLease> } {
  return {
    async writeTextForPaste(text: string): Promise<ClipboardPasteLease> {
      clipboardHarness.api.writeText(text);
      return fakeLease();
    }
  };
}

function fakeLease(): ClipboardPasteLease {
  return { restoreIfOwned: async () => undefined };
}
