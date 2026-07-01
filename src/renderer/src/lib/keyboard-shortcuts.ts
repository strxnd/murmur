export interface KeyboardShortcutEvent {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  getModifierState?: (keyArg: string) => boolean;
}

export interface KeyboardShortcutDraft {
  accelerator: string | null;
  preview: string;
}

const modifierKeys = new Set(["Alt", "AltGraph", "Control", "Meta", "OS", "Shift"]);

const codeAccelerators: Record<string, string> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  CapsLock: "Capslock",
  Comma: ",",
  Delete: "Delete",
  End: "End",
  Enter: "Return",
  Equal: "=",
  Escape: "Escape",
  Home: "Home",
  Insert: "Insert",
  Minus: "-",
  NumpadAdd: "Plus",
  NumpadDecimal: ".",
  NumpadDivide: "/",
  NumpadEnter: "Return",
  NumpadMultiply: "*",
  NumpadSubtract: "-",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab"
};

const keyAccelerators: Record<string, string> = {
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
  AudioVolumeUp: "VolumeUp",
  CapsLock: "Capslock",
  Delete: "Delete",
  End: "End",
  Enter: "Return",
  Escape: "Escape",
  Home: "Home",
  Insert: "Insert",
  MediaPlayPause: "MediaPlayPause",
  MediaStop: "MediaStop",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  NumLock: "Numlock",
  PageDown: "PageDown",
  PageUp: "PageUp",
  PrintScreen: "PrintScreen",
  ScrollLock: "Scrolllock",
  Tab: "Tab"
};

export function keyboardEventToAccelerator(event: KeyboardShortcutEvent): KeyboardShortcutDraft {
  const modifiers = modifierAccelerators(event);
  const key = keyAccelerator(event);
  const parts = key ? [...modifiers, key] : modifiers;

  return {
    accelerator: key ? parts.join("+") : null,
    preview: parts.join("+")
  };
}

function modifierAccelerators(event: KeyboardShortcutEvent): string[] {
  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  const isMac = /mac|iphone|ipad|ipod/i.test(globalThis.navigator?.platform ?? "");
  const modifiers: string[] = [];

  if (event.ctrlKey) modifiers.push(isMac ? "Control" : "CommandOrControl");
  if (event.metaKey) modifiers.push(isMac ? "Command" : "Super");

  if (altGraph) {
    modifiers.push("AltGr");
  } else if (event.altKey) {
    modifiers.push("Alt");
  }

  if (event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

function keyAccelerator(event: KeyboardShortcutEvent): string | null {
  if (modifierKeys.has(event.key)) return null;

  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code;

  if (codeAccelerators[event.code]) return codeAccelerators[event.code];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key.toUpperCase();
  if (keyAccelerators[event.key]) return keyAccelerators[event.key];

  if (event.key.length !== 1) return null;

  const upperKey = event.key.toUpperCase();
  if (/^[A-Z]$/.test(upperKey)) return upperKey;
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (event.key === "+") return "Plus";

  return event.key;
}
