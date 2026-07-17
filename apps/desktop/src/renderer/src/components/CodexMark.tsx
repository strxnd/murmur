import type { JSX } from "react";
import codexLogoUrl from "../assets/codex-logo.png";

export function CodexMark({ className }: { className?: string }): JSX.Element {
  return <img alt="" aria-hidden="true" className={className} draggable={false} src={codexLogoUrl} />;
}
