import { describe, expect, it } from "vitest";
import { ArtifactMutationCoordinator } from "./artifact-mutation-coordinator";

describe("ArtifactMutationCoordinator", () => {
  it("does not block a different runtime variant mutation", async () => {
    const coordinator = new ArtifactMutationCoordinator();
    let releaseCpuUse!: () => void;
    const cpuUse = coordinator.withUse(["runtime:whisper.cpp|linux-x64|cpu|1"], undefined, () =>
      new Promise<void>((resolve) => {
        releaseCpuUse = resolve;
      })
    );
    await Promise.resolve();

    const finishCudaMutation = await coordinator.beginMutation("runtime:whisper.cpp|linux-x64|cuda|1");
    finishCudaMutation();
    releaseCpuUse();

    await cpuUse;
  });

  it("defers a matching mutation, blocks new uses, and resumes them after release", async () => {
    const coordinator = new ArtifactMutationCoordinator();
    let releaseUse!: () => void;
    let mutationStarted = false;
    let secondUseStarted = false;
    const firstUse = coordinator.withUse(["model:/models/whisper.bin"], undefined, () =>
      new Promise<void>((resolve) => {
        releaseUse = resolve;
      })
    );
    await Promise.resolve();

    const mutation = coordinator.beginMutation("model:/models/whisper.bin").then((finish) => {
      mutationStarted = true;
      return finish;
    });
    await Promise.resolve();
    const secondUse = coordinator.withUse(["model:/models/whisper.bin"], undefined, async () => {
      secondUseStarted = true;
    });
    await Promise.resolve();

    expect(mutationStarted).toBe(false);
    expect(secondUseStarted).toBe(false);

    releaseUse();
    await firstUse;
    const finishMutation = await mutation;
    expect(mutationStarted).toBe(true);
    expect(secondUseStarted).toBe(false);

    finishMutation();
    await secondUse;
    expect(secondUseStarted).toBe(true);
  });

  it("cancels a mutation waiting for an active operation without leaving the resource blocked", async () => {
    const coordinator = new ArtifactMutationCoordinator();
    const controller = new AbortController();
    let releaseUse!: () => void;
    const activeUse = coordinator.withUse(["runtime:cpu"], undefined, () =>
      new Promise<void>((resolve) => {
        releaseUse = resolve;
      })
    );
    await Promise.resolve();

    const mutation = coordinator.beginMutation("runtime:cpu", controller.signal);
    controller.abort();

    await expect(mutation).rejects.toMatchObject({ name: "AbortError" });
    let nextUseStarted = false;
    const nextUse = coordinator.withUse(["runtime:cpu"], undefined, async () => {
      nextUseStarted = true;
    });
    await Promise.resolve();
    expect(nextUseStarted).toBe(true);

    releaseUse();
    await Promise.all([activeUse, nextUse]);
  });
});
