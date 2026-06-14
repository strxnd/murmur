import { Dialog } from "@base-ui/react/dialog";
import { Search, Trash2 } from "lucide-react";
import { useMemo, useState, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { ExpandableHistoryItem } from "../components/ExpandableHistoryItem";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { useMurmurStore } from "../state/murmur-store";

export function HistoryView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const clearHistory = useMurmurStore((store) => store.clearHistory);
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const historyListParent = useAutoAnimateRef<HTMLElement>();
  const historyCount = state.history.length;
  const historyEntryLabel = `${historyCount} ${historyCount === 1 ? "entry" : "entries"}`;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.history;
    return state.history.filter((item) =>
      [
        item.rawTranscript,
        item.processedOutput,
        item.modeName,
        item.appName,
        item.windowTitle,
        item.browserDomain,
        item.transcriptionProviderType,
        item.transcriptionModel,
        item.llmProviderType,
        item.llmModel
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle))
    );
  }, [query, state.history]);

  const toggleExpanded = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View
      title="History"
      actions={
        <Toolbar>
          <Dialog.Root>
            <Dialog.Trigger disabled={historyCount === 0} render={<Button variant="danger" />}>
              <Trash2 size={18} /> Clear
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/70" />
              <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-2xl outline-none">
                <Dialog.Title className="m-0 text-base font-semibold text-foreground">Clear history?</Dialog.Title>
                <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                  This will permanently delete {historyEntryLabel}. This cannot be undone.
                </Dialog.Description>
                <div className="mt-5 flex justify-end gap-2">
                  <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
                  <Dialog.Close onClick={() => void clearHistory()} render={<Button variant="danger" />}>
                    Clear history
                  </Dialog.Close>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </Toolbar>
      }
    >
      <Panel>
        <label className="relative block">
          <Search className="absolute left-2.5 top-2.5 text-muted-foreground" size={18} />
          <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search dictations" />
        </label>
      </Panel>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState title="No dictations found" detail={query ? "Try a different search." : "Completed dictations will appear here."} />
        </Panel>
      ) : (
        <section ref={historyListParent} className="flex flex-col gap-3">
          {filtered.map((item) => (
            <ExpandableHistoryItem
              key={item.id}
              item={item}
              expanded={expandedIds.has(item.id)}
              onToggle={() => toggleExpanded(item.id)}
            />
          ))}
        </section>
      )}
    </View>
  );
}
