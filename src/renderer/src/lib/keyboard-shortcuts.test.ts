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
        })
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
        })
      )
    ).toEqual({
      accelerator: null,
      preview: "CommandOrControl"
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
