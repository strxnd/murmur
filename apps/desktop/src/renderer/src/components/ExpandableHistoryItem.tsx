import { Dialog } from "@base-ui/react/dialog";
import { ChevronDown, ChevronRight, Copy, Trash2 } from "lucide-react";
import { useId, type JSX } from "react";
import type { DictationHistoryItem } from "../../../shared/types";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { useMurmurStore } from "../state/murmur-store";
import { Button } from "./ui/Button";
import { Toolbar } from "./ui/Toolbar";

interface ExpandableHistoryItemProps {
  item: DictationHistoryItem;
  expanded: boolean;
  onToggle: () => void;
}

export function ExpandableHistoryItem({ item, expanded, onToggle }: ExpandableHistoryItemProps): JSX.Element {
  const copyHistoryOutput = useMurmurStore((store) => store.copyHistoryOutput);
  const deleteHistoryItem = useMurmurStore((store) => store.deleteHistoryItem);
  const detailParent = useAutoAnimateRef<HTMLDivElement>();
  const toggleId = useId();
  const detailRegionId = useId();
  const output = item.processedOutput || item.rawTranscript || "No output.";
  const context = [item.appName, item.windowTitle, item.modeName || item.modeId].filter(Boolean).join(" · ");

  return (
    <article className="studio-history-item overflow-hidden rounded-[15px] border border-border bg-surface">
      <Button
        id={toggleId}
        variant="ghost"
        className="history-summary grid h-auto min-h-[74px] w-full grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-3 rounded-none border-0 px-5 py-4 text-left text-foreground hover:bg-muted"
        aria-expanded={expanded}
        aria-controls={detailRegionId}
        onClick={onToggle}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <strong className="line-clamp-2 text-[15px] font-semibold leading-5 text-foreground">{output}</strong>
          <span className="truncate text-xs font-normal text-subtle">{context || "Unknown context"}</span>
        </span>
        <span className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold text-foreground">
          {formatDuration(item.recordingDurationMs)}
        </span>
        <span className="grid place-items-center text-muted-foreground">
          {expanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}
        </span>
      </Button>

      <div id={detailRegionId} ref={detailParent} aria-labelledby={toggleId}>
        {expanded && (
          <div className="history-detail border-t border-border bg-surface/70 p-4">
            <div className="history-transcript-grid grid grid-cols-2 overflow-hidden rounded-[11px] border border-border max-[760px]:grid-cols-1">
              <TranscriptPane label="Original transcript" text={item.rawTranscript || "No transcript."} />
              <TranscriptPane label="Final text" text={output} final />
            </div>

            <div className="my-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-medium text-subtle">
              <span>Created · {formatHistoryTimestamp(item.createdAt)}</span>
              <span>STT · {providerMetadata(item.transcriptionProviderType, item.transcriptionModel, "Unknown")}</span>
              <span>LLM · {providerMetadata(item.llmProviderType, item.llmModel, "None")}</span>
            </div>

            <Toolbar className="justify-start gap-2">
              <Button onClick={() => void copyHistoryOutput(output)}>
                <Copy size={18} /> Copy output
              </Button>
              <Dialog.Root>
                <Dialog.Trigger render={<Button variant="danger" />}>
                  <Trash2 size={18} /> Delete
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
        )}
      </div>
    </article>
  );
}

function TranscriptPane({ label, text, final = false }: { label: string; text: string; final?: boolean }): JSX.Element {
  return (
    <section className={final ? "border-l border-border p-4 max-[760px]:border-l-0 max-[760px]:border-t" : "p-4"}>
      <h3 className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle">{label}</h3>
      <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{text}</p>
    </section>
  );
}

function formatHistoryTimestamp(createdAt: string): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return createdAt;

  const today = new Date();
  const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayDifference = Math.round((todayDay - createdDay) / 86_400_000);
  const dayLabel = dayDifference === 0
    ? "Today"
    : dayDifference === 1
      ? "Yesterday"
      : created.toLocaleDateString(undefined, { month: "short", day: "numeric", year: created.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  const time = created.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dayLabel}, ${time}`;
}

function providerMetadata(provider: string | undefined, model: string | undefined, fallback: string): string {
  const values = [formatProvider(provider), model].filter(Boolean);
  return values.length > 0 ? values.join(" · ") : fallback;
}

function formatProvider(provider: string | undefined): string | undefined {
  if (!provider) return undefined;
  const labels: Record<string, string> = {
    whisper_cpp: "whisper.cpp",
    openai: "OpenAI",
    openai_compatible: "OpenAI-compatible",
    anthropic: "Anthropic",
    google: "Google",
    lmstudio: "LM Studio",
    ollama: "Ollama",
    nvidia: "NVIDIA"
  };
  return labels[provider] ?? provider;
}

function formatDuration(durationMs: number | undefined): string {
  if (!durationMs) return "—";
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}
