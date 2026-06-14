import { app, BrowserWindow, globalShortcut, Menu } from "./electron-api";
import { AppController } from "./app-controller";

app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
Menu.setApplicationMenu(null);

let controller: AppController | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  const windows = BrowserWindow.getAllWindows();
  const mainWindow = windows.find((window) => window.getTitle() === "Murmur");
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  controller = new AppController();
  await controller.initialize();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    controller = new AppController();
    await controller.initialize();
  }
});

app.on("will-quit", () => {
  // Registered shortcuts are process-scoped and must be released on shutdown.
  globalShortcut.unregisterAll();
  controller?.dispose();
});
