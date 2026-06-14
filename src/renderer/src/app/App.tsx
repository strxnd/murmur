import { useEffect, useLayoutEffect, type JSX } from "react";
import type { AppSettings } from "../../../shared/types";
import { useMurmurStore } from "../state/murmur-store";
import { useRecordingBridge } from "../hooks/useRecordingBridge";
import { AppShell } from "./AppShell";
import { RecordingPill } from "./RecordingPill";

const systemDarkQuery = "(prefers-color-scheme: dark)";
const themeTransitionSuppressedClass = "theme-transition-suppressed";
let themeTransitionSuppressionFrame: number | null = null;

export function App(): JSX.Element {
  const searchParams = new URLSearchParams(window.location.search);

  return <LiveApp isPill={searchParams.has("pill")} />;
}

function LiveApp({ isPill }: { isPill: boolean }): JSX.Element {
  const status = useMurmurStore((state) => state.status);
  const snapshot = useMurmurStore((state) => state.snapshot);
  const error = useMurmurStore((state) => state.error);
  const init = useMurmurStore((state) => state.init);
  const dispose = useMurmurStore((state) => state.dispose);

  useEffect(() => {
    void init();
    return () => dispose();
  }, [dispose, init]);

  useLayoutEffect(() => {
    if (!snapshot) return undefined;
    return applyTheme(snapshot.settings.theme);
  }, [snapshot?.settings.theme]);

  useRecordingBridge();

  if (status === "error") {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-danger">{error ?? "Unable to load Murmur."}</div>;
  }

  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">Loading Murmur...</div>;
  }

  if (isPill) return <RecordingPill state={snapshot} />;

  return <AppShell state={snapshot} />;
}

function applyTheme(theme: AppSettings["theme"]): () => void {
  const media = window.matchMedia(systemDarkQuery);
  const root = document.documentElement;
  const syncTheme = (): void => {
    const effectiveTheme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    if (root.dataset.theme !== effectiveTheme) {
      suppressThemeTransitions(root);
      root.dataset.theme = effectiveTheme;
    }
    root.dataset.themeSource = theme;
  };

  syncTheme();

  if (theme !== "system") return () => undefined;

  media.addEventListener("change", syncTheme);
  return () => media.removeEventListener("change", syncTheme);
}

function suppressThemeTransitions(root: HTMLElement): void {
  if (themeTransitionSuppressionFrame !== null) {
    window.cancelAnimationFrame(themeTransitionSuppressionFrame);
  }

  root.classList.add(themeTransitionSuppressedClass);
  themeTransitionSuppressionFrame = window.requestAnimationFrame(() => {
    themeTransitionSuppressionFrame = window.requestAnimationFrame(() => {
      root.classList.remove(themeTransitionSuppressedClass);
      themeTransitionSuppressionFrame = null;
    });
  });
}
