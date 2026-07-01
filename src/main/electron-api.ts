const electronApi = require("electron") as typeof import("electron");

export const app = electronApi.app;
export const BrowserWindow = electronApi.BrowserWindow;
export const clipboard = electronApi.clipboard;
export const globalShortcut = electronApi.globalShortcut;
export const ipcMain = electronApi.ipcMain;
export const Menu = electronApi.Menu;
export const nativeImage = electronApi.nativeImage;
export const nativeTheme = electronApi.nativeTheme;
export const Notification = electronApi.Notification;
export const screen = electronApi.screen;
export const safeStorage = electronApi.safeStorage;
export const Tray = electronApi.Tray;
export const dialog = electronApi.dialog;
export const systemPreferences = electronApi.systemPreferences;
