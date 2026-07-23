import type { NativeImage } from "electron";
import { clipboard } from "../electron-api";

const clipboardOwnershipMarkerPrefix = "murmur-clipboard-owner:";

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
  formats: string[];
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
    formats: normalizeClipboardFormats(formats),
    restorable: formats.every(isRestorableClipboardFormat)
  };
}

export function writeOwnedClipboardText(text: string, ownershipToken: string): void {
  const marker = `${clipboardOwnershipMarkerPrefix}${ownershipToken}`;
  clipboard.write({
    text,
    html: `<span style="white-space: pre-wrap"><!--${marker}-->${escapeHtml(text)}</span>`
  });
}

export function clipboardHasOwnershipToken(ownershipToken: string): boolean {
  return clipboard.readHTML().includes(`<!--${clipboardOwnershipMarkerPrefix}${ownershipToken}-->`);
}

export function clipboardMatchesSnapshot(snapshot: ClipboardSnapshot): boolean {
  const current = captureClipboardSnapshot();
  return (
    current.text === snapshot.text &&
    current.html === snapshot.html &&
    current.rtf === snapshot.rtf &&
    current.formats.length === snapshot.formats.length &&
    current.formats.every((format, index) => format === snapshot.formats[index]) &&
    imagesMatch(current.image, snapshot.image)
  );
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeClipboardFormats(formats: string[]): string[] {
  return formats.map((format) => format.trim().toLowerCase()).sort();
}

function imagesMatch(left: NativeImage | undefined, right: NativeImage | undefined): boolean {
  if (!left || !right) return left === right;
  return left.toDataURL() === right.toDataURL();
}

function isRestorableClipboardFormat(format: string): boolean {
  const normalized = format.trim().toLowerCase();
  return restorableClipboardFormats.has(normalized) || normalized.startsWith("text/plain;");
}
