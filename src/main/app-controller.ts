import type {
  BrowserWindow as ElectronBrowserWindow,
  MenuItemConstructorOptions,
  Notification as ElectronNotification,
  Tray as ElectronTray
} from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
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
  PillStateSnapshot,
  RecordingLevelPayload,
  ReplacementRule,
  SttPreferredLanguageScope,
  SttRuntimeId,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../shared/types";
import { recordingLevelPayloadSchema } from "../shared/schemas";
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
import { SttBenchmarkService } from "./services/stt-benchmark";
import { getSttUsability, sttRuntimeIdForModel, SttSetupService } from "./services/stt-setup";
import { TranscriptionService } from "./services/stt";
import { SttRuntimeService } from "./services/stt-runtime";
import { resolveAppPaths, type AppPaths } from "./services/app-paths";
import { NativeDesktopGlobalShortcutService } from "./services/native-global-shortcuts";
import { TextAutomationService } from "./services/text-automation";
import { shortcutDescriptionForActivationMode, XdgGlobalShortcutService } from "./services/xdg-global-shortcuts";
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  Tray
} from "./electron-api";

const pillWindowWidth = 140;
const pillWindowHeight = 64;
const pillWindowMargin = 24;
const trayIconDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAbklEQVR4nO3WQQ7AIAgEQJ7B/1/JrV4bg4kKXbTZTbzqoEYUYZgbo6qPN2CLm5k7PkeMKoftxLv6PpBdIIAAOKCfbAcQAhFwJGD1KU4FyEYzSgfIYjsOAyITpHTH2XMvac3w3xABpYDyy0fAb9MAo3Ifzf1J6oQAAAAASUVORK5CYII=";

export class AppController {
  private mainWindow: ElectronBrowserWindow | null = null;
  private pillWindow: ElectronBrowserWindow | null = null;
  private tray: ElectronTray | null = null;
  private isQuitting = false;
  private closeToTrayNotification: ElectronNotification | null = null;
  private storage: StorageService;
  private textAutomation = new TextAutomationService();
  private context = new ContextService(this.textAutomation);
  private paste = new PasteService(this.textAutomation);
  private runtimeService: SttRuntimeService;
  private portalHotkeys = new XdgGlobalShortcutService();
  private nativeHotkeys = new NativeDesktopGlobalShortcutService();
  private paths: AppPaths;
  private stt: TranscriptionService;
  private llm = new LlmService();
  private modelLibrary: ModelLibraryService;
  private sttSetup: SttSetupService;
  private sttBenchmark: SttBenchmarkService;
  private session: DictationSession = defaultSession;
  private sessionContext: ContextSnapshot | null = null;
  private pendingContextCapture: { sessionId: string; promise: Promise<ContextSnapshot> } | null = null;
  private recordingStoppedAt: string | null = null;
  private pillHideTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.runtimeService = new SttRuntimeService({
      runtimeDir: this.paths.runtimeDir,
      downloadsEnabled: !app.isPackaged,
      emitProgress: (state) => {
        this.mainWindow?.webContents.send("stt-runtime:progress", state);
        this.pillWindow?.webContents.send("stt-runtime:progress", state);
        this.broadcastState();
      },
      onBeforeRuntimeMutation: (runtimeId) => this.stt?.stopRuntime(runtimeId)
    });
    this.stt = new TranscriptionService(this.paths, this.runtimeService);
    this.modelLibrary = new ModelLibraryService(this.paths, this.storage, (state) => {
      this.mainWindow?.webContents.send("models:download-progress", state);
      this.pillWindow?.webContents.send("models:download-progress", state);
      this.broadcastState();
    }, this.runtimeService);
    this.sttSetup = new SttSetupService(this.paths, this.storage, this.modelLibrary, this.runtimeService);
    this.sttBenchmark = new SttBenchmarkService(this.paths, this.modelLibrary, this.runtimeService);
  }

  dispose(): void {
    globalShortcut.unregisterAll();
    this.portalHotkeys.dispose();
    this.nativeHotkeys.dispose();
    this.textAutomation.dispose();
    this.context.dispose();
    this.stt.dispose();
    this.closeToTrayNotification?.removeAllListeners();
    this.closeToTrayNotification?.close();
    this.closeToTrayNotification = null;
    this.tray?.destroy();
    this.tray = null;
    this.clearPillHideTimer();
  }

  async initialize(): Promise<void> {
    await this.textAutomation.initialize();
    await this.context.initialize();
    await this.paste.initialize();
    this.registerIpc();
    this.createTray();
    this.createWindows();
    this.applySettings(this.storage.getState().settings);
    await this.registerHotkeys();
  }

  private createWindows(): void {
    this.createMainWindow();
    this.createPillWindow();
  }

  private createMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return;

    const window = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 940,
      minHeight: 620,
      title: "Murmur",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    this.mainWindow = window;

    void this.loadRenderer(window);
    this.attachWindowDiagnostics(window, "main");

    window.on("close", (event) => {
      if (this.isQuitting) return;
      event.preventDefault();
      this.hideMainWindow();
      this.showCloseToTrayNoticeOnce();
    });
    window.on("show", () => this.refreshTrayMenu());
    window.on("hide", () => this.refreshTrayMenu());
    window.on("minimize", () => this.refreshTrayMenu());
    window.on("restore", () => this.refreshTrayMenu());
    window.on("closed", () => {
      if (this.mainWindow === window) {
        this.mainWindow = null;
        this.refreshTrayMenu();
      }
    });
    this.refreshTrayMenu();
  }

  private createPillWindow(): void {
    if (this.pillWindow && !this.pillWindow.isDestroyed()) return;

    const window = new BrowserWindow({
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
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    this.pillWindow = window;

    void this.loadRenderer(window, "?pill=1");
    this.attachWindowDiagnostics(window, "pill");
    this.configurePillWindow();

    window.on("closed", () => {
      if (this.pillWindow === window) this.pillWindow = null;
    });
  }

  private createTray(): void {
    if (this.tray) return;

    const image = nativeImage.createFromDataURL(trayIconDataUrl);
    if (process.platform === "darwin") {
      image.setTemplateImage(true);
    }

    this.tray = new Tray(image);
    this.tray.setToolTip("Murmur");
    this.refreshTrayMenu();
  }

  showMainWindow(): void {
    if (this.isQuitting) return;
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.createMainWindow();
    }

    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    this.refreshTrayMenu();
  }

  private hideMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.refreshTrayMenu();
      return;
    }

    this.mainWindow.hide();
    this.refreshTrayMenu();
  }

  private showCloseToTrayNoticeOnce(): void {
    const settings = this.storage.getState().settings;
    if (settings.trayCloseNoticeShownAt) return;

    this.storage.updateSettings({ trayCloseNoticeShownAt: new Date().toISOString() });
    if (!Notification.isSupported()) return;

    this.closeToTrayNotification?.removeAllListeners();
    this.closeToTrayNotification?.close();

    const notification = new Notification({
      title: "Murmur is still running",
      body: "Use the tray icon to reopen or quit Murmur.",
      silent: true
    });
    notification.on("click", () => this.showMainWindow());
    notification.on("close", () => {
      if (this.closeToTrayNotification === notification) this.closeToTrayNotification = null;
    });
    this.closeToTrayNotification = notification;
    notification.show();
  }

  private requestQuit(): void {
    this.isQuitting = true;
    this.closeToTrayNotification?.removeAllListeners();
    this.closeToTrayNotification?.close();
    this.closeToTrayNotification = null;
    this.tray?.destroy();
    this.tray = null;
    app.quit();
  }

  prepareToQuit(): void {
    this.isQuitting = true;
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return;

    const isVisible = this.isMainWindowVisible();
    const template: MenuItemConstructorOptions[] = [
      {
        label: isVisible ? "Hide Murmur" : "Show Murmur",
        click: () => {
          if (this.isMainWindowVisible()) {
            this.hideMainWindow();
          } else {
            this.showMainWindow();
          }
        }
      },
      { type: "separator" },
      {
        label: "Quit Murmur",
        click: () => this.requestQuit()
      }
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  private isMainWindowVisible(): boolean {
    return Boolean(this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible() && !this.mainWindow.isMinimized());
  }

  private async loadRenderer(window: ElectronBrowserWindow, suffix = ""): Promise<void> {
    if (process.env.ELECTRON_RENDERER_URL) {
      await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${suffix}`);
    } else {
      await window.loadFile(join(__dirname, "../renderer/index.html"), suffix ? { query: { pill: "1" } } : undefined);
    }
  }

  private attachWindowDiagnostics(window: ElectronBrowserWindow, label: string): void {
    if (Boolean(process.env.ELECTRON_RENDERER_URL)) {
      window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
        console.log(`[renderer:${label}:${level}] ${message} (${sourceId}:${line})`);
      });
    }
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[renderer:${label}:load-failed] ${errorCode} ${errorDescription} ${validatedUrl}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[renderer:${label}:gone] ${details.reason}`);
    });
  }

  private registerIpc(): void {
    ipcMain.handle("app:get-state", () => this.getSnapshot());
    ipcMain.handle("app:get-pill-state", () => this.getPillSnapshot());
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
    ipcMain.handle("models:cancel-download", async (_event, modelId: string) => {
      const snapshot = await this.modelLibrary.cancelModelDownload(modelId);
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
    ipcMain.handle("stt-setup:get", () => this.sttSetup.getSnapshot());
    ipcMain.handle("stt-runtime:download", async (_event, runtimeId: SttRuntimeId) => {
      await this.runtimeService.downloadRuntime(runtimeId);
      this.broadcastState();
      return this.sttSetup.getSnapshot();
    });
    ipcMain.handle("stt-runtime:repair", async (_event, runtimeId: SttRuntimeId) => {
      await this.runtimeService.repairRuntime(runtimeId);
      this.broadcastState();
      return this.sttSetup.getSnapshot();
    });
    ipcMain.handle("stt-runtime:cancel-download", async (_event, runtimeId: SttRuntimeId) => {
      await this.runtimeService.cancelRuntimeDownload(runtimeId);
      this.broadcastState();
      return this.sttSetup.getSnapshot();
    });
    ipcMain.handle("stt-setup:benchmark", async (_event, languageScope: SttPreferredLanguageScope) => {
      this.storage.updateSettings({ sttPreferredLanguageScope: languageScope });
      const recommendation = await this.sttBenchmark.run(languageScope);
      this.sttSetup.setRecommendation(recommendation);
      this.broadcastState();
      return recommendation;
    });
    ipcMain.handle("stt-setup:setup-bundled", async (_event, modelId: string) => {
      this.stt.stopRuntime();
      await this.sttSetup.setupBundledStt(modelId);
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("stt-setup:skip", () => {
      this.sttSetup.skipSttSetup();
      this.broadcastState();
      return this.getSnapshot();
    });
    ipcMain.handle("dictation:start", () => this.startRecording("manual"));
    ipcMain.handle("dictation:stop", () => this.stopRecording());
    ipcMain.handle("dictation:cancel", () => this.cancelRecording());
    ipcMain.handle("dictation:complete-recording", (_event, payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }) =>
      this.completeRecording(payload)
    );
    ipcMain.on("recording:level", (_event, payload: unknown) => this.forwardRecordingLevel(payload));
    ipcMain.handle("history:copy", (_event, text: string) => {
      clipboard.writeText(text);
      return { ok: true };
    });
    ipcMain.handle("history:repaste", (_event, text: string) => this.paste.insertText(text));
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

    if (nativeResult.registered && nativeResult.backend) {
      this.hotkeyBackend = nativeResult.backend;
      this.hotkeyRegistered = true;
      this.hotkeyPushToTalkRelease = nativeResult.pushToTalkRelease;
      this.hotkeyTriggerDescription = nativeResult.triggerDescription;
      this.hotkeyDiagnostics = nativeResult.diagnostics;
      if (settings.activationMode === "push_to_talk" && !nativeResult.pushToTalkRelease) {
        this.hotkeyDiagnostics.push(
          `${this.hotkeyBackendLabel(nativeResult.backend)} does not expose key release events; push-to-talk uses press to start and stop recording.`
        );
      }
      return;
    }

    const fallbackDiagnostics = [...this.hotkeyDiagnostics, ...nativeResult.diagnostics];
    this.hotkeyDiagnostics = [];

    const activationOk = this.tryRegisterHotkey("activation", settings.activationHotkey, () => {
      void this.handleActivationHotkey(`${settings.activationMode}_global_hotkey`);
    });
    const electronDiagnostics = this.hotkeyDiagnostics;
    this.hotkeyBackend = "electron_global_shortcut";
    this.hotkeyRegistered = activationOk;
    this.hotkeyPushToTalkRelease = false;
    this.hotkeyTriggerDescription = undefined;
    this.hotkeyDiagnostics = activationOk ? [] : [...fallbackDiagnostics, ...electronDiagnostics];

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
    const sttUsability = getSttUsability(persisted, this.runtimeService, this.paths);
    if (!sttUsability.usable) {
      this.session = {
        ...defaultSession,
        id: createId("blocked"),
        status: "error",
        modeId: persisted.settings.activeModeId,
        error: sttUsability.reason
      };
      this.broadcastState();
      return this.getSnapshot();
    }

    const sttProvider = this.selectTranscriptionProvider(persisted);
    const initialMode = persisted.modes.find((candidate) => candidate.id === persisted.settings.activeModeId) ?? persisted.modes[0];
    const llmProvider = initialMode.aiEnabled ? this.selectLlmProvider(persisted) : undefined;
    const sessionId = createId("session");

    this.sessionContext = null;
    this.recordingStoppedAt = null;
    this.session = {
      id: sessionId,
      status: "recording",
      modeId: initialMode.id,
      startedAt: new Date().toISOString(),
      cloudStt: Boolean(sttProvider?.isCloud),
      cloudLlm: Boolean(llmProvider?.isCloud),
      streamingMode: sttProvider?.streamingMode ?? "none"
    };

    this.showPill();
    this.mainWindow?.webContents.send("recording:start", {
      sessionId: this.session.id,
      preferredAudioInputId: persisted.settings.preferredAudioInputId
    });
    this.broadcastState();
    this.beginRecordingContextCapture(sessionId, persisted);
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
    this.pendingContextCapture = null;
    this.recordingStoppedAt = null;
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private beginRecordingContextCapture(sessionId: string, persisted: ReturnType<StorageService["getState"]>): void {
    const promise = this.captureRecordingContext(persisted)
      .then((context) => {
        this.applyRecordingContext(sessionId, context, persisted);
        return context;
      })
      .catch((error) => {
        const context = unavailableContext(`Context capture failed: ${errorMessage(error)}.`);
        this.applyRecordingContext(sessionId, context, persisted);
        return context;
      });

    this.pendingContextCapture = { sessionId, promise };
    void promise.finally(() => {
      if (this.pendingContextCapture?.sessionId === sessionId) {
        this.pendingContextCapture = null;
      }
    });
  }

  private async getRecordingContext(sessionId: string, persisted: ReturnType<StorageService["getState"]>): Promise<ContextSnapshot> {
    if (this.session.id === sessionId && this.sessionContext) return this.sessionContext;

    const pending = this.pendingContextCapture;
    if (pending?.sessionId === sessionId) return pending.promise;

    const context = await this.captureRecordingContext(persisted).catch((error) =>
      unavailableContext(`Context capture failed: ${errorMessage(error)}.`)
    );
    this.applyRecordingContext(sessionId, context, persisted);
    return context;
  }

  private async captureRecordingContext(persisted: ReturnType<StorageService["getState"]>): Promise<ContextSnapshot> {
    return this.context.capture({
      selectedText: persisted.settings.selectedTextCapture !== "disabled"
    });
  }

  private applyRecordingContext(
    sessionId: string,
    context: ContextSnapshot,
    persisted: ReturnType<StorageService["getState"]>
  ): void {
    if (this.session.id !== sessionId) return;

    const mode = resolveModeByContext(context, persisted.modes, persisted.autoModeRules, persisted.settings.activeModeId);
    const llmProvider = mode.aiEnabled ? this.selectLlmProvider(persisted) : undefined;
    const cloudLlm = Boolean(llmProvider?.isCloud);
    const changed = this.session.modeId !== mode.id || this.session.cloudLlm !== cloudLlm;

    this.sessionContext = context;
    this.session = { ...this.session, modeId: mode.id, cloudLlm };
    if (changed) this.broadcastState();
  }

  private async completeRecording(payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> {
    if (payload.sessionId !== this.session.id) return this.getSnapshot();

    let persisted = this.storage.getState();
    const context = await this.getRecordingContext(payload.sessionId, persisted);
    if (payload.sessionId !== this.session.id) return this.getSnapshot();

    persisted = this.storage.getState();
    const mode = persisted.modes.find((candidate) => candidate.id === this.session.modeId) ?? persisted.modes[0];
    const sttProvider = this.selectTranscriptionProvider(persisted);
    if (!sttProvider) {
      return this.failSession("No enabled transcription provider is configured.");
    }

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
        try {
          const processed = await this.llm.process({
            provider: llmProvider,
            prompt,
            localOnly: persisted.settings.localOnly
          });
          processedText = processed.text || beforeLlm;
          llmModel = processed.model;
        } catch (error) {
          console.warn(`LLM processing failed; using transcript without AI cleanup. ${errorMessage(error)}`);
          llmProvider = undefined;
        }
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
      this.hidePill();
      const pasteResult = await this.paste.insertText(processedText);
      if (!pasteResult.pasted) {
        this.notifyPasteFallback(pasteResult.message);
      }

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

      this.session = {
        ...this.session,
        status: "complete",
        transcriptPreview: processedText,
        error: pasteResult.pasted ? undefined : pasteResult.message
      };
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

  private forwardRecordingLevel(payload: unknown): void {
    const result = recordingLevelPayloadSchema.safeParse(payload);
    if (!result.success) return;
    const levelPayload = result.data as RecordingLevelPayload;
    if (this.session.status !== "recording" || levelPayload.sessionId !== this.session.id) return;
    this.pillWindow?.webContents.send("recording:level", levelPayload);
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
    settings: AppSettings;
    transcriptionProviders: TranscriptionProviderConfig[];
    modelLibrary: ModelLibrarySnapshot;
  }): TranscriptionProviderConfig | undefined {
    const activeModel = this.selectActiveModel(state.modelLibrary, "voice");
    const activeProvider = activeModel ? transcriptionProviderFromModel(activeModel, state.transcriptionProviders) : null;
    if (activeProvider && this.isTranscriptionProviderUsable(activeProvider, state.settings)) return activeProvider;
    return state.transcriptionProviders.find((provider) => this.isTranscriptionProviderUsable(provider, state.settings));
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
    if (kind === "voice") {
      const runtimeId = sttRuntimeIdForModel(item);
      if (runtimeId && this.runtimeService.getAvailability(runtimeId).status !== "available") return undefined;
    }
    if (item.downloadStrategy === "none") return item;
    return modelLibrary.downloads.some((download) => download.modelId === item.id && download.status === "downloaded") ? item : undefined;
  }

  private isTranscriptionProviderUsable(provider: TranscriptionProviderConfig, settings: AppSettings): boolean {
    if (!provider.enabled) return false;
    if (settings.localOnly && provider.isCloud) return false;
    if (provider.isCloud && !provider.apiKey) return false;
    if (provider.type === "whisper_cpp" && provider.baseUrl === "murmur://runtime/whisper.cpp") {
      return this.bundledProviderUsable(provider, "whisper.cpp");
    }
    if (provider.type === "sherpa_onnx") {
      return this.bundledProviderUsable(provider, "sherpa-onnx");
    }
    return Boolean(provider.baseUrl);
  }

  private bundledProviderUsable(provider: TranscriptionProviderConfig, runtimeId: SttRuntimeId): boolean {
    if (this.runtimeService.getAvailability(runtimeId).status !== "available") return false;
    if (!provider.defaultModel) return false;
    const modelPath = isAbsolute(provider.defaultModel) ? provider.defaultModel : join(this.paths.modelDir, provider.defaultModel);
    return existsSync(modelPath);
  }

  private showPill(): void {
    if (!this.pillWindow) return;
    this.clearPillHideTimer();
    this.configurePillWindow();
    this.positionPillWindow();
    this.pillWindow.showInactive();
  }

  private hidePillSoon(): void {
    this.clearPillHideTimer();
    this.pillHideTimer = setTimeout(() => {
      this.pillHideTimer = null;
      if (this.isPillSessionActive()) return;
      this.pillWindow?.hide();
    }, 1800);
    this.pillHideTimer.unref();
  }

  private hidePill(): void {
    this.clearPillHideTimer();
    this.pillWindow?.hide();
  }

  private clearPillHideTimer(): void {
    if (!this.pillHideTimer) return;
    clearTimeout(this.pillHideTimer);
    this.pillHideTimer = null;
  }

  private isPillSessionActive(): boolean {
    return ["recording", "transcribing", "processing", "pasting"].includes(this.session.status);
  }

  private notifyPasteFallback(message: string): void {
    if (!Notification.isSupported()) return;
    new Notification({
      title: "Murmur output copied",
      body: message || "Automatic paste was unavailable; the output is on the clipboard.",
      silent: true
    }).show();
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
    const position = this.storage.getSettings().recordingPillPosition;
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
      sttSetup: this.sttSetup.getSnapshot(),
      session: this.session,
      capabilities: this.getCapabilities()
    };
  }

  private getPillSnapshot(snapshot?: AppStateSnapshot): PillStateSnapshot {
    return {
      session: this.session,
      theme: snapshot?.settings.theme ?? this.storage.getSettings().theme
    };
  }

  private getCapabilities(): CapabilityReport {
    const contextFlags = this.context.getCapabilityFlags();
    const pasteCapability = this.textAutomation.getCapability();
    return {
      sttRuntimes: this.runtimeService.getAvailabilities(),
      stt: {
        diagnostics: this.stt.getDiagnostics()
      },
      hotkeys: {
        backend: this.hotkeyBackend,
        pushToTalkRelease: this.hotkeyPushToTalkRelease,
        registered: this.hotkeyRegistered,
        triggerDescription: this.hotkeyTriggerDescription,
        diagnostics: this.hotkeyDiagnostics
      },
      context: {
        backend: contextFlags.appMetadata ? "desktop_metadata" : "clipboard_fallback",
        appMetadata: contextFlags.appMetadata,
        focusedText: contextFlags.focusedText,
        selectedText: contextFlags.selectedText,
        browserDomain: contextFlags.browserDomain,
        diagnostics: this.context.getDiagnostics()
      },
      paste: {
        backend: pasteCapability.backend,
        automationAvailable: pasteCapability.automationAvailable,
        permissionRequired: pasteCapability.permissionRequired,
        diagnostics: this.paste.getDiagnostics(),
        availableBackends: pasteCapability.availableBackends,
        attemptedBackends: pasteCapability.attemptedBackends,
        missingTools: pasteCapability.missingTools,
        setupHints: pasteCapability.setupHints
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
    this.pillWindow?.webContents.send("pill-state:changed", this.getPillSnapshot(snapshot));
  }
}

function computeDurationMs(startedAt: string | undefined, stoppedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const stop = new Date(stoppedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return undefined;
  return Math.max(0, stop - start);
}

function unavailableContext(message: string): ContextSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    sourceQuality: "unavailable",
    diagnostics: [message]
  };
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
