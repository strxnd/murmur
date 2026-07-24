interface MutationGate {
  done: Promise<void>;
  finish: () => void;
}

export class ArtifactMutationCoordinator {
  private activeUses = new Map<string, number>();
  private idleWaiters = new Map<string, Set<() => void>>();
  private mutations = new Map<string, MutationGate>();

  async withUse<T>(resources: string[], signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const keys = [...new Set(resources)];
    await this.acquireUse(keys, signal);
    try {
      return await operation();
    } finally {
      this.releaseUse(keys);
    }
  }

  async beginMutation(resource: string, signal?: AbortSignal): Promise<() => void> {
    while (this.mutations.has(resource)) {
      await waitForPromise(this.mutations.get(resource)!.done, signal);
    }

    throwIfAborted(signal);
    const gate = deferred();
    this.mutations.set(resource, gate);
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (this.mutations.get(resource) === gate) this.mutations.delete(resource);
      gate.finish();
    };

    try {
      await this.waitUntilIdle(resource, signal);
      return finish;
    } catch (error) {
      finish();
      throw error;
    }
  }

  private async acquireUse(resources: string[], signal?: AbortSignal): Promise<void> {
    while (true) {
      const pending = resources.map((resource) => this.mutations.get(resource)?.done).filter((value): value is Promise<void> => Boolean(value));
      if (pending.length > 0) {
        await waitForPromise(Promise.all(pending).then(() => undefined), signal);
        continue;
      }

      throwIfAborted(signal);
      for (const resource of resources) {
        this.activeUses.set(resource, (this.activeUses.get(resource) ?? 0) + 1);
      }
      return;
    }
  }

  private releaseUse(resources: string[]): void {
    for (const resource of resources) {
      const next = (this.activeUses.get(resource) ?? 1) - 1;
      if (next > 0) {
        this.activeUses.set(resource, next);
        continue;
      }
      this.activeUses.delete(resource);
      const waiters = this.idleWaiters.get(resource);
      this.idleWaiters.delete(resource);
      for (const resolve of waiters ?? []) resolve();
    }
  }

  private waitUntilIdle(resource: string, signal?: AbortSignal): Promise<void> {
    if (!this.activeUses.has(resource)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiters = this.idleWaiters.get(resource) ?? new Set<() => void>();
      const onIdle = (): void => {
        cleanup();
        resolve();
      };
      const onAbort = (): void => {
        waiters.delete(onIdle);
        cleanup();
        reject(abortError());
      };
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
      waiters.add(onIdle);
      this.idleWaiters.set(resource, waiters);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function deferred(): MutationGate {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { done, finish };
}

function waitForPromise(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Operation was cancelled.");
  error.name = "AbortError";
  return error;
}
