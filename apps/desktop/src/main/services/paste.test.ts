import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AutomationResult, TextAutomationBackend, TextAutomationCapability } from "./text-automation";
import { TextAutomationService } from "./text-automation";
import { PasteService } from "./paste";

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
    return this.result;
  }
  async copySelection(): Promise<AutomationResult> {
    return { success: false, status: "unavailable", message: "unused", diagnostics: [] };
  }
}

describe("PasteService", () => {
  it("treats legacy clipboard-only settings as automatic paste", async () => {
    const backend = new FakeBackend();
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}" });

    const result = await service.insertText("processed output");

    expect(result).toEqual({ pasted: true, message: "Paste shortcut sent; output left on clipboard." });
    expect(backend.pasteCalls).toBe(1);
    expect(clipboardHarness.get().text).toBe("processed output");
  });

  it("leaves output on the clipboard after successful automation", async () => {
    const image = clipboardHarness.image();
    const backend = new FakeBackend();
    const service = new PasteService(new TextAutomationService(backend), 0, fakeLinuxClipboard());
    clipboardHarness.set({ text: "previous", html: "<b>previous</b>", rtf: "{\\rtf1 previous}", image });

    const result = await service.insertText("processed output");

    expect(result).toEqual({ pasted: true, message: "Paste shortcut sent; output left on clipboard." });
    expect(backend.pasteCalls).toBe(1);
    expect(clipboardHarness.get().text).toBe("processed output");
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

  it("keeps command fallback concerns out of PasteService", () => {
    const source = readFileSync(new URL("./paste.ts", import.meta.url), "utf8");

    expect(source).not.toContain("execFile");
  });
});

function fakeLinuxClipboard(): { writeTextForPaste: (text: string) => Promise<void> } {
  return {
    async writeTextForPaste(text: string): Promise<void> {
      clipboardHarness.api.writeText(text);
    }
  };
}
