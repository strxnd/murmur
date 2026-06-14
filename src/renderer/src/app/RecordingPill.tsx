import { Ban, RefreshCw, Square } from "lucide-react";
import type { JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { IconButton } from "../components/ui/IconButton";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { useMurmurStore } from "../state/murmur-store";
import { cn } from "../lib/cn";

export function RecordingPill({ state }: { state: AppStateSnapshot }): JSX.Element {
  const stopDictation = useMurmurStore((store) => store.stopDictation);
  const cancelDictation = useMurmurStore((store) => store.cancelDictation);
  const isBusy = ["transcribing", "processing", "pasting"].includes(state.session.status);
  const pillParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div ref={pillParent} className="grid h-screen w-screen grid-cols-[1.125rem_minmax(0,1fr)_2.25rem_2.25rem] items-center gap-2.5 rounded-full border border-border bg-surface/95 px-3.5 py-3 shadow-2xl shadow-black/40">
      <div className={cn("h-3.5 w-3.5 rounded-full border border-border bg-muted-foreground", state.session.status === "recording" && "animate-pulse bg-foreground")} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium capitalize text-foreground">{state.session.status}</div>
        <div className="truncate text-xs text-muted-foreground">
          {state.modes.find((mode) => mode.id === state.session.modeId)?.name ?? "Mode"}
          {state.session.cloudStt || state.session.cloudLlm ? " · cloud" : " · local"}
          {state.session.streamingMode !== "none" ? " · streaming" : " · final"}
        </div>
      </div>
      {state.session.status === "recording" ? (
        <IconButton title="Stop" onClick={() => void stopDictation()}>
          <Square size={18} />
        </IconButton>
      ) : (
        <IconButton title="Working" disabled={isBusy}>
          <RefreshCw size={18} />
        </IconButton>
      )}
      <IconButton title="Cancel" tone="danger" onClick={() => void cancelDictation()}>
        <Ban size={18} />
      </IconButton>
    </div>
  );
}
