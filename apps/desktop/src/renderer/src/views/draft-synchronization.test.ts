import { describe, expect, it } from "vitest";
import { defaultModes } from "../../../shared/defaults";
import type { ModelCatalogItem } from "../../../shared/types";
import type { ProviderSetupTarget } from "../../../shared/model-provider-setup";
import { providerSetupDraftKey } from "./ModelsLibraryView";
import { shouldReconcileModesSnapshot } from "./ModesView";

describe("renderer draft synchronization", () => {
  it("does not reinitialize an open provider credential draft for equivalent snapshot objects", () => {
    const item = { id: "gpt-test" } as ModelCatalogItem;
    const target = {
      kind: "llm",
      modelId: "gpt-test",
      modelName: "GPT Test",
      providerId: "openai",
      providerName: "OpenAI"
    } satisfies ProviderSetupTarget;

    expect(providerSetupDraftKey(true, item, target)).toBe(
      providerSetupDraftKey(true, { ...item }, { ...target })
    );
    expect(providerSetupDraftKey(false, item, target)).toBeNull();
  });

  it("preserves dirty mode edits and drafts across background snapshots", () => {
    const incomingModes = defaultModes.map((mode) => ({ ...mode }));

    expect(shouldReconcileModesSnapshot(defaultModes, incomingModes, true, false)).toBe(false);
    expect(shouldReconcileModesSnapshot(defaultModes, incomingModes, false, true)).toBe(false);
    expect(shouldReconcileModesSnapshot(defaultModes, incomingModes, false, false)).toBe(false);
    expect(
      shouldReconcileModesSnapshot(defaultModes, [{ ...incomingModes[0]!, name: "Persisted elsewhere" }], false, false)
    ).toBe(true);
  });
});
