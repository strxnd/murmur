import { Dialog } from "@base-ui/react/dialog";
import { Search, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { ExpandableHistoryItem } from "../components/ExpandableHistoryItem";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import {
  defaultHistoryRenderLimit,
  filterIndexedHistoryItems,
  indexHistoryForSearch,
  nextHistoryVisibleLimit,
  visibleHistoryItems
} from "../lib/history";
import { useMurmurStore } from "../state/murmur-store";

export function HistoryView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const clearHistory = useMurmurStore((store) => store.clearHistory);
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(defaultHistoryRenderLimit);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const historyListParent = useAutoAnimateRef<HTMLElement>();
  const historyCount = state.history.length;
  const historyEntryLabel = `${historyCount} ${historyCount === 1 ? "entry" : "entries"}`;
  const debouncedQuery = useDebouncedValue(query, 120);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const indexedHistory = useMemo(() => indexHistoryForSearch(state.history), [state.history]);
  const filtered = useMemo(() => {
    return filterIndexedHistoryItems(indexedHistory, deferredQuery);
  }, [deferredQuery, indexedHistory]);
  const visibleItems = useMemo(() => visibleHistoryItems(filtered, visibleLimit), [filtered, visibleLimit]);
  const isSearchPending = query.trim() !== deferredQuery.trim();

  useEffect(() => {
    setVisibleLimit(defaultHistoryRenderLimit);
  }, [deferredQuery, historyCount]);

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
      title="Review dictations"
      description="Search previous recordings and open entries to compare raw transcripts with final text."
      actions={
        <Toolbar>
          <Dialog.Root>
            <Dialog.Trigger disabled={historyCount === 0} render={<Button variant="danger" />}>
              <Trash2 size={18} /> Clear
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
              <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
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
          <Input
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search dictations"
            aria-label="Search dictation history"
          />
        </label>
        <p className="m-0 mt-2 text-xs text-muted-foreground" aria-live="polite">
          {isSearchPending
            ? "Searching..."
            : `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}${filtered.length > visibleItems.length ? `, showing ${visibleItems.length}` : ""}`}
        </p>
      </Panel>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState title="No dictations found" detail={query ? "Try a different search." : "Completed dictations will appear here."} />
        </Panel>
      ) : (
        <section ref={historyListParent} className="flex flex-col gap-3" aria-busy={isSearchPending}>
          {visibleItems.map((item) => (
            <ExpandableHistoryItem
              key={item.id}
              item={item}
              expanded={expandedIds.has(item.id)}
              onToggle={() => toggleExpanded(item.id)}
            />
          ))}
          {visibleItems.length < filtered.length && (
            <Panel>
              <div className="flex items-center justify-between gap-3 max-[760px]:flex-col max-[760px]:items-stretch">
                <p className="m-0 text-sm text-muted-foreground">
                  Showing {visibleItems.length} of {filtered.length} matching dictations.
                </p>
                <Button variant="secondary" onClick={() => setVisibleLimit((current) => nextHistoryVisibleLimit(current, filtered.length))}>
                  Show more
                </Button>
              </div>
            </Panel>
          )}
        </section>
      )}
    </View>
  );
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}
