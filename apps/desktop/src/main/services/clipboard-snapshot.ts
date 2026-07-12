import type { NativeImage } from "electron";
import { clipboard } from "../electron-api";

export interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image?: NativeImage;
}

export function captureClipboardSnapshot(): ClipboardSnapshot {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: image.isEmpty() ? undefined : image
  };
}

export function restoreClipboardSnapshot(snapshot: ClipboardSnapshot): void {
  const hasContent = Boolean(snapshot.text || snapshot.html || snapshot.rtf || snapshot.image);
  if (!hasContent) {
    clipboard.clear();
    return;
  }

  clipboard.write({
    text: snapshot.text,
    html: snapshot.html,
    rtf: snapshot.rtf,
    ...(snapshot.image ? { image: snapshot.image } : {})
  });
}
