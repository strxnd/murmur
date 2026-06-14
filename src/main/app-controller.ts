import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppSettings,
  AppStateSnapshot,
  CapabilityReport,
  ContextSnapshot,
  DictationHistoryItem,
  DictationSession,
  LlmProviderConfig,
  ModeConfig,
  ReplacementRule,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../shared/types";
import { defaultSession } from "../shared/defaults";
import { buildProcessingPrompt, buildVocabularyPrompt } from "../shared/prompts";
import { applyReplacements } from "../shared/replacements";
import { resolveModeByContext } from "./services/auto-mode";
import { createId } from "./services/ids";
import { ContextService } from "./services/context";
import { LlmService } from "./services/llm";
import { ModelLibraryService } from "./services/model-library";
import { PasteService } from "./services/paste";
import { SoundService } from "./services/sound";
import { StorageService } from "./services/storage";
import { TranscriptionService } from "./services/stt";
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme } from "./electron-api";

export class AppController {
  private mainWindow: ElectronBrowserWindow | null = null;
  private pillWindow: ElectronBrowserWindow | null = null;
  private storage: StorageService;
  private context = new ContextService();
  private paste = new PasteService();
  private sound = new SoundService();
  private stt: TranscriptionService;
  private llm = new LlmService();
  private modelLibrary: ModelLibraryService;
  private session: DictationSession = defaultSession;
  private sessionContext: ContextSnapshot | null = null;
  private recordingStoppedAt: string | null = null;
  private hotkeyRegistered = false;
  private hotkeyDiagnostics: string[] = [];

  constructor() {
    const userDataPath = app.getPath("userData");
    this.storage = new StorageService(userDataPath);
    this.stt = new TranscriptionService(userDataPath);
    this.modelLibrary = new ModelLibraryService(userDataPath, this.storage, (state) => {
      this.mainWindow?.webContents.send("models:download-progress", state);
      this.pillWindow?.webContents.send("models:download-progress", state);
      this.broadcastState();
    });
  }

  dispose(): void {
    this.stt.dispose();
  }

  async initialize(): Promise<void> {
    await this.context.initialize();
    await this.paste.initialize();
    await this.sound.initialize();
    this.registerIpc();
    this.createWindows();
    this.applySettings(this.storage.getState().settings);
    this.registerHotkeys();
  }

  private createWindows(): void {
    this.mainWindow = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 940,
      minHeight: 620,
      title: "Murmur",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.pillWindow = new BrowserWindow({
      width: 360,
      height: 86,
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "Murmur Recording",
      transparent: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    void this.loadRenderer(this.mainWindow);
    void this.loadRenderer(this.pillWindow, "?pill=1");
    this.attachWindowDiagnostics(this.mainWindow, "main");
    this.attachWindowDiagnostics(this.pillWindow, "pill");

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });
    this.pillWindow.on("closed", () => {
      this.pillWindow = null;
    });
  }

  private async loadRenderer(window: ElectronBrowserWindow, suffix = ""): Promise<void> {
    if (process.env.ELECTRON_RENDERER_URL) {
      await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${suffix}`);
    } else {
      await window.loadFile(join(__dirname, "../renderer/index.html"), suffix ? { query: { pill: "1" } } : undefined);
    }
  }

  private attachWindowDiagnostics(window: ElectronBrowserWindow, label: string): void {
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${label}:${level}] ${message} (${sourceId}:${line})`);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[renderer:${label}:load-failed] ${errorCode} ${errorDescription} ${validatedUrl}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[renderer:${label}:gone] ${details.reason}`);
    });
  }

  private registerIpc(): void {
    ipcMain.handle("app:get-state", () => this.getSnapshot());
    ipcMain.handle("settings:update", (_event, patch: Partial<AppSettings>) => {
      const state = this.storage.updateSettings(patch);
      this.applySettings(state.settings);
      this.registerHotkeys();
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("modes:set", (_event, modes: ModeConfig[]) => {
      this.storage.setModes(modes);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("mode:activate", (_event, modeId: string) => {
      this.storage.updateSettings({ activeModeId: modeId });
      this.session = { ...this.session, modeId };
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("providers:set-stt", (_event, providers: TranscriptionProviderConfig[]) => {
      this.storage.setTranscriptionProviders(providers);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("providers:set-llm", (_event, providers: LlmProviderConfig[]) => {
      this.storage.setLlmProviders(providers);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("provider:validate-stt", (_event, provider: TranscriptionProviderConfig) => this.stt.validate(provider));
    ipcMain.handle("provider:validate-llm", (_event, provider: LlmProviderConfig) => this.llm.validate(provider));
    ipcMain.handle("rules:set-auto-mode", (_event, rules) => {
      this.storage.setAutoModeRules(rules);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("replacements:set", (_event, replacements: ReplacementRule[]) => {
      this.storage.setReplacements(replacements);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("vocabulary:set", (_event, vocabulary: VocabularyEntry[]) => {
      this.storage.setVocabulary(vocabulary);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("models:get-library", () => this.modelLibrary.getLibrary());
    ipcMain.handle("models:download", async (_event, modelId: string) => {
      const snapshot = await this.modelLibrary.downloadModel(modelId);
      this.broadcastState();
      return snapshot;
    });
    ipcMain.handle("models:delete", async (_event, modelId: string) => {
      const snapshot = await this.modelLibrary.deleteDownloadedModel(modelId);
      this.broadcastState();
      return snapshot;
    });
    ipcMain.handle("models:toggle-favorite", async (_event, modelId: string) => {
      const snapshot = await this.modelLibrary.toggleFavorite(modelId);
      this.broadcastState();
      return snapshot;
    });
    ipcMain.handle("dictation:start", () => this.startRecording("manual"));
    ipcMain.handle("dictation:stop", () => this.stopRecording());
    ipcMain.handle("dictation:cancel", () => this.cancelRecording());
    ipcMain.handle("dictation:complete-recording", (_event, payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }) =>
      this.completeRecording(payload)
    );
    ipcMain.handle("history:copy", (_event, text: string) => {
      clipboard.writeText(text);
      return { ok: true };
    });
    ipcMain.handle("history:repaste", (_event, text: string) => this.paste.insertText(text, this.storage.getState().settings));
    ipcMain.handle("history:delete", (_event, id: string) => {
      this.storage.deleteHistory(id);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("history:clear", () => {
      this.storage.clearHistory();
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("history:reprocess", (_event, id: string) => this.reprocessHistory(id));
    ipcMain.handle("data:clear-local", () => {
      this.storage.clearLocalData();
      this.registerHotkeys();
      this.broadcastState();
      return this.getSnapshot();
    });
  }

  private applySettings(settings: AppSettings): void {
    nativeTheme.themeSource = settings.theme;
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }

  private registerHotkeys(): void {
    globalShortcut.unregisterAll();
    const settings = this.storage.getState().settings;
    this.hotkeyDiagnostics = [];

    const toggleOk = globalShortcut.register(settings.toggleHotkey, () => {
      if (this.session.status === "recording") {
        void this.stopRecording();
      } else {
        void this.startRecording("toggle_hotkey");
      }
    });
    const cancelOk = globalShortcut.register(settings.cancelHotkey, () => {
      void this.cancelRecording();
    });

    this.hotkeyRegistered = toggleOk && cancelOk;
    if (!toggleOk) this.hotkeyDiagnostics.push(`Unable to register toggle hotkey: ${settings.toggleHotkey}`);
    if (!cancelOk) this.hotkeyDiagnostics.push(`Unable to register cancel hotkey: ${settings.cancelHotkey}`);
    this.hotkeyDiagnostics.push(
      "Electron globalShortcut does not expose key release events here; push-to-talk is represented as a configured capability but toggle is the active backend."
    );
  }

  private async startRecording(_trigger: string): Promise<AppStateSnapshot> {
    if (this.session.status === "recording") return this.stopRecording();
    if (["transcribing", "processing", "pasting"].includes(this.session.status)) return this.getSnapshot();

    const persisted = this.storage.getState();
    await this.sound.prepareForRecording(persisted.settings);
    const context = await this.context.capture(persisted.settings);
    const mode = resolveModeByContext(context, persisted.modes, persisted.autoModeRules, persisted.settings.activeModeId);
    const sttProvider = this.selectTranscriptionProvider(persisted.transcriptionProviders);
    const llmProvider = mode.aiEnabled ? this.selectLlmProvider(persisted.llmProviders) : undefined;

    this.sessionContext = context;
    this.recordingStoppedAt = null;
    this.session = {
      id: createId("session"),
      status: "recording",
      modeId: mode.id,
      startedAt: new Date().toISOString(),
      cloudStt: Boolean(sttProvider?.isCloud),
      cloudLlm: Boolean(llmProvider?.isCloud),
      streamingMode: sttProvider?.streamingMode ?? "none"
    };

    this.showPill();
    this.mainWindow?.webContents.send("recording:start", { sessionId: this.session.id });
    this.broadcastState();
    return this.getSnapshot();
  }

  private async stopRecording(): Promise<AppStateSnapshot> {
    if (this.session.status !== "recording") return this.getSnapshot();
    this.recordingStoppedAt = new Date().toISOString();
    this.mainWindow?.webContents.send("recording:stop", { sessionId: this.session.id });
    this.session = { ...this.session, status: "transcribing" };
    this.broadcastState();
    return this.getSnapshot();
  }

  private async cancelRecording(): Promise<AppStateSnapshot> {
    if (this.session.status === "idle") return this.getSnapshot();
    this.mainWindow?.webContents.send("recording:cancel", { sessionId: this.session.id });
    this.session = {
      ...defaultSession,
      status: "cancelled",
      id: createId("cancelled"),
      modeId: this.storage.getState().settings.activeModeId
    };
    this.sessionContext = null;
    this.recordingStoppedAt = null;
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private async completeRecording(payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> {
    if (payload.sessionId !== this.session.id) return this.getSnapshot();

    const persisted = this.storage.getState();
    const mode = persisted.modes.find((candidate) => candidate.id === this.session.modeId) ?? persisted.modes[0];
    const sttProvider = this.selectTranscriptionProvider(persisted.transcriptionProviders);
    if (!sttProvider) {
      return this.failSession("No enabled transcription provider is configured.");
    }

    const context = this.sessionContext ?? (await this.context.capture(persisted.settings));
    const audio = new Uint8Array(payload.audio);
    const audioPath = persisted.settings.retainAudio ? this.writeAudioFile(this.session.id, audio, payload.mimeType) : null;
    const vocabularyPrompt = buildVocabularyPrompt(persisted.vocabulary);

    try {
      this.session = { ...this.session, status: "transcribing", transcriptPreview: "" };
      this.broadcastState();

      const transcription = await this.stt.transcribe({
        audio,
        mimeType: payload.mimeType,
        provider: sttProvider,
        language: mode.language ?? sttProvider.defaultLanguage,
        vocabularyPrompt,
        localOnly: persisted.settings.localOnly,
        onDelta: (delta) => {
          this.session = { ...this.session, transcriptPreview: `${this.session.transcriptPreview ?? ""}${delta}` };
          this.mainWindow?.webContents.send("dictation:transcript-delta", delta);
          this.pillWindow?.webContents.send("dictation:transcript-delta", delta);
        }
      });

      const beforeLlm = applyReplacements(transcription.text, persisted.replacements, "before");
      let processedText = beforeLlm;
      let llmProvider = mode.aiEnabled ? this.selectLlmProvider(persisted.llmProviders) : undefined;
      let llmModel: string | undefined;

      if (mode.aiEnabled && llmProvider) {
        this.session = { ...this.session, status: "processing" };
        this.broadcastState();
        const prompt = buildProcessingPrompt({ mode, context, rawTranscript: beforeLlm, vocabularyPrompt });
        const processed = await this.llm.process({
          provider: llmProvider,
          prompt,
          localOnly: persisted.settings.localOnly
        });
        processedText = processed.text || beforeLlm;
        llmModel = processed.model;
      } else {
        llmProvider = undefined;
      }

      processedText = applyReplacements(processedText, persisted.replacements, "after");
      const recordingStartedAt = this.session.startedAt;
      const recordingStoppedAt = this.recordingStoppedAt ?? new Date().toISOString();
      const recordingDurationMs = computeDurationMs(recordingStartedAt, recordingStoppedAt);
      const rawWordCount = countWords(transcription.text);
      const processedWordCount = countWords(processedText);
      this.session = { ...this.session, status: "pasting" };
      this.broadcastState();
      await this.paste.insertText(processedText, persisted.settings);

      const item: DictationHistoryItem = {
        id: createId("dictation"),
        audioPath,
        rawTranscript: transcription.text,
        processedOutput: processedText,
        modeId: mode.id,
        modeName: mode.name,
        transcriptionProviderId: sttProvider.id,
        transcriptionProviderType: sttProvider.type,
        transcriptionModel: transcription.model,
        transcriptionProviderCloud: sttProvider.isCloud,
        transcriptionStreamingMode: transcription.streamingMode,
        llmProviderId: llmProvider?.id,
        llmProviderType: llmProvider?.type,
        llmModel,
        llmProviderCloud: Boolean(llmProvider?.isCloud),
        appName: context.appName,
        appId: context.appId,
        windowTitle: context.windowTitle,
        browserDomain: context.browserDomain,
        createdAt: new Date().toISOString(),
        recordingStartedAt,
        recordingStoppedAt,
        recordingDurationMs,
        rawWordCount,
        processedWordCount
      };
      this.storage.addHistory(item);

      this.session = { ...this.session, status: "complete", transcriptPreview: processedText };
      this.recordingStoppedAt = null;
      this.hidePillSoon();
      this.broadcastState();
      setTimeout(() => {
        if (this.session.status === "complete") {
          this.session = { ...defaultSession, modeId: this.storage.getState().settings.activeModeId };
          this.broadcastState();
        }
      }, 1600).unref();
      return this.getSnapshot();
    } catch (error) {
      return this.failSession(String(error instanceof Error ? error.message : error));
    }
  }

  private async reprocessHistory(id: string): Promise<AppStateSnapshot> {
    const state = this.storage.getState();
    const item = state.history.find((candidate) => candidate.id === id);
    if (!item) return this.getSnapshot();

    const mode = state.modes.find((candidate) => candidate.id === state.settings.activeModeId) ?? state.modes[0];
    const provider = this.selectLlmProvider(state.llmProviders);
    if (!mode.aiEnabled || !provider) return this.getSnapshot();

    const context: ContextSnapshot = {
      appName: item.appName,
      appId: item.appId,
      windowTitle: item.windowTitle,
      browserDomain: item.browserDomain,
      capturedAt: new Date().toISOString(),
      sourceQuality: "fallback",
      diagnostics: ["Reprocessed from history."]
    };
    const vocabularyPrompt = buildVocabularyPrompt(state.vocabulary);
    const prompt = buildProcessingPrompt({ mode, context, rawTranscript: item.rawTranscript, vocabularyPrompt });
    const processed = await this.llm.process({ provider, prompt, localOnly: state.settings.localOnly });
    this.storage.updateHistoryItem(id, {
      processedOutput: applyReplacements(processed.text, state.replacements, "after"),
      modeId: mode.id,
      modeName: mode.name,
      llmProviderId: provider.id,
      llmProviderType: provider.type,
      llmModel: processed.model,
      llmProviderCloud: provider.isCloud
    });
    this.broadcastState();
    return this.getSnapshot();
  }

  private failSession(message: string): AppStateSnapshot {
    this.session = { ...this.session, status: "error", error: message };
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private writeAudioFile(sessionId: string, audio: Uint8Array, mimeType: string): string {
    const dir = join(app.getPath("userData"), "audio");
    mkdirSync(dir, { recursive: true });
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("ogg") ? "ogg" : "webm";
    const audioPath = join(dir, `${sessionId}.${ext}`);
    writeFileSync(audioPath, audio);
    return audioPath;
  }

  private selectTranscriptionProvider(providers: TranscriptionProviderConfig[]): TranscriptionProviderConfig | undefined {
    return providers.find((provider) => provider.enabled);
  }

  private selectLlmProvider(providers: LlmProviderConfig[]): LlmProviderConfig | undefined {
    return providers.find((provider) => provider.enabled);
  }

  private showPill(): void {
    this.pillWindow?.showInactive();
  }

  private hidePillSoon(): void {
    setTimeout(() => this.pillWindow?.hide(), 1800).unref();
  }

  private getSnapshot(): AppStateSnapshot {
    const state = this.storage.getState();
    return {
      ...state,
      session: this.session,
      capabilities: this.getCapabilities()
    };
  }

  private getCapabilities(): CapabilityReport {
    const contextFlags = this.context.getCapabilityFlags();
    return {
      hotkeys: {
        backend: "electron_global_shortcut",
        pushToTalkRelease: false,
        registered: this.hotkeyRegistered,
        diagnostics: this.hotkeyDiagnostics
      },
      context: {
        backend: "hyprctl_clipboard_fallback",
        appMetadata: contextFlags.appMetadata,
        focusedText: contextFlags.focusedText,
        selectedText: contextFlags.selectedText,
        browserDomain: contextFlags.browserDomain,
        diagnostics: this.context.getDiagnostics()
      },
      paste: {
        backend: this.paste.isAutomationAvailable() ? "ydotool_clipboard" : "clipboard_only",
        automationAvailable: this.paste.isAutomationAvailable(),
        diagnostics: this.paste.getDiagnostics()
      },
      storage: {
        backend: this.storage.backend,
        diagnostics: this.storage.getDiagnostics()
      },
      sound: this.sound.getCapabilities()
    };
  }

  private broadcastState(): void {
    const snapshot = this.getSnapshot();
    this.mainWindow?.webContents.send("state:changed", snapshot);
    this.pillWindow?.webContents.send("state:changed", snapshot);
  }
}

function computeDurationMs(startedAt: string | undefined, stoppedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const stop = new Date(stoppedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return undefined;
  return Math.max(0, stop - start);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
