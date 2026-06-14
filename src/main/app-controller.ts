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
  ModelCatalogItem,
  ModelLibrarySnapshot,
  ModeConfig,
  ReplacementRule,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../shared/types";
import { defaultSession } from "../shared/defaults";
import { llmProviderFromModel, transcriptionProviderFromModel } from "../shared/model-activation";
import { buildProcessingPrompt, buildVocabularyPrompt } from "../shared/prompts";
import { applyReplacements } from "../shared/replacements";
import { resolveModeByContext } from "./services/auto-mode";
import { createId } from "./services/ids";
import { ContextService } from "./services/context";
import { LlmService } from "./services/llm";
import { ModelLibraryService } from "./services/model-library";
import { PasteService } from "./services/paste";
import { StorageService } from "./services/storage";
import { TranscriptionService } from "./services/stt";
import { SttRuntimeService } from "./services/stt-runtime";
import { resolveAppPaths, type AppPaths } from "./services/app-paths";
import { NativeDesktopGlobalShortcutService } from "./services/native-global-shortcuts";
import { shortcutDescriptionForActivationMode, XdgGlobalShortcutService } from "./services/xdg-global-shortcuts";
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, screen } from "./electron-api";

const pillWindowWidth = 360;
const pillWindowHeight = 86;
const pillWindowMargin = 24;

export class AppController {
  private mainWindow: ElectronBrowserWindow | null = null;
  private pillWindow: ElectronBrowserWindow | null = null;
  private storage: StorageService;
  private context = new ContextService();
  private paste = new PasteService();
  private runtimeService = new SttRuntimeService();
  private portalHotkeys = new XdgGlobalShortcutService();
  private nativeHotkeys = new NativeDesktopGlobalShortcutService();
  private paths: AppPaths;
  private stt: TranscriptionService;
  private llm = new LlmService();
  private modelLibrary: ModelLibraryService;
  private session: DictationSession = defaultSession;
  private sessionContext: ContextSnapshot | null = null;
  private recordingStoppedAt: string | null = null;
  private pushToTalkPressed = false;
  private pushToTalkSessionId: string | null = null;
  private hotkeyBackend: CapabilityReport["hotkeys"]["backend"] = "electron_global_shortcut";
  private hotkeyRegistered = false;
  private hotkeyPushToTalkRelease = false;
  private hotkeyTriggerDescription: string | undefined;
  private hotkeyDiagnostics: string[] = [];
  private hotkeyCaptureDepth = 0;
  private hotkeyRegistrationGeneration = 0;
  private hotkeyRegistrationQueue: Promise<void> = Promise.resolve();
  private lastActivationHotkeyAt = 0;

  constructor() {
    this.paths = resolveAppPaths(app);
    this.storage = new StorageService(this.paths);
    this.stt = new TranscriptionService(this.paths, this.runtimeService);
    this.modelLibrary = new ModelLibraryService(this.paths, this.storage, (state) => {
      this.mainWindow?.webContents.send("models:download-progress", state);
      this.pillWindow?.webContents.send("models:download-progress", state);
      this.broadcastState();
    }, this.runtimeService);
  }

  dispose(): void {
    globalShortcut.unregisterAll();
    this.portalHotkeys.dispose();
    this.nativeHotkeys.dispose();
    this.stt.dispose();
  }

  async initialize(): Promise<void> {
    await this.context.initialize();
    await this.paste.initialize();
    this.registerIpc();
    this.createWindows();
    this.applySettings(this.storage.getState().settings);
    await this.registerHotkeys();
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
      width: pillWindowWidth,
      height: pillWindowHeight,
      show: false,
      frame: false,
      focusable: false,
      resizable: false,
      hasShadow: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "Murmur Recording",
      type: "notification",
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
    this.configurePillWindow();

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
    ipcMain.handle("settings:update", async (_event, patch: Partial<AppSettings>) => {
      const state = this.storage.updateSettings(patch);
      this.applySettings(state.settings);
      await this.registerHotkeys();
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("hotkeys:capture-start", async () => {
      await this.beginHotkeyCapture();
      this.broadcastState();
      return { ok: true };
    });
    ipcMain.handle("hotkeys:capture-end", async () => {
      await this.endHotkeyCapture();
      return { ok: true };
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
    ipcMain.handle("models:activate", async (_event, modelId: string) => {
      const snapshot = await this.modelLibrary.activateModel(modelId);
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
    ipcMain.handle("data:clear-local", async () => {
      this.storage.clearLocalData();
      await this.registerHotkeys();
      this.broadcastState();
      return this.getSnapshot();
    });
  }

  private applySettings(settings: AppSettings): void {
    nativeTheme.themeSource = settings.theme;
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    this.configurePillWindow();
  }

  private async beginHotkeyCapture(): Promise<void> {
    this.hotkeyCaptureDepth += 1;
    await this.registerHotkeys();
  }

  private async endHotkeyCapture(): Promise<void> {
    if (this.hotkeyCaptureDepth === 0) return;
    this.hotkeyCaptureDepth -= 1;
    if (this.hotkeyCaptureDepth > 0) return;
    await this.registerHotkeys();
    this.broadcastState();
  }

  private registerHotkeys(): Promise<void> {
    const generation = ++this.hotkeyRegistrationGeneration;
    const registration = this.hotkeyRegistrationQueue
      .catch(() => undefined)
      .then(() => this.registerHotkeysForGeneration(generation));
    this.hotkeyRegistrationQueue = registration;
    return registration;
  }

  private async registerHotkeysForGeneration(generation: number): Promise<void> {
    globalShortcut.unregisterAll();
    await this.portalHotkeys.unregister();
    await this.nativeHotkeys.unregister();
    this.resetHotkeyCapabilities();

    if (generation !== this.hotkeyRegistrationGeneration) return;

    const settings = this.storage.getState().settings;

    if (this.hotkeyCaptureDepth > 0) {
      this.hotkeyDiagnostics = ["Keyboard shortcut recording is active."];
      return;
    }

    const portalResult = await this.portalHotkeys.register({
      accelerator: settings.activationHotkey,
      description: shortcutDescriptionForActivationMode(settings.activationMode),
      activationMode: settings.activationMode,
      onActivated: () => {
        if (settings.activationMode === "push_to_talk") {
          void this.handlePushToTalkActivated();
        } else {
          void this.handleActivationHotkey("toggle_global_hotkey");
        }
      },
      onDeactivated: () => {
        if (settings.activationMode === "push_to_talk") {
          void this.handlePushToTalkDeactivated();
        }
      }
    });

    if (generation !== this.hotkeyRegistrationGeneration) {
      globalShortcut.unregisterAll();
      await this.portalHotkeys.unregister();
      await this.nativeHotkeys.unregister();
      return;
    }

    this.hotkeyDiagnostics = portalResult.diagnostics;
    if (portalResult.registered) {
      this.hotkeyBackend = "xdg_desktop_portal";
      this.hotkeyRegistered = true;
      this.hotkeyPushToTalkRelease = portalResult.pushToTalkRelease;
      this.hotkeyTriggerDescription = portalResult.triggerDescription;
      return;
    }

    const nativeResult = await this.nativeHotkeys.register({
      accelerator: settings.activationHotkey,
      description: shortcutDescriptionForActivationMode(settings.activationMode),
      activationMode: settings.activationMode,
      onActivated: () => {
        if (settings.activationMode === "push_to_talk") {
          void this.handlePushToTalkActivated();
        } else {
          void this.handleActivationHotkey("toggle_global_hotkey");
        }
      },
      onDeactivated: () => {
        if (settings.activationMode === "push_to_talk") {
          void this.handlePushToTalkDeactivated();
        }
      },
      onPressedWithoutRelease: () => {
        void this.handleActivationHotkey(`${settings.activationMode}_global_hotkey`);
      }
    });

    if (generation !== this.hotkeyRegistrationGeneration) {
      globalShortcut.unregisterAll();
      await this.portalHotkeys.unregister();
      await this.nativeHotkeys.unregister();
      return;
    }

    this.hotkeyDiagnostics = [...this.hotkeyDiagnostics, ...nativeResult.diagnostics];
    if (nativeResult.registered && nativeResult.backend) {
      this.hotkeyBackend = nativeResult.backend;
      this.hotkeyRegistered = true;
      this.hotkeyPushToTalkRelease = nativeResult.pushToTalkRelease;
      this.hotkeyTriggerDescription = nativeResult.triggerDescription;
      if (settings.activationMode === "push_to_talk" && !nativeResult.pushToTalkRelease) {
        this.hotkeyDiagnostics.push(
          `${this.hotkeyBackendLabel(nativeResult.backend)} does not expose key release events; push-to-talk uses press to start and stop recording.`
        );
      }
      return;
    }

    const activationOk = this.tryRegisterHotkey("activation", settings.activationHotkey, () => {
      void this.handleActivationHotkey(`${settings.activationMode}_global_hotkey`);
    });
    this.hotkeyBackend = "electron_global_shortcut";
    this.hotkeyRegistered = activationOk;
    this.hotkeyPushToTalkRelease = false;
    this.hotkeyTriggerDescription = undefined;

    if (!activationOk) this.hotkeyDiagnostics.push(`Global activation shortcut is not registered: ${settings.activationHotkey}.`);
    if (settings.activationMode === "push_to_talk") {
      this.hotkeyDiagnostics.push(
        "Electron globalShortcut does not expose key release events; push-to-talk uses press to start and stop recording."
      );
    }
  }

  private resetHotkeyCapabilities(): void {
    this.hotkeyBackend = "electron_global_shortcut";
    this.hotkeyRegistered = false;
    this.hotkeyPushToTalkRelease = false;
    this.hotkeyTriggerDescription = undefined;
    this.hotkeyDiagnostics = [];
  }

  private hotkeyBackendLabel(backend: CapabilityReport["hotkeys"]["backend"]): string {
    if (backend === "gnome_custom_shortcut") return "GNOME custom shortcuts";
    if (backend === "kde_kglobalaccel") return "KDE KGlobalAccel";
    if (backend === "hyprland_bind") return "Hyprland binds";
    if (backend === "xdg_desktop_portal") return "XDG Desktop Portal";
    return "Electron globalShortcut";
  }

  private tryRegisterHotkey(label: string, accelerator: string, callback: () => void): boolean {
    try {
      const registered = globalShortcut.register(accelerator, callback);
      const isRegistered = registered && globalShortcut.isRegistered(accelerator);
      if (!isRegistered) this.hotkeyDiagnostics.push(`Unable to register ${label} hotkey globally: ${accelerator}`);
      return isRegistered;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hotkeyDiagnostics.push(`Invalid ${label} hotkey "${accelerator}": ${message}`);
      return false;
    }
  }

  private async handleActivationHotkey(trigger: string): Promise<AppStateSnapshot> {
    const now = Date.now();
    if (now - this.lastActivationHotkeyAt < 250) return this.getSnapshot();
    this.lastActivationHotkeyAt = now;

    if (this.session.status === "recording") {
      return this.stopRecording();
    }

    return this.startRecording(trigger);
  }

  private async handlePushToTalkActivated(): Promise<AppStateSnapshot> {
    if (this.session.status !== "idle") return this.getSnapshot();

    this.pushToTalkPressed = true;
    const snapshot = await this.startRecording("push_to_talk_global_hotkey");
    if (snapshot.session.status === "recording") {
      this.pushToTalkSessionId = snapshot.session.id;
      if (!this.pushToTalkPressed) {
        return this.handlePushToTalkDeactivated();
      }
    }
    return snapshot;
  }

  private async handlePushToTalkDeactivated(): Promise<AppStateSnapshot> {
    this.pushToTalkPressed = false;
    if (this.session.status !== "recording") return this.getSnapshot();
    if (this.pushToTalkSessionId !== this.session.id) return this.getSnapshot();

    this.pushToTalkSessionId = null;
    return this.stopRecording();
  }

  private async startRecording(_trigger: string): Promise<AppStateSnapshot> {
    if (this.session.status === "recording") return this.stopRecording();
    if (["transcribing", "processing", "pasting"].includes(this.session.status)) return this.getSnapshot();

    const persisted = this.storage.getState();
    const context = await this.context.capture(persisted.settings);
    const mode = resolveModeByContext(context, persisted.modes, persisted.autoModeRules, persisted.settings.activeModeId);
    const sttProvider = this.selectTranscriptionProvider(persisted);
    const llmProvider = mode.aiEnabled ? this.selectLlmProvider(persisted) : undefined;

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
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
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
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private async completeRecording(payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> {
    if (payload.sessionId !== this.session.id) return this.getSnapshot();

    const persisted = this.storage.getState();
    const mode = persisted.modes.find((candidate) => candidate.id === this.session.modeId) ?? persisted.modes[0];
    const sttProvider = this.selectTranscriptionProvider(persisted);
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
      let llmProvider = mode.aiEnabled ? this.selectLlmProvider(persisted) : undefined;
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
      this.pushToTalkPressed = false;
      this.pushToTalkSessionId = null;
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
    const provider = this.selectLlmProvider(state);
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
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private writeAudioFile(sessionId: string, audio: Uint8Array, mimeType: string): string {
    const dir = this.paths.audioDir;
    mkdirSync(dir, { recursive: true });
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("ogg") ? "ogg" : "webm";
    const audioPath = join(dir, `${sessionId}.${ext}`);
    writeFileSync(audioPath, audio);
    return audioPath;
  }

  private selectTranscriptionProvider(state: {
    transcriptionProviders: TranscriptionProviderConfig[];
    modelLibrary: ModelLibrarySnapshot;
  }): TranscriptionProviderConfig | undefined {
    const activeModel = this.selectActiveModel(state.modelLibrary, "voice");
    const activeProvider = activeModel ? transcriptionProviderFromModel(activeModel, state.transcriptionProviders) : null;
    return activeProvider ?? state.transcriptionProviders.find((provider) => provider.enabled);
  }

  private selectLlmProvider(state: { llmProviders: LlmProviderConfig[]; modelLibrary: ModelLibrarySnapshot }): LlmProviderConfig | undefined {
    const activeModel = this.selectActiveModel(state.modelLibrary, "language");
    const activeProvider = activeModel ? llmProviderFromModel(activeModel, state.llmProviders) : null;
    return activeProvider ?? state.llmProviders.find((provider) => provider.enabled);
  }

  private selectActiveModel(modelLibrary: ModelLibrarySnapshot, kind: ModelCatalogItem["kind"]): ModelCatalogItem | undefined {
    const modelId = modelLibrary.activeModelIds[kind];
    const item = modelId ? modelLibrary.catalog.find((candidate) => candidate.id === modelId && candidate.kind === kind) : undefined;
    if (!item) return undefined;
    if (item.downloadStrategy === "none") return item;
    return modelLibrary.downloads.some((download) => download.modelId === item.id && download.status === "downloaded") ? item : undefined;
  }

  private showPill(): void {
    if (!this.pillWindow) return;
    this.configurePillWindow();
    this.positionPillWindow();
    this.pillWindow.showInactive();
  }

  private hidePillSoon(): void {
    setTimeout(() => this.pillWindow?.hide(), 1800).unref();
  }

  private configurePillWindow(): void {
    if (!this.pillWindow) return;
    this.pillWindow.setFocusable(false);
    this.pillWindow.setSkipTaskbar(true);
    this.pillWindow.setAlwaysOnTop(true);
    this.pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.positionPillWindow();
  }

  private positionPillWindow(): void {
    if (!this.pillWindow) return;

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const position = this.storage.getState().settings.recordingPillPosition;
    const { x, y, width, height } = display.workArea;
    const pillX =
      position === "bottom_left"
        ? x + pillWindowMargin
        : position === "bottom_right"
          ? x + width - pillWindowWidth - pillWindowMargin
          : x + (width - pillWindowWidth) / 2;

    this.pillWindow.setBounds({
      x: Math.round(pillX),
      y: Math.round(y + height - pillWindowHeight - pillWindowMargin),
      width: pillWindowWidth,
      height: pillWindowHeight
    });
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
      sttRuntimes: this.runtimeService.getAvailabilities(),
      hotkeys: {
        backend: this.hotkeyBackend,
        pushToTalkRelease: this.hotkeyPushToTalkRelease,
        registered: this.hotkeyRegistered,
        triggerDescription: this.hotkeyTriggerDescription,
        diagnostics: this.hotkeyDiagnostics
      },
      context: {
        backend: "clipboard_fallback",
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
      }
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
