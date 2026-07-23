import type {
  BrowserWindow as ElectronBrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  Notification as ElectronNotification,
  Tray as ElectronTray
} from "electron";
import type { z } from "zod";
import { existsSync } from "node:fs";
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
  ModeSelectorStateSnapshot,
  PillStateSnapshot,
  ProviderRuntimeSnapshot,
  RecordingLevelPayload,
  SttRuntimeActionTarget,
  SttRuntimeId,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../shared/types";
import {
  autoModeRulesSetPayloadSchema,
  completeRecordingPayloadSchema,
  ipcIdPayloadSchema,
  ipcTextPayloadSchema,
  llmProviderConfigSchema,
  llmProvidersSetPayloadSchema,
  modesSetPayloadSchema,
  modeSelectorMovePayloadSchema,
  onboardingDictationScopePayloadSchema,
  recordingErrorPayloadSchema,
  recordingLevelPayloadSchema,
  settingsUpdatePayloadSchema,
  sttProvidersSetPayloadSchema,
  sttRuntimeActionTargetSchema,
  transcriptionProviderConfigSchema,
  vocabularySetPayloadSchema
} from "../shared/schemas";
import { defaultSession, maxRecordingDurationMs } from "../shared/defaults";
import {
  isLlmProviderUsable,
  isTranscriptionProviderUsable as isBaseTranscriptionProviderUsable,
  llmProviderFromModel,
  transcriptionProviderFromModel
} from "../shared/model-activation";
import { buildProcessingPrompt, buildVocabularyPrompt } from "../shared/prompts";
import { resolveModeByContext } from "./services/auto-mode";
import { createId } from "./services/ids";
import { registerElectronShortcutActions, registerModeSelectorNavigationShortcuts } from "./services/electron-global-shortcuts";
import { CodexOAuthService } from "./services/codex-oauth";
import { ContextService } from "./services/context";
import { LlmService } from "./services/llm";
import { ModelLibraryService } from "./services/model-library";
import { PasteService } from "./services/paste";
import { StorageService } from "./services/storage";
import { createSafeStorageProviderSecretCodec } from "./services/provider-secrets";
import { isTrustedRendererUrl, resolveRendererSource, type RendererSource } from "./services/renderer-security";
import { getSttUsability, sttRuntimeIdForModel, SttSetupService } from "./services/stt-setup";
import { TranscriptionService } from "./services/stt";
import { SttRuntimeService } from "./services/stt-runtime";
import { SttAccelerationProbeService } from "./services/stt-gpu-probe";
import { resolveAppPaths, type AppPaths } from "./services/app-paths";
import { NativeDesktopGlobalShortcutService } from "./services/native-global-shortcuts";
import { TextAutomationService } from "./services/text-automation";
import { AutomationPermissionService } from "./services/automation-permissions";
import {
  createDictationProcessingPlan,
  DictationSessionOwner,
  StaleDictationSessionError,
  type DictationInvalidationReason,
  type DictationSessionOperation,
  type RecordingSource
} from "./services/dictation-session";
import {
  shortcutDescriptionForActivationMode,
  shortcutDescriptionForModeSelector,
  XdgGlobalShortcutService
} from "./services/xdg-global-shortcuts";
import { MacosEventTapReleaseService } from "./services/macos-event-tap-hotkeys";
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
  safeStorage,
  screen,
  shell,
  Tray
} from "./electron-api";

const pillWindowWidth = 140;
const pillWindowHeight = 64;
const pillWindowMargin = 24;
const modeSelectorWindowSize = 640;
const recordingStopAckTimeoutMs = 15000;
const maxRecordingDurationNotice = "Maximum recording length reached; finishing this dictation.";
const trayIconDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAbklEQVR4nO3WQQ7AIAgEQJ7B/1/JrV4bg4kKXbTZTbzqoEYUYZgbo6qPN2CLm5k7PkeMKoftxLv6PpBdIIAAOKCfbAcQAhFwJGD1KU4FyEYzSgfIYjsOAyITpHTH2XMvac3w3xABpYDyy0fAb9MAo3Ifzf1J6oQAAAAASUVORK5CYII=";
export class AppController {
  private mainWindow: ElectronBrowserWindow | null = null;
  private pillWindow: ElectronBrowserWindow | null = null;
  private modeSelectorWindow: ElectronBrowserWindow | null = null;
  private tray: ElectronTray | null = null;
  private isQuitting = false;
  private closeToTrayNotification: ElectronNotification | null = null;
  private storage: StorageService;
  private textAutomation = new TextAutomationService();
  private context = new ContextService(this.textAutomation);
  private paste = new PasteService(this.textAutomation);
  private automationPermissions = new AutomationPermissionService();
  private runtimeService: SttRuntimeService;
  private accelerationProbe = new SttAccelerationProbeService();
  private portalHotkeys = new XdgGlobalShortcutService();
  private nativeHotkeys = new NativeDesktopGlobalShortcutService();
  private macosReleaseHotkeys = new MacosEventTapReleaseService();
  private paths: AppPaths;
  private rendererSource: RendererSource;
  private stt: TranscriptionService;
  private codex: CodexOAuthService;
  private initialCodexRefresh: Promise<unknown> = Promise.resolve();
  private llm: LlmService;
  private modelLibrary: ModelLibraryService;
  private sttSetup: SttSetupService;
  private session: DictationSession = defaultSession;
  private dictationOwner = new DictationSessionOwner();
  private sessionOperation: DictationSessionOperation | null = null;
  private sessionContext: ContextSnapshot | null = null;
  private pendingContextCapture: { operation: DictationSessionOperation; promise: Promise<ContextSnapshot> } | null = null;
  private recordingStoppedAt: string | null = null;
  private pillHideTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingMaxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingStopAckTimer: ReturnType<typeof setTimeout> | null = null;
  private pushToTalkPressed = false;
  private pushToTalkSessionId: string | null = null;
  private hotkeyBackend: CapabilityReport["hotkeys"]["backend"] = "electron_global_shortcut";
  private hotkeyRegistered = false;
  private hotkeyPushToTalkRelease = false;
  private hotkeyTriggerDescription: string | undefined;
  private hotkeyDiagnostics: string[] = [];
  private modeSelectorHotkeyRegistered = false;
  private modeSelectorHotkeyTriggerDescription: string | undefined;
  private modeSelectorHotkeyDiagnostics: string[] = [];
  private modeSelectorNavigationShortcutCleanup: (() => void) | null = null;
  private hotkeyCaptureDepth = 0;
  private hotkeyRegistrationGeneration = 0;
  private hotkeyRegistrationQueue: Promise<void> = Promise.resolve();
  private lastActivationHotkeyAt = 0;
  private onboardingDictationScopeActive = false;

  constructor() {
    this.paths = resolveAppPaths(app);
    this.rendererSource = resolveRendererSource({
      isPackaged: app.isPackaged,
      envRendererUrl: process.env.ELECTRON_RENDERER_URL,
      rendererFilePath: join(__dirname, "../renderer/index.html")
    });
    const secretCodec = createSafeStorageProviderSecretCodec(safeStorage);
    this.storage = new StorageService(this.paths, undefined, secretCodec);
    this.codex = new CodexOAuthService({
      authPath: join(this.paths.configDir, "murmur-codex-auth.json"),
      secretCodec,
      openExternal: (url) => shell.openExternal(url),
      onStatusChange: () => this.broadcastState(),
      appVersion: app.getVersion()
    });
    this.llm = new LlmService(this.codex);
    this.runtimeService = new SttRuntimeService({
      runtimeDir: this.paths.runtimeDir,
      packaged: app.isPackaged,
      emitProgress: (state) => {
        this.mainWindow?.webContents.send("stt-runtime:progress", state);
        this.pillWindow?.webContents.send("stt-runtime:progress", state);
        this.broadcastState();
      },
      onBeforeRuntimeMutation: (state) => this.stt?.stopRuntime(state.id)
    });
    this.stt = new TranscriptionService(this.paths, this.runtimeService);
    this.modelLibrary = new ModelLibraryService(
      this.paths,
      this.storage,
      (state) => {
        this.mainWindow?.webContents.send("models:download-progress", state);
        this.pillWindow?.webContents.send("models:download-progress", state);
        this.broadcastState();
      },
      this.runtimeService,
      { getProviderRuntime: () => this.getProviderRuntime() }
    );
    this.sttSetup = new SttSetupService(this.paths, this.storage, this.modelLibrary, this.runtimeService);
  }

  dispose(): void {
    this.invalidateDictation("shutdown");
    this.unregisterModeSelectorNavigationShortcuts();
    globalShortcut.unregisterAll();
    this.portalHotkeys.dispose();
    this.nativeHotkeys.dispose();
    this.macosReleaseHotkeys.unregister();
    this.textAutomation.dispose();
    this.context.dispose();
    this.stt.dispose();
    this.codex.dispose();
    this.closeToTrayNotification?.removeAllListeners();
    this.closeToTrayNotification?.close();
    this.closeToTrayNotification = null;
    this.tray?.destroy();
    this.tray = null;
    this.clearPillHideTimer();
    this.clearRecordingTimers();
  }

  async initialize(): Promise<void> {
    await this.automationPermissions.initialize();
    await this.textAutomation.initialize();
    await this.context.initialize();
    await this.paste.initialize();
    this.registerIpc();
    this.initialCodexRefresh = this.codex.refreshStatus();
    this.createTray();
    this.createWindows();
    this.applySettings(this.storage.getState().settings);
    await this.registerHotkeys();
  }

  private createWindows(): void {
    this.createMainWindow();
    this.createPillWindow();
    this.createModeSelectorWindow();
  }

  private createMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return;

    const window = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 940,
      minHeight: 620,
      title: "Murmur",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 14, y: 20 }
          }
        : {}),
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    this.mainWindow = window;

    this.configureTrustedRendererWindow(window, "main");
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
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    this.pillWindow = window;

    this.configureTrustedRendererWindow(window, "pill");
    void this.loadRenderer(window, "?pill=1");
    this.attachWindowDiagnostics(window, "pill");
    this.configurePillWindow();

    window.on("closed", () => {
      if (this.pillWindow === window) this.pillWindow = null;
    });
  }

  private createModeSelectorWindow(): void {
    if (this.modeSelectorWindow && !this.modeSelectorWindow.isDestroyed()) return;

    const window = new BrowserWindow({
      width: modeSelectorWindowSize,
      height: modeSelectorWindowSize,
      show: false,
      frame: false,
      focusable: true,
      acceptFirstMouse: true,
      resizable: false,
      hasShadow: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "Murmur Mode Selector",
      transparent: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    this.modeSelectorWindow = window;

    this.configureTrustedRendererWindow(window, "mode-selector");
    void this.loadRenderer(window, "?mode-selector=1");
    this.attachWindowDiagnostics(window, "mode-selector");
    this.configureModeSelectorWindow();

    window.on("hide", () => {
      this.unregisterModeSelectorNavigationShortcuts();
    });
    window.on("closed", () => {
      this.unregisterModeSelectorNavigationShortcuts();
      if (this.modeSelectorWindow === window) this.modeSelectorWindow = null;
    });
  }

  private createTray(): void {
    if (this.tray) return;

    const image = nativeImage.createFromDataURL(trayIconDataUrl);

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
    if (this.rendererSource.kind === "dev" && this.rendererSource.url) {
      await window.loadURL(rendererUrlWithSuffix(this.rendererSource.url, suffix));
    } else {
      const query = rendererQueryFromSuffix(suffix);
      await window.loadFile(this.rendererSource.filePath, query ? { query } : undefined);
    }
  }

  private attachWindowDiagnostics(window: ElectronBrowserWindow, label: string): void {
    if (this.rendererSource.kind === "dev") {
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

  private configureTrustedRendererWindow(window: ElectronBrowserWindow, label: string): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      console.warn(`[renderer:${label}:window-open-blocked] ${url}`);
      return { action: "deny" };
    });
    window.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (isTrustedRendererUrl(this.rendererSource, url)) return;
      event.preventDefault();
      console.warn(`[renderer:${label}:navigation-blocked] ${url}`);
    });
    const frameNavigationEvents = window.webContents as unknown as {
      on(
        channel: "will-frame-navigate",
        listener: (event: { preventDefault(): void }, url: string, isInPlace: boolean, isMainFrame: boolean) => void
      ): void;
    };
    frameNavigationEvents.on("will-frame-navigate", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame || isTrustedRendererUrl(this.rendererSource, url)) return;
      event.preventDefault();
      console.warn(`[renderer:${label}:frame-navigation-blocked] ${url}`);
    });
  }

  private registerIpc(): void {
    const handle = (
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ): void => {
      ipcMain.handle(channel, (event, ...args) => {
        this.assertTrustedIpcSender(event, channel);
        return listener(event, ...args);
      });
    };
    const on = (channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void => {
      ipcMain.on(channel, (event, ...args) => {
        this.assertTrustedIpcSender(event, channel);
        listener(event, ...args);
      });
    };

    handle("app:get-state", () => this.getSnapshot());
    handle("app:get-pill-state", () => this.getPillSnapshot());
    handle("app:get-mode-selector-state", () => this.getModeSelectorSnapshot());
    handle("automation:permission-status", () => this.automationPermissions.status());
    handle("automation:permission-request", () => {
      const report = this.automationPermissions.request();
      this.broadcastState();
      return report;
    });
    handle("settings:update", async (_event, payload) => {
      const patch = parseIpcPayload(settingsUpdatePayloadSchema, payload, "settings:update") as Partial<AppSettings>;
      const state = this.storage.updateSettings(patch);
      this.applySettings(state.settings);
      await this.registerHotkeys();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("hotkeys:capture-start", async () => {
      await this.beginHotkeyCapture();
      this.broadcastState();
      return { ok: true };
    });
    handle("hotkeys:capture-end", async () => {
      await this.endHotkeyCapture();
      return { ok: true };
    });
    handle("modes:set", (_event, payload) => {
      const modes = parseIpcPayload(modesSetPayloadSchema, payload, "modes:set") as ModeConfig[];
      this.storage.setModes(modes);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("mode:activate", (_event, payload) => {
      const modeId = parseIpcPayload(ipcIdPayloadSchema, payload, "mode:activate");
      this.storage.updateSettings({ activeModeId: modeId });
      this.session = { ...this.session, modeId };
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("providers:set-stt", (_event, payload) => {
      const providers = parseIpcPayload(sttProvidersSetPayloadSchema, payload, "providers:set-stt") as TranscriptionProviderConfig[];
      this.storage.setTranscriptionProviders(providers);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("providers:set-llm", (_event, payload) => {
      const providers = parseIpcPayload(llmProvidersSetPayloadSchema, payload, "providers:set-llm") as LlmProviderConfig[];
      this.storage.setLlmProviders(providers);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("provider:validate-stt", (_event, payload) => {
      const provider = parseIpcPayload(transcriptionProviderConfigSchema, payload, "provider:validate-stt") as TranscriptionProviderConfig;
      return this.stt.validate(this.storage.resolveTranscriptionProviderSecret(provider));
    });
    handle("provider:validate-llm", (_event, payload) => {
      const provider = parseIpcPayload(llmProviderConfigSchema, payload, "provider:validate-llm") as LlmProviderConfig;
      return this.llm.validate(this.storage.resolveLlmProviderSecret(provider));
    });
    handle("codex:refresh", async () => {
      await this.codex.refreshStatus();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("codex:login-start", async () => {
      await this.codex.startLogin();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("codex:login-cancel", async () => {
      await this.codex.cancelLogin();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("codex:logout", async () => {
      await this.codex.logout();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("rules:set-auto-mode", (_event, payload) => {
      const rules = parseIpcPayload(autoModeRulesSetPayloadSchema, payload, "rules:set-auto-mode");
      this.storage.setAutoModeRules(rules);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("vocabulary:set", (_event, payload) => {
      const vocabulary = parseIpcPayload(vocabularySetPayloadSchema, payload, "vocabulary:set") as VocabularyEntry[];
      this.storage.setVocabulary(vocabulary);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("models:get-library", () => this.modelLibrary.getLibrary());
    handle("models:download", async (_event, payload) => {
      const modelId = parseIpcPayload(ipcIdPayloadSchema, payload, "models:download");
      const snapshot = await this.modelLibrary.downloadModel(modelId);
      this.broadcastState();
      return snapshot;
    });
    handle("models:cancel-download", async (_event, payload) => {
      const modelId = parseIpcPayload(ipcIdPayloadSchema, payload, "models:cancel-download");
      const snapshot = await this.modelLibrary.cancelModelDownload(modelId);
      this.broadcastState();
      return snapshot;
    });
    handle("models:activate", async (_event, payload) => {
      const modelId = parseIpcPayload(ipcIdPayloadSchema, payload, "models:activate");
      const snapshot = await this.modelLibrary.activateModel(modelId);
      this.broadcastState();
      return snapshot;
    });
    handle("models:delete", async (_event, payload) => {
      const modelId = parseIpcPayload(ipcIdPayloadSchema, payload, "models:delete");
      const snapshot = await this.modelLibrary.deleteDownloadedModel(modelId);
      this.broadcastState();
      return snapshot;
    });
    handle("models:toggle-favorite", async (_event, payload) => {
      const modelId = parseIpcPayload(ipcIdPayloadSchema, payload, "models:toggle-favorite");
      const snapshot = await this.modelLibrary.toggleFavorite(modelId);
      this.broadcastState();
      return snapshot;
    });
    handle("stt-setup:get", () => this.sttSetup.getSnapshot());
    handle("stt-runtime:download", async (_event, payload) => {
      const target = parseIpcPayload(sttRuntimeActionTargetSchema, payload, "stt-runtime:download") as SttRuntimeActionTarget;
      await this.runtimeService.downloadRuntime(target);
      this.broadcastState();
      return this.sttSetup.getSnapshot();
    });
    handle("stt-runtime:repair", async (_event, payload) => {
      const target = parseIpcPayload(sttRuntimeActionTargetSchema, payload, "stt-runtime:repair") as SttRuntimeActionTarget;
      await this.runtimeService.repairRuntime(target);
      this.broadcastState();
      return this.sttSetup.getSnapshot();
    });
    handle("stt-runtime:cancel-download", async (_event, payload) => {
      const target = parseIpcPayload(sttRuntimeActionTargetSchema, payload, "stt-runtime:cancel-download") as SttRuntimeActionTarget;
      await this.runtimeService.cancelRuntimeDownload(target);
      this.broadcastState();
      return this.sttSetup.getSnapshot();
    });
    handle("stt-setup:setup-bundled", async (_event, payload) => {
      const modelId = parseIpcPayload(ipcIdPayloadSchema, payload, "stt-setup:setup-bundled");
      this.stt.stopRuntime();
      await this.sttSetup.setupBundledStt(modelId);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("stt-setup:skip", () => {
      this.sttSetup.skipSttSetup();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("dictation:start", () => this.startRecording("manual"));
    handle("dictation:stop", () => this.stopRecording());
    handle("dictation:cancel", () => this.cancelRecording());
    handle("dictation:complete-recording", (_event, payload) =>
      this.completeRecording(parseIpcPayload(completeRecordingPayloadSchema, payload, "dictation:complete-recording"))
    );
    handle("dictation:recording-error", (_event, payload) =>
      this.handleRecordingError(parseIpcPayload(recordingErrorPayloadSchema, payload, "dictation:recording-error"))
    );
    on("recording:level", (_event, payload) => this.forwardRecordingLevel(payload));
    handle("onboarding:test-paste", async (_event, payload) => {
      const text = parseIpcPayload(ipcTextPayloadSchema, payload, "onboarding:test-paste");
      const automation = this.ensureAutomationReadyForUserAction("paste test");
      if (!automation.ready) return { pasted: false, message: automation.message };
      const result = await this.paste.insertText(text);
      this.broadcastState();
      return result;
    });
    handle("onboarding:dictation-scope", (_event, payload) => {
      const { active } = parseIpcPayload(onboardingDictationScopePayloadSchema, payload, "onboarding:dictation-scope");
      this.onboardingDictationScopeActive = active;
      return { ok: true };
    });
    handle("history:copy", (_event, payload) => {
      const text = parseIpcPayload(ipcTextPayloadSchema, payload, "history:copy");
      clipboard.writeText(text);
      return { ok: true };
    });
    handle("history:repaste", (_event, payload) => {
      const automation = this.ensureAutomationReadyForUserAction("history paste");
      if (!automation.ready) return { pasted: false, message: automation.message };
      return this.paste.insertText(parseIpcPayload(ipcTextPayloadSchema, payload, "history:repaste"));
    });
    handle("history:delete", (_event, payload) => {
      const id = parseIpcPayload(ipcIdPayloadSchema, payload, "history:delete");
      this.storage.deleteHistory(id);
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("history:clear", () => {
      this.storage.clearHistory();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("history:reprocess", (_event, payload) => this.reprocessHistory(parseIpcPayload(ipcIdPayloadSchema, payload, "history:reprocess")));
    handle("data:clear-local", async () => {
      if (this.sessionOperation) {
        this.mainWindow?.webContents.send("recording:cancel", { sessionId: this.sessionOperation.sessionId });
      }
      this.invalidateDictation("cleared");
      this.session = { ...defaultSession, modeId: this.storage.getState().settings.activeModeId };
      await this.codex.logout();
      this.storage.clearLocalData();
      this.session = { ...defaultSession, modeId: this.storage.getState().settings.activeModeId };
      await this.registerHotkeys();
      this.broadcastState();
      return this.getSnapshot();
    });
    handle("mode-selector:hide", () => {
      this.hideModeSelectorWindow();
      return { ok: true };
    });
    handle("mode-selector:select-mode", (_event, payload) =>
      this.selectModeFromSelector(parseIpcPayload(ipcIdPayloadSchema, payload, "mode-selector:select-mode"))
    );
    handle("mode-selector:move-selection", (_event, payload) =>
      this.moveModeSelectorSelection(parseIpcPayload(modeSelectorMovePayloadSchema, payload, "mode-selector:move-selection"))
    );
  }

  private assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent, channel: string): void {
    const senderId = event.sender.id;
    const owned = [this.mainWindow, this.pillWindow, this.modeSelectorWindow].some(
      (window) => window && !window.isDestroyed() && window.webContents.id === senderId
    );

    if (!owned) {
      throw new IpcAuthorizationError(channel);
    }

    const frameUrl = event.senderFrame?.url || event.sender.getURL();
    if (!isTrustedRendererUrl(this.rendererSource, frameUrl)) {
      throw new IpcAuthorizationError(channel);
    }
  }

  private applySettings(settings: AppSettings): void {
    nativeTheme.themeSource = settings.theme;
    this.configurePillWindow();
    this.configureModeSelectorWindow();
  }

  private ensureAutomationReadyForUserAction(action: string): { ready: true } | { ready: false; message: string } {
    const current = this.automationPermissions.status();
    if (current.status === "not_required" || current.status === "trusted") {
      this.textAutomation.refreshStatus();
      return { ready: true };
    }

    const requested = current.canPrompt ? this.automationPermissions.request() : current;
    if (requested.status === "trusted") {
      this.textAutomation.refreshStatus();
      this.broadcastState();
      return { ready: true };
    }

    const detail = requested.diagnostics[0] ?? "automation permission is unavailable.";
    this.broadcastState();
    return {
      ready: false,
      message: `Cannot start ${action}: ${detail}`
    };
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
    this.hideModeSelectorWindow();
    globalShortcut.unregisterAll();
    await this.portalHotkeys.unregister();
    await this.nativeHotkeys.unregister();
    this.macosReleaseHotkeys.unregister();
    this.resetHotkeyCapabilities();

    if (generation !== this.hotkeyRegistrationGeneration) return;

    const settings = this.storage.getState().settings;

    if (this.hotkeyCaptureDepth > 0) {
      this.hotkeyDiagnostics = ["Keyboard shortcut recording is active."];
      this.modeSelectorHotkeyDiagnostics = ["Keyboard shortcut recording is active."];
      return;
    }

    const shortcutActions = [
      {
        id: "activation" as const,
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
      },
      {
        id: "mode-selector" as const,
        accelerator: settings.modeSelectorHotkey,
        description: shortcutDescriptionForModeSelector(),
        activationMode: "toggle" as const,
        onActivated: () => {
          this.showModeSelectorWindow();
        },
        onDeactivated: () => undefined,
        onPressedWithoutRelease: () => {
          this.showModeSelectorWindow();
        }
      }
    ];

    const portalResult = await this.portalHotkeys.register({
      actions: shortcutActions
    });

    if (generation !== this.hotkeyRegistrationGeneration) {
      globalShortcut.unregisterAll();
      await this.portalHotkeys.unregister();
      await this.nativeHotkeys.unregister();
      return;
    }

    if (portalResult.registered && !(settings.activationMode === "push_to_talk" && !portalResult.actionResults.activation.pushToTalkRelease)) {
      this.hotkeyBackend = "xdg_desktop_portal";
      this.applyHotkeyRegistrationResults({
        activation: portalResult.actionResults.activation,
        modeSelector: portalResult.actionResults["mode-selector"],
        backendDiagnostics: portalResult.diagnostics
      });
      return;
    }
    if (portalResult.registered) {
      await this.portalHotkeys.unregister();
    }

    const nativeResult = await this.nativeHotkeys.register({
      actions: shortcutActions
    });

    if (generation !== this.hotkeyRegistrationGeneration) {
      globalShortcut.unregisterAll();
      await this.portalHotkeys.unregister();
      await this.nativeHotkeys.unregister();
      return;
    }

    if (
      nativeResult.registered &&
      nativeResult.backend &&
      !(settings.activationMode === "push_to_talk" && !nativeResult.pushToTalkRelease)
    ) {
      this.hotkeyBackend = nativeResult.backend;
      this.applyHotkeyRegistrationResults({
        activation: nativeResult.actionResults.activation,
        modeSelector: nativeResult.actionResults["mode-selector"],
        backendDiagnostics: nativeResult.diagnostics
      });
      return;
    }
    if (nativeResult.registered) {
      await this.nativeHotkeys.unregister();
    }

    const fallbackActivationDiagnostics = [
      ...portalResult.diagnostics,
      ...portalResult.actionResults.activation.diagnostics,
      ...nativeResult.diagnostics,
      ...nativeResult.actionResults.activation.diagnostics
    ];
    const fallbackModeSelectorDiagnostics = [
      ...portalResult.diagnostics,
      ...portalResult.actionResults["mode-selector"].diagnostics,
      ...nativeResult.diagnostics,
      ...nativeResult.actionResults["mode-selector"].diagnostics
    ];

    if (process.platform === "darwin" && settings.activationMode === "push_to_talk") {
      const macosPermission = this.automationPermissions.status();
      const releaseResult =
        macosPermission.status === "trusted"
          ? await this.macosReleaseHotkeys.register(settings.activationHotkey, () => {
              void this.handlePushToTalkDeactivated();
            })
          : {
              registered: false,
              diagnostics: macosPermission.diagnostics.length
                ? macosPermission.diagnostics
                : ["macOS Accessibility permission is required for push-to-talk release detection."]
            };
      const electronResult = registerElectronShortcutActions(globalShortcut, [
        {
          id: "activation",
          label: "activation",
          accelerator: settings.activationHotkey,
          onActivated: () => {
            void this.handlePushToTalkActivated();
          }
        },
        {
          id: "mode-selector",
          label: "mode selector",
          accelerator: settings.modeSelectorHotkey,
          onActivated: () => {
            this.showModeSelectorWindow();
          }
        }
      ]);
      const activationResult = electronResult.actionResults.activation;
      const modeSelectorResult = electronResult.actionResults["mode-selector"];
      this.hotkeyBackend = "macos_event_tap";
      this.hotkeyRegistered = activationResult.registered && releaseResult.registered;
      this.hotkeyPushToTalkRelease = releaseResult.registered;
      this.hotkeyTriggerDescription = releaseResult.triggerDescription;
      this.hotkeyDiagnostics = this.hotkeyRegistered
        ? releaseResult.diagnostics
        : [...fallbackActivationDiagnostics, ...activationResult.diagnostics, ...releaseResult.diagnostics];
      this.modeSelectorHotkeyRegistered = modeSelectorResult.registered;
      this.modeSelectorHotkeyTriggerDescription = undefined;
      this.modeSelectorHotkeyDiagnostics = modeSelectorResult.registered
        ? []
        : [...fallbackModeSelectorDiagnostics, ...modeSelectorResult.diagnostics];
      if (!this.hotkeyRegistered) {
        this.hotkeyDiagnostics.push("Push-to-talk registration is unavailable because release detection is not ready.");
      }
      if (!modeSelectorResult.registered) {
        this.modeSelectorHotkeyDiagnostics.push(`Global mode selector shortcut is not registered: ${settings.modeSelectorHotkey}.`);
      }
      return;
    }

    const electronActions =
      settings.activationMode === "push_to_talk"
        ? [
            {
              id: "mode-selector" as const,
              label: "mode selector",
              accelerator: settings.modeSelectorHotkey,
              onActivated: () => {
                this.showModeSelectorWindow();
              }
            }
          ]
        : [
            {
              id: "activation" as const,
              label: "activation",
              accelerator: settings.activationHotkey,
              onActivated: () => {
                void this.handleActivationHotkey(`${settings.activationMode}_global_hotkey`);
              }
            },
            {
              id: "mode-selector" as const,
              label: "mode selector",
              accelerator: settings.modeSelectorHotkey,
              onActivated: () => {
                this.showModeSelectorWindow();
              }
            }
          ];
    const electronResult = registerElectronShortcutActions(globalShortcut, electronActions);
    if (settings.activationMode === "push_to_talk") {
      electronResult.actionResults.activation.diagnostics.push(
        "Push-to-talk requires a hotkey backend that reports key release events; Electron globalShortcut activation is unavailable."
      );
    }
    const activationResult = electronResult.actionResults.activation;
    const modeSelectorResult = electronResult.actionResults["mode-selector"];
    this.hotkeyBackend = "electron_global_shortcut";
    this.hotkeyRegistered = activationResult.registered;
    this.hotkeyPushToTalkRelease = false;
    this.hotkeyTriggerDescription = undefined;
    this.hotkeyDiagnostics = activationResult.registered
      ? []
      : [...fallbackActivationDiagnostics, ...activationResult.diagnostics];
    this.modeSelectorHotkeyRegistered = modeSelectorResult.registered;
    this.modeSelectorHotkeyTriggerDescription = undefined;
    this.modeSelectorHotkeyDiagnostics = modeSelectorResult.registered
      ? []
      : [...fallbackModeSelectorDiagnostics, ...modeSelectorResult.diagnostics];

    if (!activationResult.registered) this.hotkeyDiagnostics.push(`Global activation shortcut is not registered: ${settings.activationHotkey}.`);
    if (!modeSelectorResult.registered) {
      this.modeSelectorHotkeyDiagnostics.push(`Global mode selector shortcut is not registered: ${settings.modeSelectorHotkey}.`);
    }
  }

  private resetHotkeyCapabilities(): void {
    this.hotkeyBackend = "electron_global_shortcut";
    this.hotkeyRegistered = false;
    this.hotkeyPushToTalkRelease = false;
    this.hotkeyTriggerDescription = undefined;
    this.hotkeyDiagnostics = [];
    this.modeSelectorHotkeyRegistered = false;
    this.modeSelectorHotkeyTriggerDescription = undefined;
    this.modeSelectorHotkeyDiagnostics = [];
  }

  private hotkeyBackendLabel(backend: CapabilityReport["hotkeys"]["backend"]): string {
    if (backend === "gnome_custom_shortcut") return "GNOME custom shortcuts";
    if (backend === "kde_kglobalaccel") return "KDE KGlobalAccel";
    if (backend === "hyprland_bind") return "Hyprland binds";
    if (backend === "xdg_desktop_portal") return "XDG Desktop Portal";
    return "Electron globalShortcut";
  }

  private applyHotkeyRegistrationResults(options: {
    activation: { registered: boolean; pushToTalkRelease: boolean; triggerDescription?: string; diagnostics: string[] };
    modeSelector: { registered: boolean; triggerDescription?: string; diagnostics: string[] };
    backendDiagnostics: string[];
  }): void {
    this.hotkeyRegistered = options.activation.registered;
    this.hotkeyPushToTalkRelease = options.activation.pushToTalkRelease;
    this.hotkeyTriggerDescription = options.activation.triggerDescription;
    this.hotkeyDiagnostics = options.activation.registered
      ? options.activation.diagnostics
      : [...options.backendDiagnostics, ...options.activation.diagnostics];
    this.modeSelectorHotkeyRegistered = options.modeSelector.registered;
    this.modeSelectorHotkeyTriggerDescription = options.modeSelector.triggerDescription;
    this.modeSelectorHotkeyDiagnostics = options.modeSelector.registered
      ? options.modeSelector.diagnostics
      : [...options.backendDiagnostics, ...options.modeSelector.diagnostics];
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
    const source: RecordingSource = this.onboardingDictationScopeActive ? "onboarding" : "dictation";
    const automation = source === "dictation" ? this.ensureAutomationReadyForUserAction("dictation") : { ready: true as const };
    if (!automation.ready) {
      this.session = {
        ...defaultSession,
        id: createId("blocked"),
        status: "error",
        modeId: persisted.settings.activeModeId,
        error: automation.message
      };
      this.broadcastState();
      return this.getSnapshot();
    }

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

    const selectedSttProvider = this.selectTranscriptionProvider(persisted);
    if (!selectedSttProvider) {
      return this.failSession("No enabled transcription provider is configured.");
    }
    const initialMode = persisted.modes.find((candidate) => candidate.id === persisted.settings.activeModeId) ?? persisted.modes[0];
    const selectedLlmProvider =
      this.selectLlmProvider(persisted) ?? persisted.llmProviders.find((provider) => provider.type === "codex" && provider.enabled);
    const plan = createDictationProcessingPlan({
      source,
      settings: persisted.settings,
      modes: persisted.modes,
      autoModeRules: persisted.autoModeRules,
      vocabulary: persisted.vocabulary,
      sttProvider: this.storage.resolveTranscriptionProviderSecret(selectedSttProvider),
      llmProvider: selectedLlmProvider ? this.storage.resolveLlmProviderSecret(selectedLlmProvider) : undefined
    });
    const sessionId = createId("session");
    const operation = this.dictationOwner.start(sessionId, plan);

    this.sessionOperation = operation;
    this.sessionContext = null;
    this.recordingStoppedAt = null;
    this.clearRecordingTimers();
    this.session = {
      id: sessionId,
      status: "recording",
      modeId: initialMode.id,
      startedAt: new Date().toISOString(),
      cloudStt: plan.sttProvider.isCloud,
      cloudLlm: initialMode.aiEnabled && Boolean(plan.llmProvider?.isCloud),
      streamingMode: plan.sttProvider.streamingMode
    };

    this.showPill();
    this.mainWindow?.webContents.send("recording:start", {
      sessionId: this.session.id,
      preferredAudioInputId: persisted.settings.preferredAudioInputId
    });
    this.broadcastState();
    if (source === "onboarding") {
      this.sessionContext = unavailableContext("Onboarding dictation does not capture desktop context.");
    } else {
      this.beginRecordingContextCapture(operation);
    }
    this.scheduleRecordingMaxDurationStop(sessionId);
    return this.getSnapshot();
  }

  private async stopRecording(notice?: string): Promise<AppStateSnapshot> {
    if (this.session.status !== "recording") return this.getSnapshot();
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
    this.clearRecordingMaxDurationTimer();
    this.recordingStoppedAt = new Date().toISOString();
    const sessionId = this.session.id;
    const operation = this.sessionOperation;
    if (!operation || !this.dictationOwner.isCurrent(operation)) return this.getSnapshot();
    this.dictationOwner.markAwaitingAudio(operation);
    this.mainWindow?.webContents.send("recording:stop", { sessionId });
    this.session = { ...this.session, status: "transcribing", error: notice ?? this.session.error };
    this.scheduleRecordingStopAckTimeout(sessionId);
    this.broadcastState();
    return this.getSnapshot();
  }

  private async cancelRecording(): Promise<AppStateSnapshot> {
    if (this.session.status === "idle") return this.getSnapshot();
    this.mainWindow?.webContents.send("recording:cancel", { sessionId: this.session.id });
    this.invalidateDictation("cancelled");
    this.session = {
      ...defaultSession,
      status: "cancelled",
      id: createId("cancelled"),
      modeId: this.storage.getState().settings.activeModeId
    };
    this.sessionContext = null;
    this.pendingContextCapture = null;
    this.recordingStoppedAt = null;
    this.clearRecordingTimers();
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private beginRecordingContextCapture(operation: DictationSessionOperation): void {
    const promise = this.captureRecordingContext(operation)
      .then((context) => {
        this.applyRecordingContext(operation, context);
        return context;
      })
      .catch((error) => {
        const context = unavailableContext(`Context capture failed: ${errorMessage(error)}.`);
        this.applyRecordingContext(operation, context);
        return context;
      });

    this.pendingContextCapture = { operation, promise };
    void promise.finally(() => {
      if (this.pendingContextCapture?.operation === operation) {
        this.pendingContextCapture = null;
      }
    });
  }

  private async getRecordingContext(operation: DictationSessionOperation): Promise<ContextSnapshot> {
    this.dictationOwner.assertCurrent(operation);
    if (this.sessionContext) return this.sessionContext;

    const pending = this.pendingContextCapture;
    if (pending?.operation === operation) return pending.promise;

    const context = await this.captureRecordingContext(operation).catch((error) =>
      unavailableContext(`Context capture failed: ${errorMessage(error)}.`)
    );
    this.dictationOwner.assertCurrent(operation);
    this.applyRecordingContext(operation, context);
    return context;
  }

  private async captureRecordingContext(operation: DictationSessionOperation): Promise<ContextSnapshot> {
    this.dictationOwner.assertCurrent(operation);
    return this.context.capture({
      selectedText: operation.plan.settings.selectedTextCapture !== "disabled"
    });
  }

  private applyRecordingContext(operation: DictationSessionOperation, context: ContextSnapshot): void {
    if (!this.dictationOwner.isCurrent(operation)) return;

    const plan = operation.plan;
    const mode = resolveModeByContext(context, plan.modes, plan.autoModeRules, plan.settings.activeModeId);
    const cloudLlm = mode.aiEnabled && Boolean(plan.llmProvider?.isCloud);
    const changed = this.session.modeId !== mode.id || this.session.cloudLlm !== cloudLlm;

    this.sessionContext = context;
    this.session = { ...this.session, modeId: mode.id, cloudLlm };
    if (changed) this.broadcastState();
  }

  private async completeRecording(payload: { sessionId: string; audio: ArrayBuffer; mimeType: string }): Promise<AppStateSnapshot> {
    const operation = this.dictationOwner.claimAudio(payload.sessionId);
    if (!operation) return this.getSnapshot();
    this.clearRecordingStopAckTimer();
    this.clearRecordingMaxDurationTimer();

    try {
      const context = await this.getRecordingContext(operation);
      this.dictationOwner.assertCurrent(operation);
      const plan = operation.plan;
      const mode = plan.modes.find((candidate) => candidate.id === this.session.modeId) ?? plan.modes[0];
      const sttProvider = plan.sttProvider;
      const audio = new Uint8Array(payload.audio);
      const vocabularyPrompt = buildVocabularyPrompt([...plan.vocabulary]);

      this.session = { ...this.session, status: "transcribing", transcriptPreview: "" };
      this.broadcastState();

      const transcription = await this.stt.transcribe({
        audio,
        mimeType: payload.mimeType,
        provider: sttProvider,
        language: mode.language ?? sttProvider.defaultLanguage,
        vocabularyPrompt,
        signal: operation.controller.signal,
        onDelta: (delta) => {
          if (!this.dictationOwner.isCurrent(operation)) return;
          this.session = { ...this.session, transcriptPreview: `${this.session.transcriptPreview ?? ""}${delta}` };
          this.mainWindow?.webContents.send("dictation:transcript-delta", delta);
          this.pillWindow?.webContents.send("dictation:transcript-delta", delta);
        }
      });
      this.dictationOwner.assertCurrent(operation);

      let processedText = transcription.text;
      let llmProvider = mode.aiEnabled ? plan.llmProvider : undefined;
      let llmModel: string | undefined;
      let llmFailureMessage: string | undefined;

      if (llmProvider) {
        this.session = { ...this.session, status: "processing" };
        this.broadcastState();
        const prompt = buildProcessingPrompt({ mode, context, rawTranscript: transcription.text, vocabularyPrompt });
        try {
          const processed = await this.llm.process({
            provider: llmProvider,
            prompt,
            signal: operation.controller.signal
          });
          this.dictationOwner.assertCurrent(operation);
          processedText = processed.text || transcription.text;
          llmModel = processed.model;
        } catch (error) {
          if (!this.dictationOwner.isCurrent(operation)) throw error;
          llmFailureMessage = `LLM processing failed: ${errorMessage(error)}`;
          console.warn(`${llmFailureMessage}; using transcript without AI cleanup.`);
          llmProvider = undefined;
        }
      }

      this.dictationOwner.assertCurrent(operation);
      const recordingStartedAt = this.session.startedAt;
      const recordingStoppedAt = this.recordingStoppedAt ?? new Date().toISOString();
      const recordingDurationMs = computeDurationMs(recordingStartedAt, recordingStoppedAt);
      const rawWordCount = countWords(transcription.text);
      const processedWordCount = countWords(processedText);
      const shouldPasteOutput = plan.source !== "onboarding";
      const pasteResult = shouldPasteOutput
        ? await this.pasteProcessedText(operation, processedText)
        : { pasted: true, message: "" };
      this.dictationOwner.assertCurrent(operation);

      const item: DictationHistoryItem = {
        id: createId("dictation"),
        audioPath: null,
        rawTranscript: transcription.text,
        processedOutput: processedText,
        modeId: mode.id,
        modeName: mode.name,
        transcriptionProviderId: sttProvider.id,
        transcriptionProviderType: sttProvider.type,
        transcriptionModel: transcription.model,
        transcriptionProviderCloud: sttProvider.isCloud,
        transcriptionStreamingMode: transcription.streamingMode,
        transcriptionAccelerator: transcription.accelerator,
        llmProviderId: llmProvider?.id,
        llmProviderType: llmProvider?.type,
        llmModel,
        llmProviderCloud: Boolean(llmProvider?.isCloud),
        appName: context.appName,
        appId: context.appId,
        windowTitle: context.windowTitle,
        createdAt: new Date().toISOString(),
        recordingStartedAt,
        recordingStoppedAt,
        recordingDurationMs,
        rawWordCount,
        processedWordCount
      };
      if (shouldPersistDictationHistory(plan.source)) {
        this.storage.addHistory(item);
      }
      this.dictationOwner.assertCurrent(operation);

      const completedSessionId = this.session.id;
      this.invalidateDictation("completed");
      this.session = {
        ...this.session,
        status: "complete",
        transcriptPreview: processedText,
        error: pasteResult.pasted ? llmFailureMessage : pasteResult.message
      };
      this.pushToTalkPressed = false;
      this.pushToTalkSessionId = null;
      this.hidePillSoon();
      this.broadcastState();
      setTimeout(() => {
        if (this.session.id === completedSessionId && this.session.status === "complete") {
          this.session = { ...defaultSession, modeId: this.storage.getState().settings.activeModeId };
          this.broadcastState();
        }
      }, 1600).unref();
      return this.getSnapshot();
    } catch (error) {
      if (error instanceof StaleDictationSessionError || !this.dictationOwner.isCurrent(operation)) {
        return this.getSnapshot();
      }
      return this.failSession(errorMessage(error), operation);
    }
  }

  private async pasteProcessedText(
    operation: DictationSessionOperation,
    text: string
  ): Promise<{ pasted: boolean; message: string }> {
    this.dictationOwner.assertCurrent(operation);
    this.session = { ...this.session, status: "pasting" };
    this.broadcastState();
    this.hidePill();
    const pasteResult = await this.paste.insertText(text);
    this.dictationOwner.assertCurrent(operation);
    if (!pasteResult.pasted) {
      this.notifyPasteFallback(pasteResult.message);
    }
    return pasteResult;
  }

  private forwardRecordingLevel(payload: unknown): void {
    const result = recordingLevelPayloadSchema.safeParse(payload);
    if (!result.success) return;
    const levelPayload = result.data as RecordingLevelPayload;
    if (this.session.status !== "recording" || levelPayload.sessionId !== this.session.id) return;
    this.pillWindow?.webContents.send("recording:level", levelPayload);
  }

  private handleRecordingError(payload: unknown): AppStateSnapshot {
    const result = recordingErrorPayloadSchema.safeParse(payload);
    if (!result.success) return this.getSnapshot();
    const operation = this.sessionOperation;
    if (
      !operation ||
      !this.dictationOwner.isCurrent(operation) ||
      operation.phase === "processing" ||
      result.data.sessionId !== operation.sessionId ||
      (this.session.status !== "recording" && this.session.status !== "transcribing")
    ) {
      return this.getSnapshot();
    }
    return this.failSession(result.data.message, operation);
  }

  private async reprocessHistory(id: string): Promise<AppStateSnapshot> {
    const state = this.storage.getState();
    const item = state.history.find((candidate) => candidate.id === id);
    if (!item) return this.getSnapshot();

    const mode = state.modes.find((candidate) => candidate.id === state.settings.activeModeId) ?? state.modes[0];
    const selectedProvider = mode.aiEnabled
      ? await selectLlmProviderAfterInitialRefresh(
          this.initialCodexRefresh,
          () => this.selectLlmProvider(state)
        )
      : undefined;
    if (!mode.aiEnabled || !selectedProvider) return this.getSnapshot();
    const provider = this.storage.resolveLlmProviderSecret(selectedProvider);

    const context: ContextSnapshot = {
      appName: item.appName,
      appId: item.appId,
      windowTitle: item.windowTitle,
      capturedAt: new Date().toISOString(),
      sourceQuality: "fallback",
      diagnostics: ["Reprocessed from history."]
    };
    const vocabularyPrompt = buildVocabularyPrompt(state.vocabulary);
    const prompt = buildProcessingPrompt({
      mode,
      context,
      rawTranscript: item.rawTranscript,
      vocabularyPrompt
    });
    const processed = await this.llm.process({ provider, prompt });
    this.storage.updateHistoryItem(id, {
      processedOutput: processed.text,
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

  private failSession(
    message: string,
    operation?: DictationSessionOperation,
    reason: DictationInvalidationReason = "failed"
  ): AppStateSnapshot {
    if (operation && !this.dictationOwner.isCurrent(operation)) return this.getSnapshot();
    this.invalidateDictation(reason);
    this.session = { ...this.session, status: "error", error: message };
    this.pushToTalkPressed = false;
    this.pushToTalkSessionId = null;
    this.hidePillSoon();
    this.broadcastState();
    return this.getSnapshot();
  }

  private invalidateDictation(reason: DictationInvalidationReason): void {
    this.dictationOwner.invalidate(reason);
    this.sessionOperation = null;
    this.sessionContext = null;
    this.pendingContextCapture = null;
    this.recordingStoppedAt = null;
    this.clearRecordingTimers();
  }

  private selectTranscriptionProvider(state: {
    settings: AppSettings;
    transcriptionProviders: TranscriptionProviderConfig[];
    modelLibrary: ModelLibrarySnapshot;
  }): TranscriptionProviderConfig | undefined {
    const activeModel = this.selectActiveModel(state, "voice");
    const activeProvider = activeModel ? transcriptionProviderFromModel(activeModel, state.transcriptionProviders) : null;
    if (activeProvider && this.isTranscriptionProviderUsable(activeProvider)) return activeProvider;
    return state.transcriptionProviders.find((provider) => this.isTranscriptionProviderUsable(provider));
  }

  private selectLlmProvider(state: {
    llmProviders: LlmProviderConfig[];
    modelLibrary: ModelLibrarySnapshot;
  }): LlmProviderConfig | undefined {
    const activeModel = this.selectActiveModel(state, "language");
    const activeProvider = activeModel ? llmProviderFromModel(activeModel, state.llmProviders) : null;
    const providerRuntime = this.getProviderRuntime();
    if (activeProvider && isLlmProviderUsable(activeProvider, providerRuntime)) return activeProvider;
    return state.llmProviders.find((provider) => isLlmProviderUsable(provider, providerRuntime));
  }

  private selectActiveModel(
    state: { settings?: AppSettings; modelLibrary: ModelLibrarySnapshot },
    kind: ModelCatalogItem["kind"]
  ): ModelCatalogItem | undefined {
    const { modelLibrary } = state;
    const modelId = modelLibrary.activeModelIds[kind];
    const item = modelId ? modelLibrary.catalog.find((candidate) => candidate.id === modelId && candidate.kind === kind) : undefined;
    if (!item) return undefined;
    if (item.discovery && !item.discovery.reachable) return undefined;
    if (kind === "voice") {
      const runtimeId = sttRuntimeIdForModel(item);
      if (runtimeId && this.runtimeService.getAutomaticAvailability(runtimeId).status !== "available") {
        return undefined;
      }
    }
    if (item.downloadStrategy === "none") return item;
    return modelLibrary.downloads.some((download) => download.modelId === item.id && download.status === "downloaded") ? item : undefined;
  }

  private isTranscriptionProviderUsable(provider: TranscriptionProviderConfig): boolean {
    if (!isBaseTranscriptionProviderUsable(provider)) return false;
    if (provider.type === "whisper_cpp" && provider.baseUrl === "murmur://runtime/whisper.cpp") {
      return this.bundledProviderUsable(provider, "whisper.cpp");
    }
    if (provider.type === "sherpa_onnx") {
      return this.bundledProviderUsable(provider, "sherpa-onnx");
    }
    return true;
  }

  private bundledProviderUsable(provider: TranscriptionProviderConfig, runtimeId: SttRuntimeId): boolean {
    if (this.runtimeService.getAutomaticAvailability(runtimeId).status !== "available") return false;
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

  private scheduleRecordingMaxDurationStop(sessionId: string): void {
    this.clearRecordingMaxDurationTimer();
    this.recordingMaxDurationTimer = setTimeout(() => {
      this.recordingMaxDurationTimer = null;
      if (this.session.id === sessionId && this.session.status === "recording") {
        void this.stopRecording(maxRecordingDurationNotice);
      }
    }, maxRecordingDurationMs);
    this.recordingMaxDurationTimer.unref();
  }

  private scheduleRecordingStopAckTimeout(sessionId: string): void {
    this.clearRecordingStopAckTimer();
    this.recordingStopAckTimer = setTimeout(() => {
      this.recordingStopAckTimer = null;
      if (this.session.id === sessionId && this.session.status === "transcribing" && !this.session.transcriptPreview) {
        this.failSession("Recording did not finish after stop. Try again.", undefined, "timed_out");
      }
    }, recordingStopAckTimeoutMs);
    this.recordingStopAckTimer.unref();
  }

  private clearRecordingTimers(): void {
    this.clearRecordingMaxDurationTimer();
    this.clearRecordingStopAckTimer();
  }

  private clearRecordingMaxDurationTimer(): void {
    if (!this.recordingMaxDurationTimer) return;
    clearTimeout(this.recordingMaxDurationTimer);
    this.recordingMaxDurationTimer = null;
  }

  private clearRecordingStopAckTimer(): void {
    if (!this.recordingStopAckTimer) return;
    clearTimeout(this.recordingStopAckTimer);
    this.recordingStopAckTimer = null;
  }

  private isPillSessionActive(): boolean {
    return ["recording", "transcribing", "processing", "pasting"].includes(this.session.status);
  }

  private showModeSelectorWindow(): void {
    if (this.isModeSelectorBlocked()) return;

    if (!this.modeSelectorWindow || this.modeSelectorWindow.isDestroyed()) {
      this.createModeSelectorWindow();
    }

    const window = this.modeSelectorWindow;
    if (!window || window.isDestroyed()) return;
    this.configureModeSelectorWindow();
    this.positionModeSelectorWindow();
    window.webContents.send("mode-selector-state:changed", this.getModeSelectorSnapshot());
    this.registerModeSelectorNavigationShortcuts();
    window.show();
    window.focus();
    window.webContents.focus();
  }

  private hideModeSelectorWindow(): void {
    this.unregisterModeSelectorNavigationShortcuts();
    this.modeSelectorWindow?.hide();
  }

  private isModeSelectorBlocked(): boolean {
    return ["recording", "transcribing", "processing", "pasting"].includes(this.session.status);
  }

  private selectModeFromSelector(modeId: string): AppStateSnapshot {
    if (this.isModeSelectorBlocked()) return this.getSnapshot();

    const state = this.storage.getState();
    const mode = state.modes.find((candidate) => candidate.id === modeId);
    if (!mode) return this.getSnapshot();

    this.storage.updateSettings({ activeModeId: mode.id });
    this.session = { ...this.session, modeId: mode.id };
    this.broadcastState();
    this.hideModeSelectorWindow();
    return this.getSnapshot();
  }

  private moveModeSelectorSelection(delta: number): ModeSelectorStateSnapshot {
    if (this.isModeSelectorBlocked()) {
      this.hideModeSelectorWindow();
      return this.getModeSelectorSnapshot();
    }

    const state = this.storage.getState();
    if (state.modes.length === 0) return this.getModeSelectorSnapshot();

    const activeIndex = Math.max(
      0,
      state.modes.findIndex((mode) => mode.id === state.settings.activeModeId)
    );
    const direction = Math.sign(delta);
    const nextIndex = wrapIndex(activeIndex + (direction === 0 ? 1 : direction), state.modes.length);
    const nextMode = state.modes[nextIndex];
    if (!nextMode) return this.getModeSelectorSnapshot();

    this.storage.updateSettings({ activeModeId: nextMode.id });
    this.session = { ...this.session, modeId: nextMode.id };
    this.broadcastState();
    const snapshot = this.getModeSelectorSnapshot(this.getSnapshot());
    return snapshot;
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

  private configureModeSelectorWindow(): void {
    if (!this.modeSelectorWindow) return;
    this.modeSelectorWindow.setFocusable(true);
    this.modeSelectorWindow.setSkipTaskbar(true);
    this.modeSelectorWindow.setAlwaysOnTop(true);
    this.modeSelectorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.positionModeSelectorWindow();
  }

  private registerModeSelectorNavigationShortcuts(): void {
    this.unregisterModeSelectorNavigationShortcuts();

    const registration = registerModeSelectorNavigationShortcuts(globalShortcut, {
      hide: () => {
        this.hideModeSelectorWindow();
      },
      next: () => {
        if (!this.modeSelectorWindow?.isVisible()) return;
        this.moveModeSelectorSelection(1);
      },
      previous: () => {
        if (!this.modeSelectorWindow?.isVisible()) return;
        this.moveModeSelectorSelection(-1);
      }
    });

    if (registration.diagnostics.length > 0) {
      console.warn(`Mode selector navigation shortcuts were not fully registered: ${registration.diagnostics.join(" ")}`);
    }

    this.modeSelectorNavigationShortcutCleanup = registration.unregister;
  }

  private unregisterModeSelectorNavigationShortcuts(): void {
    this.modeSelectorNavigationShortcutCleanup?.();
    this.modeSelectorNavigationShortcutCleanup = null;
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

  private positionModeSelectorWindow(): void {
    if (!this.modeSelectorWindow) return;

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;

    this.modeSelectorWindow.setBounds({
      x: Math.round(x + (width - modeSelectorWindowSize) / 2),
      y: Math.round(y + (height - modeSelectorWindowSize) / 2),
      width: modeSelectorWindowSize,
      height: modeSelectorWindowSize
    });
  }

  private getSnapshot(): AppStateSnapshot {
    const state = this.storage.getState();
    return {
      ...state,
      sttSetup: this.sttSetup.getSnapshot(),
      session: this.session,
      capabilities: this.getCapabilities(),
      providerRuntime: this.getProviderRuntime()
    };
  }

  private getProviderRuntime(): ProviderRuntimeSnapshot {
    return {
      codex: this.codex.getStatus()
    };
  }

  private getPillSnapshot(snapshot?: AppStateSnapshot): PillStateSnapshot {
    return {
      session: this.session,
      theme: snapshot?.settings.theme ?? this.storage.getSettings().theme
    };
  }

  private getModeSelectorSnapshot(snapshot?: AppStateSnapshot): ModeSelectorStateSnapshot {
    const state = snapshot ?? this.getSnapshot();
    return {
      theme: state.settings.theme,
      modes: state.modes,
      activeModeId: state.settings.activeModeId,
      session: this.session
    };
  }

  private getCapabilities(): CapabilityReport {
    const contextFlags = this.context.getCapabilityFlags();
    const pasteCapability = this.textAutomation.getCapability();
    return {
      sttRuntimes: this.runtimeService.getAvailabilities(),
      stt: {
        diagnostics: this.stt.getDiagnostics(),
        accelerationProbe: this.accelerationProbe.getReport()
      },
      hotkeys: {
        backend: this.hotkeyBackend,
        pushToTalkRelease: this.hotkeyPushToTalkRelease,
        registered: this.hotkeyRegistered,
        triggerDescription: this.hotkeyTriggerDescription,
        diagnostics: this.hotkeyDiagnostics,
        modeSelector: {
          registered: this.modeSelectorHotkeyRegistered,
          triggerDescription: this.modeSelectorHotkeyTriggerDescription,
          diagnostics: this.modeSelectorHotkeyDiagnostics
        }
      },
      context: {
        backend: contextFlags.appMetadata ? "desktop_metadata" : "clipboard_fallback",
        appMetadata: contextFlags.appMetadata,
        selectedText: contextFlags.selectedText,
        diagnostics: this.context.getDiagnostics()
      },
      automation: this.automationPermissions.getReport(),
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
    if (this.isModeSelectorBlocked()) this.hideModeSelectorWindow();
    this.mainWindow?.webContents.send("state:changed", snapshot);
    this.pillWindow?.webContents.send("pill-state:changed", this.getPillSnapshot(snapshot));
    this.modeSelectorWindow?.webContents.send("mode-selector-state:changed", this.getModeSelectorSnapshot(snapshot));
  }
}

export async function selectLlmProviderAfterInitialRefresh(
  initialRefresh: Promise<unknown>,
  selectProvider: () => LlmProviderConfig | undefined
): Promise<LlmProviderConfig | undefined> {
  await initialRefresh;
  return selectProvider();
}

export function computeDurationMs(startedAt: string | undefined, stoppedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const stop = new Date(stoppedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return undefined;
  return Math.max(0, stop - start);
}

export function shouldPersistDictationHistory(source: RecordingSource): boolean {
  return source !== "onboarding";
}

function parseIpcPayload<T>(schema: z.ZodType<T>, payload: unknown, channel: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new IpcValidationError(channel);
  }
  return result.data;
}

class IpcValidationError extends Error {
  constructor(channel: string) {
    super(`Invalid IPC payload for ${channel}.`);
    this.name = "IpcValidationError";
  }
}

class IpcAuthorizationError extends Error {
  constructor(channel: string) {
    super(`Unauthorized IPC sender for ${channel}.`);
    this.name = "IpcAuthorizationError";
  }
}

function unavailableContext(message: string): ContextSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    sourceQuality: "unavailable",
    diagnostics: [message]
  };
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function rendererQueryFromSuffix(suffix: string): Record<string, string> | undefined {
  if (!suffix) return undefined;
  const params = new URLSearchParams(suffix.startsWith("?") ? suffix.slice(1) : suffix);
  const query: Record<string, string> = {};
  for (const [key, value] of params) query[key] = value;
  return Object.keys(query).length > 0 ? query : undefined;
}

function rendererUrlWithSuffix(baseUrl: string, suffix: string): string {
  if (!suffix) return baseUrl;
  const url = new URL(baseUrl);
  const params = new URLSearchParams(suffix.startsWith("?") ? suffix.slice(1) : suffix);
  for (const [key, value] of params) url.searchParams.set(key, value);
  return url.toString();
}

export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}
