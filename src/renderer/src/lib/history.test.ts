import { describe, expect, it } from "vitest";
import type { DictationHistoryItem } from "../../../shared/types";
import {
  defaultHistoryRenderLimit,
  filterIndexedHistoryItems,
  indexHistoryForSearch,
  nextHistoryVisibleLimit,
  visibleHistoryItems
} from "./history";

describe("history helpers", () => {
  it("indexes searchable history fields case-insensitively", () => {
    const indexed = indexHistoryForSearch([
      historyItem({ id: "one", rawTranscript: "Call Alice", appName: "Slack" }),
      historyItem({ id: "two", processedOutput: "Ship the release", browserDomain: "github.com" })
    ]);

    expect(filterIndexedHistoryItems(indexed, "alice").map((item) => item.id)).toEqual(["one"]);
    expect(filterIndexedHistoryItems(indexed, "GITHUB").map((item) => item.id)).toEqual(["two"]);
  });

  it("bounds visible rows and advances in fixed batches", () => {
    const history = Array.from({ length: defaultHistoryRenderLimit + 30 }, (_, index) => historyItem({ id: `item-${index}` }));

    expect(visibleHistoryItems(history, defaultHistoryRenderLimit)).toHaveLength(defaultHistoryRenderLimit);
    expect(nextHistoryVisibleLimit(defaultHistoryRenderLimit, history.length)).toBe(history.length);
  });

  it("keeps a 2,000-entry search render bounded", () => {
    const history = Array.from({ length: 2000 }, (_, index) =>
      historyItem({
        id: `item-${index}`,
        rawTranscript: `Long dictation ${index} ${"word ".repeat(120)}`,
        appName: index === 1999 ? "Needle App" : "Notes"
      })
    );

    const filtered = filterIndexedHistoryItems(indexHistoryForSearch(history), "needle");

    expect(filtered.map((item) => item.id)).toEqual(["item-1999"]);
    expect(visibleHistoryItems(history, defaultHistoryRenderLimit)).toHaveLength(defaultHistoryRenderLimit);
  });
});

function historyItem(overrides: Partial<DictationHistoryItem> = {}): DictationHistoryItem {
  return {
    id: "item",
    audioPath: null,
    rawTranscript: "",
    processedOutput: "",
    modeId: "default",
    modeName: "Default",
    transcriptionProviderCloud: false,
    transcriptionStreamingMode: "none",
    llmProviderCloud: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
