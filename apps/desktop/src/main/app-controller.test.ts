import { describe, expect, it, vi } from "vitest";
import { codexProviderDefaults } from "../shared/codex-provider";
import {
  computeDurationMs,
  countWords,
  rendererQueryFromSuffix,
  selectLlmProviderAfterInitialRefresh,
  shouldPersistDictationHistory,
  wrapIndex
} from "./app-controller";

describe("app-controller utility contracts", () => {
  it("keeps renderer window routing suffixes as loadFile query objects", () => {
    expect(rendererQueryFromSuffix("")).toBeUndefined();
    expect(rendererQueryFromSuffix("?pill=1")).toEqual({ pill: "1" });
    expect(rendererQueryFromSuffix("mode-selector=1")).toEqual({ "mode-selector": "1" });
  });

  it("wraps mode selector indexes in both directions", () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(2, 0)).toBe(0);
  });

  it("computes recording duration and transcript word counts defensively", () => {
    expect(computeDurationMs("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:02.500Z")).toBe(2500);
    expect(computeDurationMs("bad", "2026-01-01T00:00:02.500Z")).toBeUndefined();
    expect(countWords("  one   two\nthree  ")).toBe(3);
  });

  it("keeps onboarding dictations out of persisted history", () => {
    expect(shouldPersistDictationHistory("dictation")).toBe(true);
    expect(shouldPersistDictationHistory("onboarding")).toBe(false);
  });

  it("waits for the initial Codex refresh before selecting an LLM for completed recordings", async () => {
    let finishRefresh!: () => void;
    const initialRefresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const selectProvider = vi.fn(() => ({ ...codexProviderDefaults }));

    const selection = selectLlmProviderAfterInitialRefresh(initialRefresh, selectProvider);

    expect(selectProvider).not.toHaveBeenCalled();
    finishRefresh();
    await expect(selection).resolves.toEqual(codexProviderDefaults);
    expect(selectProvider).toHaveBeenCalledOnce();
  });
});
