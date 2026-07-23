import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ensureOwnerOnlyDirectory, ensureOwnerOnlyFile, ownerOnlyFileMode } from "./app-paths";

export type ProviderSecretKind = "stt" | "llm";
export type ProviderSecretProtectionStatus = "encrypted" | "plaintext" | "unavailable";

export interface ProviderSecretCodec {
  readonly encoding: "electron-safe-storage";
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface ProviderSecretMutation {
  secretId: string;
  value?: string;
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
  private readonly backupPath: string;
  private readonly pendingPath: string;

  constructor(
    private readonly path: string,
    private readonly codec?: ProviderSecretCodec
  ) {
    this.backupPath = `${path}.bak`;
    this.pendingPath = `${path}.provider-transaction.next`;
    ensureOwnerOnlyDirectory(dirname(this.path));
    if (existsSync(this.path)) ensureOwnerOnlyFile(this.path);
    if (existsSync(this.backupPath)) ensureOwnerOnlyFile(this.backupPath);
    if (existsSync(this.pendingPath)) ensureOwnerOnlyFile(this.pendingPath);
    if (existsSync(this.path) || existsSync(this.backupPath)) this.read();
    this.upgradePlainRecords();
  }

  set(secretId: string, value: string): string {
    this.apply([{ secretId, value }]);
    return secretId;
  }

  get(secretId: string | undefined): string | undefined {
    if (!secretId) return undefined;
    const record = this.read().records[secretId];
    if (!record) return undefined;
    return this.decode(record);
  }

  has(secretId: string | undefined): boolean {
    return Boolean(secretId && Object.prototype.hasOwnProperty.call(this.read().records, secretId));
  }

  delete(secretId: string | undefined): void {
    if (!secretId) return;
    this.apply([{ secretId }]);
  }

  apply(mutations: ProviderSecretMutation[], prune?: { kind: ProviderSecretKind; activeSecretIds: Set<string> }): void {
    const { secrets, changed } = this.applyToSnapshot(this.read(), mutations, prune);
    if (changed) this.write(secrets);
  }

  prepareApply(
    mutations: ProviderSecretMutation[],
    prune?: { kind: ProviderSecretKind; activeSecretIds: Set<string> }
  ): void {
    const { secrets } = this.applyToSnapshot(this.read(), mutations, prune);
    writeJsonAtomic(this.pendingPath, secrets);
  }

  commitPrepared(): void {
    if (!existsSync(this.pendingPath)) throw new Error("Provider credential transaction is missing its prepared secret state.");
    const secrets = this.readFile(this.pendingPath);
    this.encryptPlainRecords(secrets);
    this.write(secrets);
  }

  hasPrepared(): boolean {
    return existsSync(this.pendingPath);
  }

  discardPrepared(): void {
    removeDurable(this.pendingPath);
  }

  pruneKind(kind: ProviderSecretKind, activeSecretIds: Set<string>): void {
    this.apply([], { kind, activeSecretIds });
  }

  protectionStatus(): ProviderSecretProtectionStatus {
    if (this.codec?.isAvailable()) this.upgradePlainRecords();
    const records = Object.values(this.read().records);
    if (this.codec?.isAvailable()) return "encrypted";
    if (records.some((record) => record.encoding === "plain")) return "plaintext";
    return records.length > 0 ? "unavailable" : "plaintext";
  }

  clear(): void {
    rmSync(this.path, { force: true });
    rmSync(this.backupPath, { force: true });
    rmSync(this.pendingPath, { force: true });
  }

  private applyToSnapshot(
    secrets: ProviderSecretsFile,
    mutations: ProviderSecretMutation[],
    prune?: { kind: ProviderSecretKind; activeSecretIds: Set<string> }
  ): { secrets: ProviderSecretsFile; changed: boolean } {
    let changed = false;

    for (const mutation of mutations) {
      if (mutation.value === undefined) {
        if (!Object.prototype.hasOwnProperty.call(secrets.records, mutation.secretId)) continue;
        delete secrets.records[mutation.secretId];
        changed = true;
        continue;
      }

      secrets.records[mutation.secretId] = this.encode(mutation.value);
      changed = true;
    }

    if (prune) {
      const prefix = `provider-secret:${prune.kind}:`;
      for (const secretId of Object.keys(secrets.records)) {
        if (secretId.startsWith(prefix) && !prune.activeSecretIds.has(secretId)) {
          delete secrets.records[secretId];
          changed = true;
        }
      }
    }

    return { secrets, changed };
  }

  private upgradePlainRecords(): void {
    if (!this.codec?.isAvailable() || (!existsSync(this.path) && !existsSync(this.backupPath))) return;
    const secrets = this.read();
    if (this.encryptPlainRecords(secrets)) this.write(secrets);
  }

  private encryptPlainRecords(secrets: ProviderSecretsFile): boolean {
    if (!this.codec?.isAvailable()) return false;
    let changed = false;
    for (const [secretId, record] of Object.entries(secrets.records)) {
      if (record.encoding !== "plain") continue;
      secrets.records[secretId] = this.encode(record.value);
      changed = true;
    }
    return changed;
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
    if (!existsSync(this.path)) {
      if (!existsSync(this.backupPath)) return clone(emptySecrets);
      const recovered = this.readFile(this.backupPath);
      this.writeRecovered(recovered);
      return recovered;
    }

    try {
      return this.readFile(this.path);
    } catch (error) {
      if (!existsSync(this.backupPath)) throw error;
      const recovered = this.readFile(this.backupPath);
      const quarantinePath = `${this.path}.corrupt-${Date.now()}`;
      renameSync(this.path, quarantinePath);
      this.writeRecovered(recovered);
      return recovered;
    }
  }

  private readFile(path: string): ProviderSecretsFile {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`Provider secrets store is malformed: ${path}`);
    }
    if (!isProviderSecretsFile(data)) throw new Error(`Provider secrets store is malformed: ${path}`);
    return clone(data);
  }

  private write(secrets: ProviderSecretsFile): void {
    ensureOwnerOnlyDirectory(dirname(this.path));
    if (existsSync(this.path)) {
      const current = this.readFile(this.path);
      writeJsonAtomic(this.backupPath, current);
    }
    writeJsonAtomic(this.path, secrets);
    ensureOwnerOnlyFile(this.path);
    try {
      writeJsonAtomic(this.backupPath, secrets);
    } catch {
      // The primary write is durable; retain the older valid backup if refreshing it fails.
    }
  }

  private writeRecovered(secrets: ProviderSecretsFile): void {
    ensureOwnerOnlyDirectory(dirname(this.path));
    writeJsonAtomic(this.path, secrets);
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

function isProviderSecretsFile(value: unknown): value is ProviderSecretsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProviderSecretsFile>;
  if (candidate.version !== 1 || !candidate.records || typeof candidate.records !== "object" || Array.isArray(candidate.records)) {
    return false;
  }

  return Object.values(candidate.records).every(
    (record) =>
      Boolean(record) &&
      typeof record === "object" &&
      !Array.isArray(record) &&
      ((record as ProviderSecretRecord).encoding === "plain" || (record as ProviderSecretRecord).encoding === "electron-safe-storage") &&
      typeof (record as ProviderSecretRecord).value === "string" &&
      typeof (record as ProviderSecretRecord).updatedAt === "string"
  );
}

function writeJsonAtomic(path: string, value: ProviderSecretsFile): void {
  const dir = dirname(path);
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  let fd: number | null = null;

  try {
    ensureOwnerOnlyDirectory(dir);
    fd = openSync(tempPath, "w", ownerOnlyFileMode);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, path);
    fsyncDirectory(dir);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Preserve the original write failure.
      }
    }
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function removeDurable(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path);
  fsyncDirectory(dirname(path));
}

function fsyncDirectory(path: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Directory fsync is unavailable on some filesystems; rename atomicity is still preserved.
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
