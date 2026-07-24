import { murmurLinuxDesktopName } from "../shared/app-identity";
import { app, dialog, globalShortcut, Menu } from "./electron-api";
import { AppController } from "./app-controller";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./services/platform-support";

if (!isSupportedPlatform(process.platform)) {
  const message = unsupportedPlatformMessage(process.platform);
  app.whenReady()
    .then(() => {
      dialog.showErrorBox("Unsupported platform", message);
      app.quit();
    })
    .catch(() => app.quit());
} else if (process.platform === "linux") {
  const linuxApp = app as typeof app & { setDesktopName?: (desktopName: string) => void };
  linuxApp.setDesktopName?.(murmurLinuxDesktopName);

  startApp();
} else {
  startApp();
}

let controller: AppController | null = null;
let controllerInitialization: Promise<AppController> | null = null;
let shutdownPromise: Promise<void> | null = null;
let shutdownStarted = false;
let shutdownComplete = false;

function startApp(): void {
  Menu.setApplicationMenu(null);

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (!shutdownStarted) showControllerWindow();
  });

  app.whenReady().then(() => ensureController()).catch(handleControllerError);

  app.on("before-quit", () => {
    controller?.prepareToQuit();
  });

  app.on("window-all-closed", () => {
    // The main window normally hides to the tray; explicit Quit Murmur exits the app.
  });

  app.on("activate", () => {
    if (!shutdownStarted) showControllerWindow();
  });

  app.on("will-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;

    // Registered shortcuts are process-scoped and must be released on shutdown.
    globalShortcut.unregisterAll();
    const activeController = controller;
    controller = null;
    controllerInitialization = null;
    shutdownPromise = disposeControllerWithin(activeController, 10000)
      .catch((error) => console.error(`Failed to dispose Murmur: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        shutdownComplete = true;
        app.quit();
      });
  });
}

function showControllerWindow(): void {
  if (shutdownStarted) return;
  void ensureController().then((activeController) => activeController.showMainWindow()).catch(handleControllerError);
}

function handleControllerError(error: unknown): void {
  if (shutdownStarted) return;
  console.error(`Failed to initialize Murmur: ${error instanceof Error ? error.message : String(error)}`);
  app.quit();
}

async function ensureController(): Promise<AppController> {
  if (shutdownStarted) throw new Error("Murmur is shutting down.");
  if (controllerInitialization) return controllerInitialization;

  controllerInitialization = app.whenReady().then(async () => {
    const activeController = new AppController();
    controller = activeController;
    try {
      await activeController.initialize();
      return activeController;
    } catch (error) {
      activeController.prepareToQuit();
      try {
        await activeController.dispose();
      } catch (cleanupError) {
        console.error(
          `Failed to clean up incomplete Murmur startup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      } finally {
        if (controller === activeController) controller = null;
        controllerInitialization = null;
      }
      throw error;
    }
  });
  return controllerInitialization;
}

export async function disposeControllerWithin(
  activeController: Pick<AppController, "dispose"> | null,
  timeoutMs: number
): Promise<void> {
  if (!activeController) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      activeController.dispose(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Murmur shutdown exceeded ${timeoutMs}ms.`)), timeoutMs);
        timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
