import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultModes, defaultSettings } from "../../shared/defaults";
import type { DictationHistoryItem } from "../../shared/types";
import { resolveAppPaths, type AppPaths } from "./app-paths";
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
  });

  it("seeds former presets as built-in modes during migration", () => {
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

    expect(state.modes.map((mode) => mode.id)).toEqual(defaultModes.map((mode) => mode.id));
    expect(state.modes.find((mode) => mode.id === "message")).toMatchObject({
      kind: "built_in",
      iconKey: "message-square",
      name: "Message"
    });
    expect(state.settings.activeModeId).toBe("message");
  });

  it("resets built-in modes to their built-in defaults", () => {
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
    const defaultDefaultMode = defaultModes.find((mode) => mode.id === "default");
    const defaultMessageMode = defaultModes.find((mode) => mode.id === "message");

    expect(defaultMode).toEqual(defaultDefaultMode);
    expect(messageMode).toEqual(defaultMessageMode);
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
            instructionPrompt: "Keep this casual.",
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
      kind: "custom",
      iconKey: "message-square",
      name: "Team chat",
      instructionPrompt: "Keep this casual.",
      context: { app: true, selectedText: true, clipboardText: false }
    });
    expect(customMode).not.toHaveProperty("presetId");
  });

  it("preserves disabled selected-text capture while normalizing paste automation", () => {
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

    expect(settings.pasteMethod).toBe("clipboard_restore");
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

  it("removes retained audio when deleting or clearing history", () => {
    const paths = testPaths();
    const storage = jsonStorage(paths);
    const firstAudio = join(paths.audioDir, "first.wav");
    const secondAudio = join(paths.audioDir, "second.wav");
    writeFileSync(firstAudio, "first");
    writeFileSync(secondAudio, "second");
    storage.addHistory(historyItem({ id: "first", audioPath: firstAudio, createdAt: "2026-01-02T00:00:00.000Z" }));
    storage.addHistory(historyItem({ id: "second", audioPath: secondAudio, createdAt: "2026-01-01T00:00:00.000Z" }));

    storage.deleteHistory("first");
    storage.clearHistory();

    expect(existsSync(firstAudio)).toBe(false);
    expect(existsSync(secondAudio)).toBe(false);
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
});

function jsonStorage(paths: AppPaths): StorageService {
  return new StorageService(paths, () => {
    throw new Error("sqlite disabled for test");
  });
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
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch
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
