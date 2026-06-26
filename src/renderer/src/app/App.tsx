import { useEffect, useLayoutEffect, useState, type JSX } from "react";
import type { AppSettings, PillStateSnapshot } from "../../../shared/types";
import { useMurmurStore } from "../state/murmur-store";
import { useRecordingBridge } from "../hooks/useRecordingBridge";
import { murmurClient } from "../lib/murmur-client";
import { AppShell } from "./AppShell";
import { RecordingPill } from "./RecordingPill";

const systemDarkQuery = "(prefers-color-scheme: dark)";
const themeTransitionSuppressedClass = "theme-transition-suppressed";
let themeTransitionSuppressionFrame: number | null = null;

export function App(): JSX.Element {
  const searchParams = new URLSearchParams(window.location.search);

  return searchParams.has("pill") ? <PillApp /> : <MainApp />;
}

function MainApp(): JSX.Element {
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

  useWindowKind(false);
  useRecordingBridge(true);

  if (status === "error") {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-danger">{error ?? "Unable to load Murmur."}</div>;
  }

  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">Loading Murmur...</div>;
  }

  return <AppShell state={snapshot} />;
}

function PillApp(): JSX.Element {
  const [snapshot, setSnapshot] = useState<PillStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = murmurClient.onPillStateChanged((state) => {
      if (active) setSnapshot(state);
    });

    void murmurClient
      .getPillState()
      .then((state) => {
        if (active) {
          setSnapshot(state);
          setError(null);
        }
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    if (!snapshot) return undefined;
    return applyTheme(snapshot.theme);
  }, [snapshot?.theme]);

  useWindowKind(true);

  if (error) {
    return <div className="grid min-h-screen place-items-center p-2 text-xs text-danger">{error}</div>;
  }

  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center p-2 text-xs text-muted-foreground">Loading Murmur...</div>;
  }

  return <RecordingPill state={snapshot} />;
}

function useWindowKind(isPill: boolean): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (isPill) {
      root.dataset.window = "pill";
    } else if (root.dataset.window === "pill") {
      delete root.dataset.window;
    }

    return () => {
      if (root.dataset.window === "pill") delete root.dataset.window;
    };
  }, [isPill]);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
