import {
  Check,
  Mail,
  MessageSquare,
  Mic,
  NotebookPen,
  SlidersHorizontal,
  X,
  type LucideIcon
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type Ref
} from "react";
import type { ModeConfig, ModeIconKey, ModeSelectorStateSnapshot } from "../../../shared/types";
import { murmurClient } from "../lib/murmur-client";
import { cn } from "../lib/cn";
import { modeSelectorOptionId } from "../lib/mode-selector";

const blockedSessionStatuses = new Set(["recording", "transcribing", "processing", "pasting"]);

const modeIconMap: Record<ModeIconKey, LucideIcon> = {
  mic: Mic,
  "message-square": MessageSquare,
  mail: Mail,
  "notebook-pen": NotebookPen,
  "sliders-horizontal": SlidersHorizontal
};

type OverlayMetrics = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function ModeSelectorOverlay({ state }: { state: ModeSelectorStateSnapshot }): JSX.Element {
  const isBlocked = blockedSessionStatuses.has(state.session.status);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const [overlayMetrics, setOverlayMetrics] = useState<OverlayMetrics | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hide = useCallback((): void => {
    void murmurClient.hideModeSelector().catch((error) => setActionError(errorMessage(error)));
  }, []);

  const moveSelection = useCallback((delta: number): void => {
    if (isBlocked) return;
    void murmurClient
      .moveModeSelectorSelection(delta)
      .then(() => setActionError(null))
      .catch((error) => setActionError(errorMessage(error)));
  }, [isBlocked]);

  const selectMode = useCallback(
    async (mode: ModeConfig): Promise<void> => {
      if (isBlocked) return;
      try {
        await murmurClient.selectModeFromSelector(mode.id);
        setActionError(null);
      } catch (error) {
        setActionError(errorMessage(error));
      }
    },
    [isBlocked]
  );

  const selectedMode = state.modes.find((mode) => mode.id === state.activeModeId) ?? state.modes[0];
  const activeDescendant = selectedMode ? modeSelectorOptionId(selectedMode.id) : undefined;

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }

      if ((event.key === "Enter" || event.key === " ") && selectedMode) {
        event.preventDefault();
        void selectMode(selectedMode);
      }
    },
    [hide, moveSelection, selectMode, selectedMode]
  );

  const updateOverlayMetrics = useCallback((): void => {
    const activeRow = activeRowRef.current;
    if (!activeRow) {
      setOverlayMetrics(null);
      return;
    }

    const nextMetrics: OverlayMetrics = {
      top: activeRow.offsetTop,
      left: activeRow.offsetLeft,
      width: activeRow.offsetWidth,
      height: activeRow.offsetHeight
    };

    setOverlayMetrics((currentMetrics) => {
      if (
        currentMetrics?.top === nextMetrics.top &&
        currentMetrics.left === nextMetrics.left &&
        currentMetrics.width === nextMetrics.width &&
        currentMetrics.height === nextMetrics.height
      ) {
        return currentMetrics;
      }

      return nextMetrics;
    });
  }, []);

  useLayoutEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    updateOverlayMetrics();
  }, [state.activeModeId, state.modes, updateOverlayMetrics]);

  useEffect(() => {
    if (isBlocked) return;
    listRef.current?.focus({ preventScroll: true });
  }, [isBlocked]);

  useEffect(() => {
    const activeRow = activeRowRef.current;
    const list = listRef.current;
    if (!activeRow || !list || typeof ResizeObserver === "undefined") return undefined;

    const resizeObserver = new ResizeObserver(updateOverlayMetrics);
    resizeObserver.observe(activeRow);
    resizeObserver.observe(list);

    return () => resizeObserver.disconnect();
  }, [state.activeModeId, updateOverlayMetrics]);

  useEffect(() => {
    window.addEventListener("resize", updateOverlayMetrics);
    return () => window.removeEventListener("resize", updateOverlayMetrics);
  }, [updateOverlayMetrics]);

  const overlayStyle: CSSProperties | undefined = overlayMetrics
    ? {
        height: `${overlayMetrics.height}px`,
        transform: `translate3d(${overlayMetrics.left}px, ${overlayMetrics.top}px, 0)`,
        width: `${overlayMetrics.width}px`
      }
    : undefined;

  return (
    <div className="mode-selector-shell">
      <div className="mode-selector-panel" data-blocked={isBlocked ? "true" : undefined}>
        <header className="mode-selector-header">
          <div>
            <span>Choose a mode</span>
            <strong>How should Murmur shape this?</strong>
          </div>
          <button type="button" aria-label="Close mode selector" onClick={hide}>
            <X size={16} />
          </button>
        </header>
        <div
          ref={listRef}
          className="mode-selector-list"
          role="listbox"
          tabIndex={isBlocked ? -1 : 0}
          aria-label="Dictation modes"
          aria-activedescendant={activeDescendant}
          aria-disabled={isBlocked ? "true" : undefined}
          onKeyDown={handleListKeyDown}
        >
          {overlayMetrics && <div className="mode-selector-active-overlay" aria-hidden="true" style={overlayStyle} />}
          {state.modes.map((mode) => (
            <ModeSelectorRow
              key={mode.id}
              mode={mode}
              active={mode.id === state.activeModeId}
              disabled={isBlocked}
              onSelect={() => void selectMode(mode)}
              buttonRef={mode.id === state.activeModeId ? activeRowRef : undefined}
            />
          ))}
        </div>
        <div className="mode-selector-bindings" aria-label="Keyboard controls">
          <span>
            <kbd>↑</kbd> / <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Esc</kbd> to exit
          </span>
        </div>
        {actionError && (
          <div className="mode-selector-error" role="alert">
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeSelectorRow({
  mode,
  active,
  disabled,
  onSelect,
  buttonRef
}: {
  mode: ModeConfig;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  buttonRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const Icon = modeIconMap[mode.iconKey];

  return (
    <div
      ref={buttonRef}
      id={modeSelectorOptionId(mode.id)}
      role="option"
      aria-selected={active}
      aria-disabled={disabled ? "true" : undefined}
      className={cn("mode-selector-row", active && "mode-selector-row--active")}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="mode-selector-row__icon">
        <Icon size={18} />
      </span>
      <span className="mode-selector-row__copy">
        <strong className="mode-selector-row__name">{mode.name}</strong>
        <small>{mode.description || (mode.aiEnabled ? "AI cleanup" : "Speech to text")}</small>
      </span>
      <span className="mode-selector-row__check" aria-hidden="true">
        {active && <Check size={18} />}
      </span>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
