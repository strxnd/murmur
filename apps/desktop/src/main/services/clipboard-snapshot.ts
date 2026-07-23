import type { NativeImage } from "electron";
import { clipboard } from "../electron-api";

const restorableClipboardFormats = new Set([
  "compound_text",
  "image/png",
  "image/tiff",
  "nshtmlpboardtype",
  "nsrtfpboardtype",
  "nsstringpboardtype",
  "nstiffpboardtype",
  "public.html",
  "public.png",
  "public.rtf",
  "public.tiff",
  "public.utf16-external-plain-text",
  "public.utf8-plain-text",
  "string",
  "text",
  "text/html",
  "text/plain",
  "text/rtf",
  "utf8_string"
]);

export interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image?: NativeImage;
  restorable: boolean;
}

export function captureClipboardSnapshot(): ClipboardSnapshot {
  const image = clipboard.readImage();
  const formats = clipboard.availableFormats?.() ?? [];
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: image.isEmpty() ? undefined : image,
    restorable: formats.every(isRestorableClipboardFormat)
  };
}

export function restoreClipboardSnapshot(snapshot: ClipboardSnapshot): boolean {
  if (!snapshot.restorable) return false;

  const hasContent = Boolean(snapshot.text || snapshot.html || snapshot.rtf || snapshot.image);
  if (!hasContent) {
    clipboard.clear();
    return true;
  }

  clipboard.write({
    text: snapshot.text,
    html: snapshot.html,
    rtf: snapshot.rtf,
    ...(snapshot.image ? { image: snapshot.image } : {})
  });
  return true;
}

function isRestorableClipboardFormat(format: string): boolean {
  const normalized = format.trim().toLowerCase();
  return restorableClipboardFormats.has(normalized) || normalized.startsWith("text/plain;");
}
