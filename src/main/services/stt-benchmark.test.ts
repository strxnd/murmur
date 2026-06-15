import { describe, expect, it } from "vitest";
import type { SttBenchmarkResult } from "../../shared/types";
import { recommendSttModel } from "./stt-benchmark";

describe("recommendSttModel", () => {
  it("recommends tiny for low memory or slow benchmarks", () => {
    expect(recommendSttModel("multilingual", benchmark({ memoryGb: 4, realtimeFactor: 20 })).recommendedModelId).toBe("whisper-tiny");
    expect(recommendSttModel("english", benchmark({ memoryGb: 32, realtimeFactor: 1.5 })).recommendedModelId).toBe("whisper-tiny-en");
  });

  it("recommends base below 12GB or 6x realtime", () => {
    expect(recommendSttModel("english", benchmark({ memoryGb: 8, realtimeFactor: 20 })).recommendedModelId).toBe("whisper-base-en");
    expect(recommendSttModel("multilingual", benchmark({ memoryGb: 32, realtimeFactor: 4 })).recommendedModelId).toBe("whisper-base");
  });

  it("recommends small below 24GB or 12x realtime", () => {
    expect(recommendSttModel("english", benchmark({ memoryGb: 16, realtimeFactor: 20 })).recommendedModelId).toBe("whisper-small-en");
    expect(recommendSttModel("multilingual", benchmark({ memoryGb: 32, realtimeFactor: 8 })).recommendedModelId).toBe("whisper-small");
  });

  it("recommends turbo only when memory and measured speed have headroom", () => {
    const recommendation = recommendSttModel("english", benchmark({ memoryGb: 32, realtimeFactor: 16 }));

    expect(recommendation.recommendedModelId).toBe("whisper-turbo");
    expect(recommendation.alternatives.map((alternative) => alternative.modelId)).toContain("whisper-medium");
    expect(recommendation.alternatives.map((alternative) => alternative.modelId)).toContain("whisper-large");
  });
});

function benchmark({ memoryGb, realtimeFactor }: { memoryGb: number; realtimeFactor: number }): SttBenchmarkResult {
  return {
    modelId: "whisper-tiny",
    audioDurationMs: 1000,
    elapsedMs: 1000 / realtimeFactor,
    realtimeFactor,
    totalMemoryBytes: memoryGb * 1024 * 1024 * 1024,
    cpuThreadCount: 8,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}
