import { describe, expect, it } from "vitest";
import { modelCatalog, modelListCatalog } from "./model-catalog";

describe("modelCatalog", () => {
  it("lists remote API models alongside local downloadable models", () => {
    const remoteModels = modelListCatalog.filter((model) => model.isCloud && model.downloadStrategy === "none");
    const localModels = modelListCatalog.filter((model) => !model.isCloud && model.isOffline && model.downloadStrategy !== "none");

    expect(remoteModels.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        "openai-gpt-4o-transcribe",
        "openai-gpt-5-5",
        "anthropic-claude-sonnet-4-6",
        "google-gemini-3-5-flash"
      ])
    );
    expect(localModels.map((model) => model.id)).toEqual(
      modelCatalog
        .filter((model) => model.kind === "voice" && !model.isCloud && model.isOffline && model.downloadStrategy !== "none")
        .map((model) => model.id)
    );
  });

  it("exposes exactly one Codex model", () => {
    expect(modelListCatalog.filter((model) => model.provider === "codex")).toEqual([
      expect.objectContaining({
        id: "codex-gpt-5-6-luna",
        name: "GPT-5.6 Luna",
        defaultProviderConfig: expect.objectContaining({ model: "gpt-5.6-luna" })
      })
    ]);
  });
});
