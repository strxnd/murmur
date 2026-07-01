import { afterEach, describe, expect, it } from "vitest";
import { keyboardEventToAccelerator, type KeyboardShortcutEvent } from "./keyboard-shortcuts";

describe("keyboardEventToAccelerator", () => {
  const originalPlatform = globalThis.navigator?.platform ?? "";

  afterEach(() => {
    setNavigatorPlatform(originalPlatform);
  });

  it("formats a Linux control shortcut as an Electron accelerator", () => {
    setNavigatorPlatform("Linux x86_64");
    expect(
      keyboardEventToAccelerator(
        shortcutEvent({
          altKey: true,
          code: "Space",
          ctrlKey: true,
          key: " "
        })
      )
    ).toEqual({
      accelerator: "CommandOrControl+Alt+Space",
      preview: "CommandOrControl+Alt+Space"
    });
  });

  it("records macOS Command and Option as Electron-compatible accelerators", () => {
    setNavigatorPlatform("MacIntel");
    expect(
      keyboardEventToAccelerator(
        shortcutEvent({
          altKey: true,
          code: "Space",
          key: " ",
          metaKey: true
        })
      )
    ).toEqual({
      accelerator: "Command+Alt+Space",
      preview: "Command+Alt+Space"
    });
  });

  it("previews modifiers until a non-modifier key is pressed", () => {
    setNavigatorPlatform("Linux x86_64");
    expect(
      keyboardEventToAccelerator(
        shortcutEvent({
          code: "ControlLeft",
          ctrlKey: true,
          key: "Control"
        })
      )
    ).toEqual({
      accelerator: null,
      preview: "CommandOrControl"
    });
  });

});

function setNavigatorPlatform(platform: string): void {
  Object.defineProperty(globalThis.navigator, "platform", {
    configurable: true,
    value: platform
  });
}

function shortcutEvent(overrides: Partial<KeyboardShortcutEvent>): KeyboardShortcutEvent {
  return {
    altKey: false,
    code: "KeyA",
    ctrlKey: false,
    getModifierState: () => false,
    key: "a",
    metaKey: false,
    shiftKey: false,
    ...overrides
  };
}
