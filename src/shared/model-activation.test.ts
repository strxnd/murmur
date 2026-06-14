import { describe, expect, it } from "vitest";
import { modelCatalog } from "./model-catalog";
import { transcriptionProviderFromModel } from "./model-activation";

describe("transcriptionProviderFromModel", () => {
  it("maps active Whisper models to the bundled whisper.cpp runtime", () => {
    const item = modelCatalog.find((candidate) => candidate.id === "whisper-tiny-en");
    expect(item).toBeDefined();

    const provider = transcriptionProviderFromModel(item!);

    expect(provider?.id).toBe("local-whisper-cpp");
    expect(provider?.baseUrl).toBe("murmur://runtime/whisper.cpp");
  });

  it("maps active Sherpa models to the bundled sherpa-onnx runtime", () => {
    const item = modelCatalog.find((candidate) => candidate.id === "nvidia-parakeet-tdt-ctc-110m");
    expect(item).toBeDefined();

    const provider = transcriptionProviderFromModel(item!);

    expect(provider?.id).toBe("local-nvidia-parakeet-stt");
    expect(provider?.baseUrl).toBe("murmur://runtime/sherpa-onnx");
  });
});
