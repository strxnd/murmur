import { AlertTriangle, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type { AppSettings, ModeSelectorStateSnapshot, PillStateSnapshot } from "../../../shared/types";
import { useMurmurStore, type ActionError } from "../state/murmur-store";
import { useRecordingBridge } from "../hooks/useRecordingBridge";
import { murmurClient } from "../lib/murmur-client";
import { AppShell } from "./AppShell";
import { ModeSelectorOverlay } from "./ModeSelectorOverlay";
import { RecordingPill } from "./RecordingPill";

const systemDarkQuery = "(prefers-color-scheme: dark)";
const themeTransitionSuppressedClass = "theme-transition-suppressed";
let themeTransitionSuppressionFrame: number | null = null;

export function App(): JSX.Element {
  const searchParams = new URLSearchParams(window.location.search);

  if (searchParams.has("mode-selector")) return <ModeSelectorApp />;
  return searchParams.has("pill") ? <PillApp /> : <MainApp />;
}

function MainApp(): JSX.Element {
  const status = useMurmurStore((state) => state.status);
  const snapshot = useMurmurStore((state) => state.snapshot);
  const error = useMurmurStore((state) => state.error);
  const actionError = useMurmurStore((state) => state.actionError);
  const clearActionError = useMurmurStore((state) => state.clearActionError);
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

  useWindowKind("main");
  useRecordingBridge(true);

  if (status === "error") {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-danger">{error ?? "Unable to load Murmur."}</div>;
  }

  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">Loading Murmur...</div>;
  }

  return (
    <>
      <AppShell state={snapshot} />
      <ActionErrorBanner error={actionError} onDismiss={clearActionError} />
    </>
  );
}

function ActionErrorBanner({ error, onDismiss }: { error: ActionError | null; onDismiss: () => void }): JSX.Element | null {
  const alertRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!error) return;
    alertRef.current?.focus({ preventScroll: true });
  }, [error]);

  if (!error) return null;

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-16 z-50 max-w-[min(calc(100vw-2rem),28rem)]">
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="pointer-events-auto flex items-start gap-3 rounded-[15px] border border-danger/45 bg-surface-raised/95 p-4 text-sm text-foreground shadow-[var(--studio-float-shadow)] outline-none backdrop-blur-xl focus-visible:ring-2 focus-visible:ring-danger/30"
      >
        <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={18} />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-medium text-danger">Action failed</p>
          <p className="m-0 mt-1 break-words text-xs leading-5 text-muted-foreground">{error.message}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss action error"
          title="Dismiss"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-surface text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      </div>
    </div>,
    document.body
  );
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

  useWindowKind("pill");

  if (error) {
    return <div className="grid min-h-screen place-items-center p-2 text-xs text-danger">{error}</div>;
  }

  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center p-2 text-xs text-muted-foreground">Loading Murmur...</div>;
  }

  return <RecordingPill state={snapshot} />;
}

function ModeSelectorApp(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ModeSelectorStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = murmurClient.onModeSelectorStateChanged((state) => {
      if (active) setSnapshot(state);
    });

    void murmurClient
      .getModeSelectorState()
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

  useWindowKind("mode-selector");

  if (error) {
    return <div className="grid min-h-screen place-items-center p-2 text-xs text-danger">{error}</div>;
  }

  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center p-2 text-xs text-muted-foreground">Loading Murmur...</div>;
  }

  return <ModeSelectorOverlay state={snapshot} />;
}

function useWindowKind(kind: "main" | "pill" | "mode-selector"): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (kind === "main") {
      delete root.dataset.window;
    } else {
      root.dataset.window = kind;
    }

    return () => {
      if (root.dataset.window === kind) delete root.dataset.window;
    };
  }, [kind]);
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
