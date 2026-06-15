import { app, globalShortcut, Menu } from "./electron-api";
import { AppController } from "./app-controller";

if (process.platform === "linux") {
  const linuxApp = app as typeof app & { setDesktopName?: (desktopName: string) => void };
  linuxApp.setDesktopName?.("dev.murmur.app.desktop");
}

Menu.setApplicationMenu(null);

let controller: AppController | null = null;
let controllerInitialization: Promise<AppController> | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showControllerWindow();
  });

  app.whenReady().then(() => ensureController()).catch(handleControllerError);

  app.on("before-quit", () => {
    controller?.prepareToQuit();
  });

  app.on("window-all-closed", () => {
    // The main window normally hides to the tray; explicit Quit Murmur exits the app.
  });

  app.on("activate", () => {
    showControllerWindow();
  });

  app.on("will-quit", () => {
    // Registered shortcuts are process-scoped and must be released on shutdown.
    globalShortcut.unregisterAll();
    controller?.dispose();
    controller = null;
    controllerInitialization = null;
  });
}

function showControllerWindow(): void {
  void ensureController().then((activeController) => activeController.showMainWindow()).catch(handleControllerError);
}

function handleControllerError(error: unknown): void {
  console.error(`Failed to initialize Murmur: ${error instanceof Error ? error.message : String(error)}`);
  app.quit();
}

async function ensureController(): Promise<AppController> {
  if (controller) return controller;
  if (!controllerInitialization) {
    controllerInitialization = app.whenReady().then(async () => {
      const activeController = new AppController();
      try {
        await activeController.initialize();
        controller = activeController;
        return activeController;
      } catch (error) {
        activeController.dispose();
        controller = null;
        controllerInitialization = null;
        throw error;
      }
    });
  }
  return controllerInitialization;
}
