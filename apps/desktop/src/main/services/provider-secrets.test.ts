import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSecretStore, type ProviderSecretCodec } from "./provider-secrets";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ProviderSecretStore", () => {
  it("upgrades plaintext records when secure storage becomes available", async () => {
    const path = await secretPath();
    new ProviderSecretStore(path).set("provider-secret:llm:test", "sk-plain");
    expect(readFileSync(path, "utf8")).toContain('"encoding": "plain"');

    const encryptedStore = new ProviderSecretStore(path, reversibleCodec());

    expect(encryptedStore.get("provider-secret:llm:test")).toBe("sk-plain");
    expect(encryptedStore.protectionStatus()).toBe("encrypted");
    const persisted = readFileSync(path, "utf8");
    expect(persisted).toContain('"encoding": "electron-safe-storage"');
    expect(persisted).not.toContain("sk-plain");
  });

  it("encrypts prepared plaintext if secure storage becomes available before commit", async () => {
    const path = await secretPath();
    let available = false;
    const codec = reversibleCodec(() => available);
    const store = new ProviderSecretStore(path, codec);
    store.set("provider-secret:llm:test", "sk-old");
    store.prepareApply([{ secretId: "provider-secret:llm:test", value: "sk-new" }]);

    available = true;
    store.commitPrepared();

    expect(store.get("provider-secret:llm:test")).toBe("sk-new");
    const persisted = readFileSync(path, "utf8");
    expect(persisted).toContain('"encoding": "electron-safe-storage"');
    expect(persisted).not.toContain("sk-new");
  });

  it("recovers the last durable secret store from its backup and quarantines corruption", async () => {
    const path = await secretPath();
    const store = new ProviderSecretStore(path);
    store.set("provider-secret:stt:test", "sk-current");
    writeFileSync(path, "{truncated", "utf8");

    const recovered = new ProviderSecretStore(path);

    expect(recovered.get("provider-secret:stt:test")).toBe("sk-current");
    expect(readFileSync(path, "utf8")).toContain("sk-current");
    expect(existsSync(`${path}.bak`)).toBe(true);
    expect(existsSync(`${path}.corrupt-0`)).toBe(false);
  });

  it("reports malformed stores without a valid backup instead of treating them as empty", async () => {
    const path = await secretPath();
    writeFileSync(path, "{truncated", "utf8");

    expect(() => new ProviderSecretStore(path)).toThrow(`Provider secrets store is malformed: ${path}`);
  });

  it("applies replacements, removals, and pruning in one durable write", async () => {
    const path = await secretPath();
    const store = new ProviderSecretStore(path);
    store.set("provider-secret:llm:keep", "old");
    store.set("provider-secret:llm:remove", "remove");

    store.apply(
      [
        { secretId: "provider-secret:llm:keep", value: "new" },
        { secretId: "provider-secret:llm:remove" }
      ],
      { kind: "llm", activeSecretIds: new Set(["provider-secret:llm:keep"]) }
    );

    expect(store.get("provider-secret:llm:keep")).toBe("new");
    expect(store.get("provider-secret:llm:remove")).toBeUndefined();
  });
});

async function secretPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "murmur-provider-secrets-"));
  tempDirs.push(root);
  return join(root, "secrets.json");
}

function reversibleCodec(isAvailable: () => boolean = () => true): ProviderSecretCodec {
  return {
    encoding: "electron-safe-storage",
    isAvailable,
    encrypt: (value) => Buffer.from(`encrypted:${value}`).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^encrypted:/, "")
  };
}
