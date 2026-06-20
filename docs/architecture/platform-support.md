# Platform Support

Murmur is Linux-first for desktop automation. Some runtime and provider code is portable, but global hotkeys, active-window metadata, selected-text capture, and paste automation are implemented around Linux desktop sessions.

## Linux Startup

On Linux Wayland, [`src/main/index.ts`](../../src/main/index.ts) relaunches Electron with `--ozone-platform=x11` unless it has already been relaunched. Packaged Linux builds also use [`scripts/after-pack.cjs`](../../scripts/after-pack.cjs) to wrap the app binary with a launcher that forces XWayland and reads optional user flags from:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/<binary-name>-flags.conf
```

## Hotkeys

Hotkey backends are attempted in this order:

- XDG Global Shortcuts portal.
- Native Linux desktop shortcuts for GNOME, KDE, and Hyprland where detected.
- Electron `globalShortcut`.

Backends report whether push-to-talk release events are supported.

## Context Metadata

Linux metadata providers are detected from session and desktop environment variables plus command availability:

- X11 requires `xdotool` and `xprop`.
- Hyprland requires `hyprctl`.
- GNOME requires `gdbus` and Shell Eval access.
- KDE requires `qdbus` or `qdbus6` plus a D-Bus session bus.

## Text Automation

Text automation backends include the native helper, `wtype`, `xdotool`, `ydotool`, and XDG RemoteDesktop keyboard portal. On non-Linux platforms, automation is unavailable and paste falls back to clipboard behavior.

## STT Runtime Platform Keys

Managed local STT runtime archives are cataloged for:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

This runtime support does not imply full desktop automation support on every platform.
