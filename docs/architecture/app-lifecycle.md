# App Lifecycle

[`src/main/index.ts`](../../apps/desktop/src/main/index.ts) is the production main entrypoint. On Linux Wayland it relaunches the app with `--ozone-platform=x11` unless that flag is already present or `MURMUR_XWAYLAND_RELAUNCHED=1` is set. It then loads [`src/main/app-main.ts`](../../apps/desktop/src/main/app-main.ts).

## Startup

`app-main.ts`:

- Sets the Linux desktop name to `dev.murmur.app.desktop` when Electron exposes `setDesktopName`.
- Removes the application menu.
- Acquires Electron's single-instance lock.
- Initializes one `AppController` after `app.whenReady()`.
- Shows the existing window on a second-instance event.

`AppController.initialize()`:

- Initializes text automation, context capture, and paste services.
- Registers IPC handlers.
- Creates the tray, main window, and hidden recording pill window.
- Applies persisted settings such as theme.
- Registers global hotkeys.

## App Windows

The main window is a normal Electron `BrowserWindow` with context isolation enabled, node integration disabled, and the preload script loaded from `out/preload/index.cjs`.

The recording pill is a separate frameless, transparent, always-on-top window. It loads the same renderer with `?pill=1`; the renderer switches to `RecordingPill` based on that query parameter.

## Tray and Quit

Closing the main window hides it to the tray unless the app is quitting. The first close-to-tray action records `trayCloseNoticeShownAt` and may show a notification. The tray menu can show or hide Murmur and can quit the app.

`will-quit` unregisters global shortcuts and disposes services. `before-quit` marks the controller as quitting so window close handlers do not hide the app again.

## Hotkeys

Hotkey registration tries these backends in order:

1. XDG Global Shortcuts portal.
2. Native desktop shortcuts for supported Linux desktops.
3. Electron `globalShortcut`.

Push-to-talk release behavior is only available when the selected backend exposes release events. Otherwise push-to-talk uses press-to-start and press-to-stop behavior and reports a diagnostic.
