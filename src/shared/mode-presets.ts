import type { ModePresetId } from "./types";

export interface ModePreset {
  id: ModePresetId;
  label: string;
  iconKey: "mic" | "message-square" | "mail" | "notebook-pen" | "sliders-horizontal";
  aiEnabled: boolean;
  instructionPrompt: string;
  context: {
    app: boolean;
    selectedText: boolean;
    clipboardText: boolean;
  };
}

export const modePresets: Record<ModePresetId, ModePreset> = {
  voice_to_text: {
    id: "voice_to_text",
    label: "Voice to text",
    iconKey: "mic",
    aiEnabled: false,
    instructionPrompt:
      "Return the transcript as directly as possible. Preserve the user's words and only correct clear transcription mistakes, punctuation, and casing.",
    context: { app: false, selectedText: false, clipboardText: false }
  },
  message: {
    id: "message",
    label: "Message",
    iconKey: "message-square",
    aiEnabled: true,
    instructionPrompt:
      "Write a concise chat or direct message that fits the current conversation. Keep it natural, clear, and ready to send.",
    context: { app: true, selectedText: true, clipboardText: false }
  },
  mail: {
    id: "mail",
    label: "Mail",
    iconKey: "mail",
    aiEnabled: true,
    instructionPrompt:
      "Draft or revise email text with a clear subject-aware structure, professional tone, and appropriate greeting and sign-off when useful.",
    context: { app: true, selectedText: true, clipboardText: true }
  },
  note: {
    id: "note",
    label: "Note",
    iconKey: "notebook-pen",
    aiEnabled: true,
    instructionPrompt:
      "Turn the transcript into structured notes. Use concise headings, bullets, and action items when they make the content easier to scan.",
    context: { app: true, selectedText: false, clipboardText: false }
  },
  custom: {
    id: "custom",
    label: "Custom",
    iconKey: "sliders-horizontal",
    aiEnabled: true,
    instructionPrompt: "",
    context: { app: true, selectedText: true, clipboardText: true }
  }
};

export const modePresetList: ModePreset[] = [
  modePresets.voice_to_text,
  modePresets.message,
  modePresets.mail,
  modePresets.note,
  modePresets.custom
];
