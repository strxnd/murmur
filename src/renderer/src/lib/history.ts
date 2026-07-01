import type { DictationHistoryItem } from "../../../shared/types";

export const defaultHistoryRenderLimit = 80;
export const historyRenderBatchSize = 80;

const searchableHistoryFields = [
  "rawTranscript",
  "processedOutput",
  "modeName",
  "appName",
  "windowTitle",
  "transcriptionProviderType",
  "transcriptionModel",
  "llmProviderType",
  "llmModel"
] as const satisfies ReadonlyArray<keyof DictationHistoryItem>;

export interface IndexedHistoryItem {
  item: DictationHistoryItem;
  searchText: string;
}

export function indexHistoryForSearch(history: DictationHistoryItem[]): IndexedHistoryItem[] {
  return history.map((item) => ({
    item,
    searchText: searchableHistoryFields
      .map((field) => item[field])
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n")
      .toLowerCase()
  }));
}

export function filterIndexedHistoryItems(indexedHistory: IndexedHistoryItem[], query: string): DictationHistoryItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return indexedHistory.map((entry) => entry.item);
  return indexedHistory.filter((entry) => entry.searchText.includes(needle)).map((entry) => entry.item);
}

export function visibleHistoryItems(history: DictationHistoryItem[], limit: number): DictationHistoryItem[] {
  return history.slice(0, Math.max(0, limit));
}

export function nextHistoryVisibleLimit(currentLimit: number, totalCount: number): number {
  return Math.min(totalCount, currentLimit + historyRenderBatchSize);
}
