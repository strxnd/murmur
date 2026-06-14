import { ChevronDown, ChevronRight, Clipboard, Copy, Trash2, Wand2 } from "lucide-react";
import type { JSX } from "react";
import type { DictationHistoryItem } from "../../../shared/types";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { useMurmurStore } from "../state/murmur-store";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Toolbar } from "./ui/Toolbar";

interface ExpandableHistoryItemProps {
  item: DictationHistoryItem;
  expanded: boolean;
  onToggle: () => void;
}

export function ExpandableHistoryItem({ item, expanded, onToggle }: ExpandableHistoryItemProps): JSX.Element {
  const copyHistoryOutput = useMurmurStore((store) => store.copyHistoryOutput);
  const repasteHistoryOutput = useMurmurStore((store) => store.repasteHistoryOutput);
  const reprocessHistoryItem = useMurmurStore((store) => store.reprocessHistoryItem);
  const deleteHistoryItem = useMurmurStore((store) => store.deleteHistoryItem);
  const detailParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <article className="rounded-md border border-border bg-surface">
      <Button
        variant="ghost"
        className="flex h-auto min-h-0 w-full items-start justify-start gap-3 rounded-b-none rounded-t-md border-0 p-4 text-left text-foreground hover:bg-muted"
        onClick={onToggle}
      >
        <span className="mt-0.5 text-muted-foreground">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
        <span className="m-0 whitespace-pre-wrap text-sm font-normal leading-6 text-foreground">{item.rawTranscript || "No transcript."}</span>
      </Button>

      <div ref={detailParent}>
        {expanded && (
          <div className="border-t border-border p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 max-[760px]:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-3">
                <section>
                  <h3 className="m-0 mb-2 text-xs font-semibold uppercase text-muted-foreground">Processed output</h3>
                  <p className="m-0 whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
                    {item.processedOutput || item.rawTranscript || "No output."}
                  </p>
                </section>
                <div className="grid grid-cols-2 gap-2 text-sm max-[760px]:grid-cols-1">
                  <Detail label="Created" value={new Date(item.createdAt).toLocaleString()} />
                  <Detail label="App/window" value={[item.appName, item.windowTitle].filter(Boolean).join(" · ") || "Unknown"} />
                  <Detail label="Mode" value={item.modeName || item.modeId || "Unknown"} />
                  <Detail label="STT" value={[item.transcriptionProviderType, item.transcriptionModel].filter(Boolean).join(" · ") || "Unknown"} />
                  <Detail label="LLM" value={[item.llmProviderType, item.llmModel].filter(Boolean).join(" · ") || "None"} />
                  <Detail label="Duration" value={formatDuration(item.recordingDurationMs)} />
                </div>
              </div>
              <Toolbar className="items-start justify-end">
                <IconButton title="Copy output" onClick={() => void copyHistoryOutput(item.processedOutput || item.rawTranscript)}>
                  <Copy size={18} />
                </IconButton>
                <IconButton title="Re-paste output" onClick={() => void repasteHistoryOutput(item.processedOutput || item.rawTranscript)}>
                  <Clipboard size={18} />
                </IconButton>
                <IconButton title="Reprocess" onClick={() => void reprocessHistoryItem(item.id)}>
                  <Wand2 size={18} />
                </IconButton>
                <Button variant="danger" size="sm" onClick={() => void deleteHistoryItem(item.id)}>
                  <Trash2 size={16} /> Delete
                </Button>
              </Toolbar>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm text-foreground">{value}</div>
    </div>
  );
}

function formatDuration(durationMs: number | undefined): string {
  if (!durationMs) return "Unknown";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
