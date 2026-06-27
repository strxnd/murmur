import {
  Check,
  Mail,
  MessageSquare,
  Mic,
  NotebookPen,
  SlidersHorizontal,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type Ref } from "react";
import type { ModeConfig, ModeIconKey, ModeSelectorStateSnapshot } from "../../../shared/types";
import { murmurClient } from "../lib/murmur-client";
import { cn } from "../lib/cn";

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
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const [overlayMetrics, setOverlayMetrics] = useState<OverlayMetrics | null>(null);

  const hide = useCallback((): void => {
    void murmurClient.hideModeSelector();
  }, []);

  const moveSelection = useCallback((delta: number): void => {
    if (isBlocked) return;
    void murmurClient.moveModeSelectorSelection(delta);
  }, [isBlocked]);

  const selectMode = useCallback(
    async (mode: ModeConfig): Promise<void> => {
      if (isBlocked) return;
      await murmurClient.selectModeFromSelector(mode.id);
    },
    [isBlocked]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hide, moveSelection]);

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
        <div
          ref={listRef}
          className="mode-selector-list"
          role="listbox"
          aria-label="Dictation modes"
          aria-activedescendant={state.activeModeId}
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
  buttonRef?: Ref<HTMLButtonElement>;
}): JSX.Element {
  const Icon = modeIconMap[mode.iconKey];

  return (
    <button
      ref={buttonRef}
      id={mode.id}
      type="button"
      role="option"
      aria-selected={active}
      className={cn("mode-selector-row", active && "mode-selector-row--active")}
      onClick={onSelect}
      disabled={disabled}
    >
      <span className="mode-selector-row__icon">
        <Icon size={18} />
      </span>
      <span className="mode-selector-row__name">{mode.name}</span>
      <span className="mode-selector-row__check" aria-hidden="true">
        {active && <Check size={18} />}
      </span>
    </button>
  );
}
