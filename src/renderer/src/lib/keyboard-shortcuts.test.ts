import { describe, expect, it } from "vitest";
import { keyboardEventToAccelerator, type KeyboardShortcutEvent } from "./keyboard-shortcuts";

describe("keyboardEventToAccelerator", () => {
  it("formats a Linux control shortcut as an Electron accelerator", () => {
    expect(
      keyboardEventToAccelerator(
        shortcutEvent({
          altKey: true,
          code: "Space",
          ctrlKey: true,
          key: " "
        }),
        "Linux x86_64"
      )
    ).toEqual({
      accelerator: "CommandOrControl+Alt+Space",
      preview: "CommandOrControl+Alt+Space"
    });
  });

  it("previews modifiers until a non-modifier key is pressed", () => {
    expect(
      keyboardEventToAccelerator(
        shortcutEvent({
          code: "ControlLeft",
          ctrlKey: true,
          key: "Control"
        }),
        "Linux x86_64"
      )
    ).toEqual({
      accelerator: null,
      preview: "CommandOrControl"
    });
  });

  it("preserves macOS control separately from command", () => {
    expect(
      keyboardEventToAccelerator(
        shortcutEvent({
          code: "KeyK",
          ctrlKey: true,
          key: "k",
          metaKey: true,
          shiftKey: true
        }),
        "MacIntel"
      )
    ).toEqual({
      accelerator: "CommandOrControl+Control+Shift+K",
      preview: "CommandOrControl+Control+Shift+K"
    });
  });
});

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
