import { Dialog } from "@base-ui/react/dialog";
import { ChevronDown, ChevronRight, Clipboard, Copy, Trash2, Wand2 } from "lucide-react";
import { useId, type JSX } from "react";
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
  const toggleId = useId();
  const detailRegionId = useId();

  return (
    <article className="rounded-md border border-border bg-surface">
      <Button
        id={toggleId}
        variant="ghost"
        className="flex h-auto min-h-0 w-full items-start justify-start gap-3 rounded-b-none rounded-t-md border-0 p-4 text-left text-foreground hover:bg-muted"
        aria-expanded={expanded}
        aria-controls={detailRegionId}
        onClick={onToggle}
      >
        <span className="mt-0.5 text-muted-foreground">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
        <span className="m-0 whitespace-pre-wrap text-sm font-normal leading-6 text-foreground">{item.rawTranscript || "No transcript."}</span>
      </Button>

      <div id={detailRegionId} ref={detailParent} aria-labelledby={toggleId}>
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
                <Dialog.Root>
                  <Dialog.Trigger render={<Button variant="danger" size="sm" />}>
                    <Trash2 size={16} /> Delete
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
                    <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                      <Dialog.Title className="m-0 text-base font-semibold text-foreground">Delete history item?</Dialog.Title>
                      <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                        This dictation history item will be permanently deleted. This cannot be undone.
                      </Dialog.Description>
                      <div className="mt-5 flex justify-end gap-2">
                        <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
                        <Dialog.Close onClick={() => void deleteHistoryItem(item.id)} render={<Button variant="danger" />}>
                          Delete item
                        </Dialog.Close>
                      </div>
                    </Dialog.Popup>
                  </Dialog.Portal>
                </Dialog.Root>
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
