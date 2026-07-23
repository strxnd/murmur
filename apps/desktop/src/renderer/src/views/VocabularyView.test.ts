import { describe, expect, it } from "vitest";
import { normalizeVocabulary } from "./VocabularyView";

describe("normalizeVocabulary", () => {
  it("preserves disabled entries while trimming and removing blank terms", () => {
    expect(
      normalizeVocabulary([
        { id: "enabled", term: " Enabled ", enabled: true },
        { id: "disabled", term: " Disabled Secret ", enabled: false },
        { id: "blank", term: "   ", enabled: false }
      ])
    ).toEqual([
      { id: "enabled", term: "Enabled", enabled: true },
      { id: "disabled", term: "Disabled Secret", enabled: false }
    ]);
  });
});
