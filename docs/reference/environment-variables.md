# Environment Variables

This page lists environment variables used by current code paths.

## Murmur Overrides

| Variable | Used by | Effect |
| --- | --- | --- |
| `MURMUR_WHISPER_CPP_SERVER` | `SttRuntimeService` | Path to a `whisper-server` binary. Highest-priority `whisper.cpp` runtime candidate. |
| `MURMUR_SHERPA_ONNX_OFFLINE` | `SttRuntimeService` | Path to a `sherpa-onnx-offline` binary. Highest-priority Sherpa ONNX runtime candidate. |
| `MURMUR_STT_THREADS` | STT runtime args | Thread count passed to `whisper-server` and `sherpa-onnx-offline`. Defaults to `4`. |
| `MURMUR_RUNTIME_READY_TIMEOUT_MS` | `TranscriptionService` | Timeout for `whisper-server` readiness. Defaults to `45000`. |
| `MURMUR_LINUX_FAST_PASTE` | `LinuxTextAutomationService` | Path to the optional native Linux text automation helper. |
| `MURMUR_XWAYLAND_RELAUNCHED` | Main startup and packaged launcher | Internal guard indicating the Linux Wayland app has already been relaunched under XWayland. |

## Development and Electron

| Variable | Used by | Effect |
| --- | --- | --- |
| `ELECTRON_RENDERER_URL` | `AppController.loadRenderer()` | Loads the renderer from a dev server instead of built HTML. |
| `CC` | `scripts/build-linux-fast-paste.mjs` | C compiler for the optional native Linux helper. Defaults to `cc`. |

## XDG Paths

| Variable | Used by | Effect |
| --- | --- | --- |
| `XDG_CONFIG_HOME` | `resolveAppPaths()` | Absolute override for config base. |
| `XDG_DATA_HOME` | `resolveAppPaths()` | Absolute override for data base. |
| `XDG_CACHE_HOME` | `resolveAppPaths()` | Absolute override for cache base. |

Relative XDG path values are ignored.

## Linux Desktop Detection

| Variable | Used by | Effect |
| --- | --- | --- |
| `XDG_SESSION_TYPE` | Startup, hotkeys, context, automation | Detects Wayland or X11 session behavior. |
| `WAYLAND_DISPLAY` | Startup and clipboard tooling | Indicates Wayland display availability. |
| `DISPLAY` | Linux clipboard and automation tooling | Indicates X11 or XWayland display availability. |
| `XDG_CURRENT_DESKTOP` | Hotkey, context, automation detection | Helps detect GNOME, KDE, Hyprland, wlroots, and desktop-specific behavior. |
| `DESKTOP_SESSION` | Linux desktop target detection | Additional desktop-environment signal. |
| `HYPRLAND_INSTANCE_SIGNATURE` | Hotkey/context detection | Helps detect Hyprland. |
| `DBUS_SESSION_BUS_ADDRESS` | XDG portal, GNOME, KDE | Required for several D-Bus backed desktop integrations. |
