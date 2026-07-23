import type { BusConnection, MessageBus } from "@homebridge/dbus-native";

export type DbusConnection = BusConnection & {
  end?: () => void;
};

export type DbusMessageBus = MessageBus & {
  connection: DbusConnection;
  name?: string;
};

export interface DbusMessage {
  sender?: string;
  path?: string;
  interface?: string;
  member?: string;
  body?: unknown[];
}

interface PendingInvocation {
  reject: (error: Error) => void;
}

export class DbusSessionConnection<TBus extends DbusMessageBus = DbusMessageBus> {
  private bus: TBus | null = null;
  private pendingInvocations = new Set<PendingInvocation>();

  constructor(
    private readonly createBus: () => TBus,
    private readonly onMessage: (message: DbusMessage) => void,
    private readonly onConnectionLost: (error: Error) => void
  ) {}

  getBus(): TBus {
    if (this.bus) return this.bus;

    const bus = this.createBus();
    this.bus = bus;
    bus.connection.on("message", this.handleMessage);
    bus.connection.on("error", this.handleError);
    return bus;
  }

  currentBus(): TBus | null {
    return this.bus;
  }

  invoke<T>(options: {
    bus?: TBus;
    message: Parameters<MessageBus["invoke"]>[0];
    timeoutMs: number;
    timeoutMessage: string;
  }): Promise<T> {
    const bus = options.bus ?? this.getBus();
    return new Promise((resolve, reject) => {
      let settled = false;
      const pending: PendingInvocation = {
        reject: (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.pendingInvocations.delete(pending);
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        const error = new Error(options.timeoutMessage);
        pending.reject(error);
        this.invalidate(error, bus);
      }, options.timeoutMs);
      timer.unref();
      this.pendingInvocations.add(pending);

      bus.invoke(options.message, (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingInvocations.delete(pending);
        if (error) {
          reject(new Error(`${error.name ?? "D-Bus error"}: ${String(error.message ?? "")}`));
          return;
        }
        resolve(value as T);
      });
    });
  }

  reset(error = new Error("D-Bus session connection was reset."), notify = false): void {
    this.invalidate(error, this.bus, notify);
  }

  dispose(): void {
    this.reset(new Error("D-Bus session connection was disposed."));
  }

  private invalidate(error: Error, bus: TBus | null, notify = true): void {
    if (!bus || this.bus !== bus) return;

    this.bus = null;
    bus.connection.removeListener("message", this.handleMessage);
    bus.connection.removeListener("error", this.handleError);
    for (const pending of [...this.pendingInvocations]) pending.reject(error);
    bus.connection.end?.();
    if (notify) this.onConnectionLost(error);
  }

  private readonly handleMessage = (message: DbusMessage): void => {
    this.onMessage(message);
  };

  private readonly handleError = (error: Error): void => {
    this.invalidate(error, this.bus);
  };
}
