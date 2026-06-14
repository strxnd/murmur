const electronApi = require("electron") as typeof import("electron");

export const app = electronApi.app;
export const BrowserWindow = electronApi.BrowserWindow;
export const clipboard = electronApi.clipboard;
export const globalShortcut = electronApi.globalShortcut;
export const ipcMain = electronApi.ipcMain;
export const Menu = electronApi.Menu;
export const nativeTheme = electronApi.nativeTheme;
export const screen = electronApi.screen;
