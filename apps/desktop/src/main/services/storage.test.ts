import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLlmProviders, defaultModes, defaultSettings } from "../../shared/defaults";
import type { DictationHistoryItem, ModelCatalogItem } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
import { ProviderSecretStore, secretIdForProvider, type ProviderSecretCodec } from "./provider-secrets";
import { StorageService } from "./storage";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("StorageService", () => {
  it("writes config state to the config dir", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.updateSettings({ theme: "light" });

    const config = JSON.parse(readFileSync(paths.configPath, "utf8")) as Record<string, unknown>;
    expect(config.settings).toMatchObject({ theme: "light" });
    expect(config.history).toBeUndefined();
    expect(existsSync(join(paths.dataDir, "murmur-config.json"))).toBe(false);
  });

  it("migrates legacy activation shortcuts to a single activation hotkey", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark",
          toggleHotkey: "CommandOrControl+Shift+Y",
          pushToTalkHotkey: "CommandOrControl+Shift+U",
          cancelHotkey: "CommandOrControl+Shift+X"
        }
      })
    );
    const storage = jsonStorage(paths);

    const settings = storage.getState().settings as typeof defaultSettings & {
      toggleHotkey?: string;
      pushToTalkHotkey?: string;
      cancelHotkey?: string;
    };

    expect(settings.activationMode).toBe("toggle");
    expect(settings.activationHotkey).toBe("CommandOrControl+Shift+Y");
    expect(settings.toggleHotkey).toBeUndefined();
    expect(settings.pushToTalkHotkey).toBeUndefined();
    expect(settings.cancelHotkey).toBeUndefined();
  });

  it("adds the default mode selector hotkey to old configs", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark",
          activationHotkey: "Alt+R"
        }
      })
    );
    const storage = jsonStorage(paths);

    expect(storage.getState().settings.modeSelectorHotkey).toBe("Alt+Shift+K");
  });

  it("persists user-edited mode selector hotkeys", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.updateSettings({ modeSelectorHotkey: "Alt+Shift+M" });
    const reopened = jsonStorage(paths);

    expect(reopened.getState().settings.modeSelectorHotkey).toBe("Alt+Shift+M");
  });

  it("migrates legacy clipboard_restore selected-text capture to enabled", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark",
          selectedTextCapture: "clipboard_restore"
        }
      })
    );

    expect(jsonStorage(paths).getState().settings.selectedTextCapture).toBe("enabled");
  });

  it("drops legacy domain-only auto-mode rules during normalization", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark"
        },
        autoModeRules: [
          {
            id: "domain-only",
            name: "Domain only",
            modeId: "mail",
            enabled: true,
            priority: 5,
            match: { domainWildcard: "*.example.test" }
          },
          {
            id: "mixed",
            name: "Mixed",
            modeId: "message",
            enabled: true,
            priority: 10,
            match: { domain: "chat.example.test", appName: "Chat" }
          }
        ]
      })
    );

    expect(jsonStorage(paths).getState().autoModeRules).toEqual([
      expect.objectContaining({
        id: "mixed",
        match: { appName: "Chat" }
      })
    ]);
  });

  it("drops obsolete STT setup settings during migration", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark",
          obsoleteSetting: true
        }
      })
    );

    const storage = jsonStorage(paths);
    const settings = storage.getState().settings as typeof defaultSettings & {
      obsoleteSetting?: unknown;
    };

    expect(settings.obsoleteSetting).toBeUndefined();
    expect(settings.sttSetupSkippedAt).toBeUndefined();
    expect(settings.sttSetupCompletedAt).toBeUndefined();
    expect(settings.onboardingSkippedAt).toBeUndefined();
    expect(settings.onboardingCompletedAt).toBeUndefined();
    expect(settings.accelerationRuntimeInstallPromptDismissedAt).toBeUndefined();
  });

  it("preserves onboarding completion timestamps", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.updateSettings({
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      onboardingSkippedAt: "2026-01-02T00:00:00.000Z"
    });

    expect(storage.getState().settings).toMatchObject({
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      onboardingSkippedAt: "2026-01-02T00:00:00.000Z"
    });
  });

  it("drops removed LLM providers during migration", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: [
          ...defaultLlmProviders,
          {
            id: "openrouter",
            type: "openrouter",
            name: "OpenRouter",
            baseUrl: "https://openrouter.ai/api/v1",
            isCloud: true,
            enabled: true
          },
          {
            id: "groq",
            type: "custom_openai_compatible",
            name: "Groq",
            baseUrl: "https://api.groq.com/openai/v1",
            isCloud: true,
            enabled: true
          },
          {
            id: "custom-llm",
            type: "custom_openai_compatible",
            name: "Custom LLM",
            baseUrl: "https://example.test/v1",
            isCloud: true,
            enabled: false
          }
        ]
      })
    );

    const storage = jsonStorage(paths);
    const providers = storage.getState().llmProviders;

    expect(providers.some((provider) => provider.id === "openrouter" || provider.id === "groq")).toBe(false);
    expect(providers.find((provider) => provider.id === "custom-llm")).toMatchObject({
      type: "custom_openai_compatible",
      baseUrl: "https://example.test/v1"
    });
  });

  it("enables an untouched legacy LM Studio provider during migration", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: defaultLlmProviders.map((provider) =>
          provider.id === "lmstudio" ? { ...provider, enabled: false } : provider
        )
      })
    );

    const storage = jsonStorage(paths);

    expect(storage.getState().llmProviders.find((provider) => provider.id === "lmstudio")?.enabled).toBe(true);
  });

  it("canonicalizes Codex providers without persisting credential fields", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: [
          {
            id: "legacy-codex",
            type: "codex",
            name: "OpenAI Codex",
            baseUrl: "https://example.test/v1",
            apiKey: "must-not-persist",
            apiKeySecretId: "legacy-secret",
            isCloud: false,
            defaultModel: "another-model",
            models: ["another-model"],
            enabled: false
          }
        ]
      })
    );

    const storage = jsonStorage(paths);
    const codexProviders = storage.getState().llmProviders.filter((provider) => provider.type === "codex");
    const configText = readFileSync(paths.configPath, "utf8");

    expect(codexProviders).toEqual([
      {
        id: "codex",
        type: "codex",
        name: "Codex",
        isCloud: true,
        defaultModel: "gpt-5.6-luna",
        enabled: true
      }
    ]);
    expect(configText).not.toContain("must-not-persist");
    expect(configText).not.toContain("legacy-secret");
    expect(configText).not.toContain("https://example.test/v1");
    expect(configText).not.toContain("another-model");
  });

  it("deletes explicit and derived secret records for legacy Codex provider ids", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    const secrets = new ProviderSecretStore(paths.providerSecretsPath);
    const derivedSecretId = secretIdForProvider("llm", "legacy-codex");
    const unrelatedSecretId = secretIdForProvider("llm", "custom-llm");
    secrets.set("legacy-secret", "sk-explicit");
    secrets.set(derivedSecretId, "sk-derived");
    secrets.set(unrelatedSecretId, "sk-unrelated");
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: [
          {
            id: "legacy-codex",
            type: "codex",
            name: "OpenAI Codex",
            apiKeySecretId: "legacy-secret"
          }
        ]
      })
    );

    jsonStorage(paths);

    expect(secrets.get("legacy-secret")).toBeUndefined();
    expect(secrets.get(derivedSecretId)).toBeUndefined();
    expect(secrets.get(unrelatedSecretId)).toBe("sk-unrelated");
  });

  it("stores provider API keys outside config snapshots", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-secret" } : provider
      )
    );

    const provider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    const configText = readFileSync(paths.configPath, "utf8");

    expect(provider?.apiKey).toBeUndefined();
    expect(provider?.apiKeySecretId).toBeTruthy();
    expect(configText).not.toContain("sk-secret");
    expect(provider ? storage.resolveLlmProviderSecret(provider).apiKey : undefined).toBe("sk-secret");
  });

  it("replaces stored provider API keys without dropping the existing secret reference", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-first" } : provider
      )
    );
    const firstProvider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    if (!firstProvider) throw new Error("Missing OpenAI LLM provider.");

    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, apiKey: "sk-second" } : provider
      )
    );
    const secondProvider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");

    expect(secondProvider?.apiKeySecretId).toBe(firstProvider.apiKeySecretId);
    expect(secondProvider ? storage.resolveLlmProviderSecret(secondProvider).apiKey : undefined).toBe("sk-second");
  });

  it("requires explicit stored-credential intent when a provider connection changes", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    storage.setLlmProviders([
      ...storage.getState().llmProviders,
      {
        id: "custom-llm",
        type: "custom_openai_compatible",
        name: "Custom LLM",
        baseUrl: "https://old.example.test/v1",
        apiKey: "sk-custom",
        apiKeyIntent: "replace",
        isCloud: true,
        models: ["model-a"],
        enabled: true
      }
    ]);
    const before = storage.getState().llmProviders.find((provider) => provider.id === "custom-llm");
    if (!before) throw new Error("Missing custom LLM provider.");

    expect(() =>
      storage.setLlmProviders(
        storage.getState().llmProviders.map((provider) =>
          provider.id === "custom-llm" ? { ...provider, baseUrl: "https://new.example.test/v1" } : provider
        )
      )
    ).toThrow("must explicitly keep, replace, or remove");

    const after = storage.getState().llmProviders.find((provider) => provider.id === "custom-llm");
    expect(after?.baseUrl).toBe("https://old.example.test/v1");
    expect(after ? storage.resolveLlmProviderSecret(after).apiKey : undefined).toBe("sk-custom");
  });

  it("leaves stored credentials unchanged when provider config persistence fails", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-first", apiKeyIntent: "replace" } : provider
      )
    );
    const provider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    if (!provider?.apiKeySecretId) throw new Error("Missing OpenAI credential reference.");

    const now = 246813579;
    const tempPath = join(paths.configDir, `.murmur-config.json.provider-transaction.next.${process.pid}.${now}.tmp`);
    mkdirSync(tempPath);
    vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      expect(() =>
        storage.setLlmProviders(
          storage.getState().llmProviders.map((candidate) =>
            candidate.id === "openai-llm"
              ? { ...candidate, apiKey: "sk-second", apiKeyIntent: "replace" }
              : candidate
          )
        )
      ).toThrow();
    } finally {
      vi.restoreAllMocks();
      rmSync(tempPath, { recursive: true, force: true });
    }

    expect(new ProviderSecretStore(paths.providerSecretsPath).get(provider.apiKeySecretId)).toBe("sk-first");
    expect(jsonStorage(paths).resolveLlmProviderSecret(provider).apiKey).toBe("sk-first");
  });

  it("recovers a credential replacement interrupted after the provider config commit", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-first", apiKeyIntent: "replace" } : provider
      )
    );
    const provider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    if (!provider?.apiKeySecretId) throw new Error("Missing OpenAI credential reference.");

    const now = 112233445;
    const secretTempPath = join(paths.configDir, `.murmur-provider-secrets.json.${process.pid}.${now}.tmp`);
    mkdirSync(secretTempPath);
    vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      expect(() =>
        storage.setLlmProviders(
          storage.getState().llmProviders.map((candidate) =>
            candidate.id === "openai-llm"
              ? { ...candidate, apiKey: "sk-second", apiKeyIntent: "replace" }
              : candidate
          )
        )
      ).toThrow("Provider configuration transaction is pending recovery");
    } finally {
      vi.restoreAllMocks();
    }

    expect(existsSync(`${paths.configPath}.provider-transaction`)).toBe(true);
    expect(modeOf(`${paths.configPath}.provider-transaction`)).toBe(0o600);
    expect(modeOf(`${paths.configPath}.provider-transaction.next`)).toBe(0o600);
    expect(modeOf(`${paths.providerSecretsPath}.provider-transaction.next`)).toBe(0o600);
    expect(new ProviderSecretStore(paths.providerSecretsPath).get(provider.apiKeySecretId)).toBe("sk-first");
    rmSync(secretTempPath, { recursive: true, force: true });

    const recovered = jsonStorage(paths);
    const recoveredProvider = recovered.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    expect(recoveredProvider ? recovered.resolveLlmProviderSecret(recoveredProvider).apiKey : undefined).toBe("sk-second");
    expect(existsSync(`${paths.configPath}.provider-transaction`)).toBe(false);
    expect(existsSync(`${paths.configPath}.provider-transaction.next`)).toBe(false);
    expect(existsSync(`${paths.providerSecretsPath}.provider-transaction.next`)).toBe(false);
  });

  it("recovers a credential removal interrupted after the provider config commit", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-remove", apiKeyIntent: "replace" } : provider
      )
    );
    const provider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    if (!provider?.apiKeySecretId) throw new Error("Missing OpenAI credential reference.");

    const now = 556677889;
    const secretTempPath = join(paths.configDir, `.murmur-provider-secrets.json.${process.pid}.${now}.tmp`);
    mkdirSync(secretTempPath);
    vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      expect(() =>
        storage.setLlmProviders(
          storage.getState().llmProviders.map((candidate) =>
            candidate.id === "openai-llm" ? { ...candidate, apiKeyIntent: "remove" } : candidate
          )
        )
      ).toThrow("Provider configuration transaction is pending recovery");
    } finally {
      vi.restoreAllMocks();
    }

    expect(existsSync(`${paths.configPath}.provider-transaction`)).toBe(true);
    expect(new ProviderSecretStore(paths.providerSecretsPath).get(provider.apiKeySecretId)).toBe("sk-remove");
    rmSync(secretTempPath, { recursive: true, force: true });

    const recovered = jsonStorage(paths);
    const recoveredProvider = recovered.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    expect(recoveredProvider?.apiKeySecretId).toBeUndefined();
    expect(new ProviderSecretStore(paths.providerSecretsPath).get(provider.apiKeySecretId)).toBeUndefined();
    expect(existsSync(`${paths.configPath}.provider-transaction`)).toBe(false);
    expect(existsSync(`${paths.configPath}.provider-transaction.next`)).toBe(false);
    expect(existsSync(`${paths.providerSecretsPath}.provider-transaction.next`)).toBe(false);
  });

  it("derives stored-credential readiness from the authoritative secret store", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: defaultLlmProviders.map((provider) =>
          provider.id === "openai-llm"
            ? { ...provider, enabled: true, apiKeySecretId: secretIdForProvider("llm", provider.id) }
            : provider
        )
      })
    );

    const provider = jsonStorage(paths).getState().llmProviders.find((candidate) => candidate.id === "openai-llm");

    expect(provider).toMatchObject({ enabled: true, hasStoredSecret: false });
  });

  it("preserves encrypted credential references while secure storage is temporarily unavailable", () => {
    const paths = testPaths();
    let encryptionAvailable = true;
    const codec: ProviderSecretCodec = {
      encoding: "electron-safe-storage",
      isAvailable: () => encryptionAvailable,
      encrypt: (value) => Buffer.from(`encrypted:${value}`).toString("base64"),
      decrypt: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^encrypted:/, "")
    };
    const storage = jsonStorage(paths, codec);
    storage.setLlmProviders(
      storage.getState().llmProviders.map((provider) =>
        provider.id === "openai-llm"
          ? { ...provider, enabled: true, apiKey: "sk-encrypted", apiKeyIntent: "replace" }
          : provider
      )
    );
    const secretId = storage.getState().llmProviders.find((provider) => provider.id === "openai-llm")?.apiKeySecretId;
    if (!secretId) throw new Error("Missing encrypted secret reference.");

    encryptionAvailable = false;
    const unavailableStorage = jsonStorage(paths, codec);
    const unavailableProvider = unavailableStorage.getState().llmProviders.find((provider) => provider.id === "openai-llm");
    expect(unavailableProvider).toMatchObject({
      apiKeySecretId: secretId,
      hasStoredSecret: false,
      hasSecretRecord: true
    });

    unavailableStorage.setLlmProviders(
      unavailableStorage.getState().llmProviders.map((provider) =>
        provider.id === "ollama" ? { ...provider, name: "Local Ollama" } : provider
      )
    );
    expect(unavailableStorage.getState().llmProviders.find((provider) => provider.id === "openai-llm")?.apiKeySecretId).toBe(secretId);

    encryptionAvailable = true;
    const recoveredStorage = jsonStorage(paths, codec);
    const recoveredProvider = recoveredStorage.getState().llmProviders.find((provider) => provider.id === "openai-llm");
    expect(recoveredProvider).toMatchObject({ apiKeySecretId: secretId, hasStoredSecret: true, hasSecretRecord: true });
    expect(recoveredProvider ? recoveredStorage.resolveLlmProviderSecret(recoveredProvider).apiKey : undefined).toBe("sk-encrypted");
  });

  it("restores the legacy config when provider secret migration fails", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: defaultLlmProviders.map((provider) =>
          provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-legacy" } : provider
        )
      })
    );
    const now = 975318642;
    const secretTempPath = join(
      paths.configDir,
      `.murmur-provider-secrets.json.provider-transaction.next.${process.pid}.${now}.tmp`
    );
    mkdirSync(secretTempPath);
    vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      expect(() => jsonStorage(paths)).toThrow();
    } finally {
      vi.restoreAllMocks();
      rmSync(secretTempPath, { recursive: true, force: true });
    }

    expect(readFileSync(paths.configPath, "utf8")).toContain("sk-legacy");
  });

  it("migrates legacy plaintext provider API keys out of the config file", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        llmProviders: defaultLlmProviders.map((provider) =>
          provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-legacy" } : provider
        )
      })
    );

    const storage = jsonStorage(paths);
    const provider = storage.getState().llmProviders.find((candidate) => candidate.id === "openai-llm");
    const configText = readFileSync(paths.configPath, "utf8");

    expect(provider?.apiKey).toBeUndefined();
    expect(provider?.apiKeySecretId).toBeTruthy();
    expect(configText).not.toContain("sk-legacy");
    expect(provider ? storage.resolveLlmProviderSecret(provider).apiKey : undefined).toBe("sk-legacy");
  });

  it("writes sensitive files with owner-only permissions under a permissive umask", () => {
    const previousUmask = process.umask(0);
    try {
      const paths = testPaths();
      const storage = jsonStorage(paths);

      storage.setLlmProviders(
        storage.getState().llmProviders.map((provider) =>
          provider.id === "openai-llm" ? { ...provider, enabled: true, apiKey: "sk-mode" } : provider
        )
      );
      storage.addHistory(historyItem({ id: "permissions" }));

      expect(modeOf(paths.configDir)).toBe(0o700);
      expect(modeOf(paths.dataDir)).toBe(0o700);
      expect(modeOf(paths.audioDir)).toBe(0o700);
      expect(modeOf(paths.configPath)).toBe(0o600);
      expect(modeOf(paths.providerSecretsPath)).toBe(0o600);
      expect(modeOf(paths.historyJsonPath)).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("does not restore removed built-in modes during migration", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "message",
          theme: "dark"
        },
        modes: [
          {
            id: "default",
            kind: "default",
            presetId: "custom",
            name: "Default",
            aiEnabled: true,
            instructionPrompt: "Default instruction",
            examples: [],
            language: "auto",
            context: { app: true, selectedText: true, clipboardText: true }
          }
        ]
      })
    );

    const storage = jsonStorage(paths);
    const state = storage.getState();

    expect(state.modes.map((mode) => mode.id)).toEqual(["default"]);
    expect(state.modes[0]).not.toHaveProperty("kind");
    expect(state.settings.activeModeId).toBe("default");
  });

  it("preserves edits to former built-in modes", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        modes: [
          {
            id: "default",
            kind: "default",
            iconKey: "sliders-horizontal",
            name: "Default",
            aiEnabled: true,
            instructionPrompt: "Default instruction",
            examples: [],
            language: "auto",
            context: { app: true, selectedText: true, clipboardText: true }
          },
          {
            id: "message",
            kind: "built_in",
            iconKey: "mail",
            name: "Edited message",
            aiEnabled: false,
            instructionPrompt: "Edited instruction",
            examples: [{ input: "one", output: "two" }],
            language: "en",
            context: { app: false, selectedText: false, clipboardText: true }
          }
        ]
      })
    );

    const storage = jsonStorage(paths);
    const defaultMode = storage.getState().modes.find((mode) => mode.id === "default");
    const messageMode = storage.getState().modes.find((mode) => mode.id === "message");
    expect(defaultMode).toMatchObject({ id: "default", instructionPrompt: "Default instruction" });
    expect(messageMode).toMatchObject({
      id: "message",
      iconKey: "mail",
      name: "Edited message",
      aiEnabled: false,
      instructionPrompt: "Edited instruction",
      examples: [{ input: "one", output: "two" }],
      language: "en",
      context: { app: false, selectedText: false, clipboardText: true }
    });
    expect(messageMode).not.toHaveProperty("kind");
  });

  it("converts custom modes from preset ids to icon keys", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        modes: [
          {
            id: "default",
            kind: "default",
            presetId: "custom",
            name: "Default",
            aiEnabled: true,
            instructionPrompt: "Default instruction",
            examples: [],
            language: "auto",
            context: { app: true, selectedText: true, clipboardText: true }
          },
          {
            id: "mode-chat",
            kind: "custom",
            presetId: "message",
            name: "Team chat",
            aiEnabled: true,
            writingStyle: "Keep this casual.",
            instructionPrompt: "Hidden message preset instruction.",
            examples: [],
            language: "auto",
            context: { app: true, selectedText: true, clipboardText: false }
          }
        ]
      })
    );

    const storage = jsonStorage(paths);
    const customMode = storage.getState().modes.find((mode) => mode.id === "mode-chat");

    expect(customMode).toMatchObject({
      iconKey: "message-square",
      name: "Team chat",
      writingStyle: "",
      instructionPrompt: "Keep this casual.",
      context: { app: true, selectedText: true, clipboardText: false }
    });
    expect(customMode).not.toHaveProperty("kind");
    expect(customMode).not.toHaveProperty("presetId");
  });

  it("preserves disabled selected-text capture while dropping legacy paste automation", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark",
          pasteMethod: "clipboard_only",
          selectedTextCapture: "disabled"
        }
      })
    );

    const storage = jsonStorage(paths);
    const settings = storage.getState().settings;

    expect(settings).not.toHaveProperty("pasteMethod");
    expect(settings.selectedTextCapture).toBe("disabled");
  });

  it("normalizes configs without a tray close notice timestamp", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        settings: {
          activeModeId: "default",
          theme: "dark"
        }
      })
    );

    const storage = jsonStorage(paths);

    expect(storage.getState().settings.trayCloseNoticeShownAt).toBeUndefined();
  });

  it("persists the tray close notice timestamp", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const trayCloseNoticeShownAt = "2026-06-15T12:00:00.000Z";

    storage.updateSettings({ trayCloseNoticeShownAt });
    const reopened = jsonStorage(paths);

    expect(reopened.getState().settings.trayCloseNoticeShownAt).toBe(trayCloseNoticeShownAt);
  });

  it("persists the acceleration runtime install prompt dismissal timestamp", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const accelerationRuntimeInstallPromptDismissedAt = "2026-06-29T00:00:00.000Z";

    storage.updateSettings({ accelerationRuntimeInstallPromptDismissedAt });
    const reopened = jsonStorage(paths);

    expect(reopened.getState().settings.accelerationRuntimeInstallPromptDismissedAt).toBe(accelerationRuntimeInstallPromptDismissedAt);
  });

  it("writes history state to the data dir", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.addHistory(historyItem({ id: "dictation-data-dir" }));

    const history = JSON.parse(readFileSync(paths.historyJsonPath, "utf8")) as DictationHistoryItem[];
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("dictation-data-dir");
    expect(existsSync(join(paths.configDir, "murmur-history.json"))).toBe(false);
  });

  it("uses JSON history storage when SQLite is unavailable", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);

    storage.addHistory(historyItem({ id: "dictation-json-fallback" }));
    const reopened = jsonStorage(paths);

    expect(storage.backend).toBe("json");
    expect(reopened.getState().history.map((item) => item.id)).toEqual(["dictation-json-fallback"]);
  });

  it("reports sanitized storage diagnostics", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const diagnostics = storage.getDiagnostics();
    const diagnosticText = diagnostics.join(" ");

    expect(diagnostics).toEqual(["History storage is using JSON fallback because SQLite is unavailable."]);
    expect(diagnosticText).not.toContain(paths.configDir);
    expect(diagnosticText).not.toContain(paths.dataDir);
    expect(diagnosticText).not.toContain(paths.cacheDir);
    expect(diagnosticText).not.toContain(paths.tempDir);
    expect(diagnosticText).not.toContain("sqlite disabled for test");
  });

  it("filters the old initial release note while preserving other release notes", () => {
    const paths = testPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        releaseNotes: [
          {
            id: "initial-prototype",
            date: "2026-06-12",
            heading: "Removed note",
            summary: "Removed."
          },
          {
            id: "future-update",
            date: "2026-07-01",
            heading: "Future update",
            summary: "Preserved."
          }
        ]
      })
    );

    const storage = jsonStorage(paths);

    expect(storage.getState().releaseNotes).toEqual([
      {
        id: "future-update",
        date: "2026-07-01",
        heading: "Future update",
        summary: "Preserved."
      }
    ]);
  });

  it("removes linked audio when deleting or clearing history", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const firstAudio = join(paths.audioDir, "first.wav");
    const secondAudio = join(paths.audioDir, "second.wav");
    writeFileSync(firstAudio, "first");
    writeFileSync(secondAudio, "second");
    storage.addHistory(historyItem({ id: "first", audioPath: firstAudio, createdAt: recentIso(1) }));
    storage.addHistory(historyItem({ id: "second", audioPath: secondAudio, createdAt: recentIso(2) }));

    storage.deleteHistory("first");
    storage.clearHistory();

    expect(existsSync(firstAudio)).toBe(false);
    expect(existsSync(secondAudio)).toBe(false);
  });

  it("prunes history beyond text retention days and removes linked audio", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const oldAudio = join(paths.audioDir, "old.wav");
    const recentAudio = join(paths.audioDir, "recent.wav");
    writeFileSync(oldAudio, "old");
    writeFileSync(recentAudio, "recent");

    storage.updateSettings({ textRetentionDays: 1 });
    storage.addHistory(historyItem({ id: "old", audioPath: oldAudio, createdAt: recentIso(3) }));
    const state = storage.addHistory(historyItem({ id: "recent", audioPath: recentAudio, createdAt: recentIso(0) }));

    expect(state.history.map((item) => item.id)).toEqual(["recent"]);
    expect(existsSync(oldAudio)).toBe(false);
    expect(existsSync(recentAudio)).toBe(true);

    const reopened = jsonStorage(paths);
    expect(reopened.getState().history.map((item) => item.id)).toEqual(["recent"]);
  });

  it("treats zero text retention days as no retained history", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const audioPath = join(paths.audioDir, "zero.wav");
    writeFileSync(audioPath, "audio");

    storage.updateSettings({ textRetentionDays: 0 });
    const state = storage.addHistory(historyItem({ audioPath }));

    expect(state.history).toEqual([]);
    expect(existsSync(audioPath)).toBe(false);
    expect(jsonStorage(paths).getState().history).toEqual([]);
  });

  it("keeps the previous config intact when an atomic JSON write fails", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    storage.updateSettings({ theme: "light" });
    const now = 1234567890;
    const tempPath = join(paths.configDir, `.murmur-config.json.${process.pid}.${now}.tmp`);
    mkdirSync(tempPath);
    vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      expect(() => storage.updateSettings({ theme: "dark" })).toThrow();
    } finally {
      vi.restoreAllMocks();
      rmSync(tempPath, { recursive: true, force: true });
    }

    const config = JSON.parse(readFileSync(paths.configPath, "utf8")) as { settings: { theme: string } };
    expect(config.settings.theme).toBe("light");
  });

  it("clears local config, history, and audio while leaving model cache intact", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const audioPath = join(paths.audioDir, "retained.wav");
    const modelPath = join(paths.modelDir, "ggml-test.bin");
    writeFileSync(audioPath, "audio");
    writeFileSync(modelPath, "model");
    storage.updateSettings({ theme: "light" });
    storage.addHistory(historyItem({ audioPath }));

    const state = storage.clearLocalData();

    expect(state.settings.theme).toBe(defaultSettings.theme);
    expect(state.history).toEqual([]);
    expect(existsSync(audioPath)).toBe(false);
    expect(existsSync(modelPath)).toBe(true);
  });

  it("preserves discovered local model catalog entries, favorites, and active ids", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const discovered = discoveredModel("lmstudio:test-model");

    storage.setModelLibrary({
      catalog: [discovered],
      downloads: [
        {
          modelId: discovered.id,
          status: "not_downloaded",
          progressBytes: 0,
          favorite: true
        }
      ],
      activeModelIds: { language: discovered.id }
    });

    const modelLibrary = storage.getState().modelLibrary;

    expect(modelLibrary.catalog.find((item) => item.id === discovered.id)).toMatchObject({
      provider: "lmstudio",
      discovery: { providerId: "lmstudio", reachable: true }
    });
    expect(modelLibrary.downloads.find((download) => download.modelId === discovered.id)?.favorite).toBe(true);
    expect(modelLibrary.activeModelIds.language).toBe(discovered.id);
  });
});

function jsonStorage(paths: AppPaths, providerSecretCodec?: ProviderSecretCodec): StorageService {
  return new StorageService(
    paths,
    () => {
      throw new Error("sqlite disabled for test");
    },
    providerSecretCodec
  );
}

function historyItem(patch: Partial<DictationHistoryItem> = {}): DictationHistoryItem {
  return {
    id: "dictation-test",
    audioPath: null,
    rawTranscript: "raw",
    processedOutput: "processed",
    modeId: "default",
    modeName: "Default",
    transcriptionProviderCloud: false,
    transcriptionStreamingMode: "none",
    llmProviderCloud: false,
    createdAt: new Date().toISOString(),
    ...patch
  };
}

function recentIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function discoveredModel(id: string): ModelCatalogItem {
  return {
    id,
    name: "test-model",
    kind: "language",
    provider: "lmstudio",
    description: "Discovered test model.",
    isCloud: false,
    isOffline: true,
    downloadStrategy: "none",
    discovery: {
      origin: "discovered",
      providerId: "lmstudio",
      lastSeenAt: "2026-06-26T00:00:00.000Z",
      reachable: true,
      message: "Available from LM Studio."
    },
    defaultProviderConfig: {
      llmProviderType: "lmstudio",
      model: "test-model"
    }
  };
}

function testPaths(): AppPaths {
  const root = tempRoot();
  return resolveAppPaths(fakeApp(root), {
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache")
  });
}

function fakeApp(root: string) {
  return {
    getPath(name: "home" | "temp"): string {
      return name === "home" ? join(root, "home") : join(root, "tmp");
    }
  };
}

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
  tempDirs.push(dir);
  return dir;
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}
