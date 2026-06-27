import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureOwnerOnlyDirectory, ensureOwnerOnlyFile, ownerOnlyFileMode } from "./app-paths";

export type ProviderSecretKind = "stt" | "llm";

export interface ProviderSecretCodec {
  readonly encoding: "electron-safe-storage";
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface ProviderSecretRecord {
  encoding: "plain" | "electron-safe-storage";
  value: string;
  updatedAt: string;
}

interface ProviderSecretsFile {
  version: 1;
  records: Record<string, ProviderSecretRecord>;
}

const emptySecrets: ProviderSecretsFile = {
  version: 1,
  records: {}
};

export class ProviderSecretStore {
  constructor(
    private readonly path: string,
    private readonly codec?: ProviderSecretCodec
  ) {
    ensureOwnerOnlyDirectory(dirname(this.path));
    if (existsSync(this.path)) ensureOwnerOnlyFile(this.path);
  }

  set(secretId: string, value: string): string {
    const secrets = this.read();
    const record = this.encode(value);
    secrets.records[secretId] = record;
    this.write(secrets);
    return secretId;
  }

  get(secretId: string | undefined): string | undefined {
    if (!secretId) return undefined;
    const record = this.read().records[secretId];
    if (!record) return undefined;
    return this.decode(record);
  }

  delete(secretId: string | undefined): void {
    if (!secretId) return;
    const secrets = this.read();
    if (!Object.prototype.hasOwnProperty.call(secrets.records, secretId)) return;
    delete secrets.records[secretId];
    this.write(secrets);
  }

  pruneKind(kind: ProviderSecretKind, activeSecretIds: Set<string>): void {
    const secrets = this.read();
    let changed = false;
    const prefix = `provider-secret:${kind}:`;

    for (const secretId of Object.keys(secrets.records)) {
      if (secretId.startsWith(prefix) && !activeSecretIds.has(secretId)) {
        delete secrets.records[secretId];
        changed = true;
      }
    }

    if (changed) this.write(secrets);
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }

  private encode(value: string): ProviderSecretRecord {
    if (this.codec?.isAvailable()) {
      return {
        encoding: this.codec.encoding,
        value: this.codec.encrypt(value),
        updatedAt: new Date().toISOString()
      };
    }

    return {
      encoding: "plain",
      value,
      updatedAt: new Date().toISOString()
    };
  }

  private decode(record: ProviderSecretRecord): string | undefined {
    if (record.encoding === "plain") return record.value;
    if (!this.codec?.isAvailable()) return undefined;

    try {
      return this.codec.decrypt(record.value);
    } catch {
      return undefined;
    }
  }

  private read(): ProviderSecretsFile {
    if (!existsSync(this.path)) return clone(emptySecrets);

    try {
      const data = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ProviderSecretsFile>;
      if (data.version !== 1 || !data.records || typeof data.records !== "object") return clone(emptySecrets);
      return {
        version: 1,
        records: data.records
      };
    } catch {
      return clone(emptySecrets);
    }
  }

  private write(secrets: ProviderSecretsFile): void {
    ensureOwnerOnlyDirectory(dirname(this.path));
    writeFileSync(this.path, JSON.stringify(secrets, null, 2), { mode: ownerOnlyFileMode });
    ensureOwnerOnlyFile(this.path);
  }
}

export function createSafeStorageProviderSecretCodec(safeStorage: ElectronSafeStorageLike | undefined): ProviderSecretCodec | undefined {
  if (!safeStorage) return undefined;

  return {
    encoding: "electron-safe-storage",
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
  };
}

export function secretIdForProvider(kind: ProviderSecretKind, providerId: string): string {
  const digest = createHash("sha256").update(`${kind}:${providerId}`).digest("hex").slice(0, 32);
  return `provider-secret:${kind}:${digest}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
