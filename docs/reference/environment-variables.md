# Environment Variables

This page lists environment variables used by current code paths.

## Murmur Overrides

| Variable | Used by | Effect |
| --- | --- | --- |
| `MURMUR_WHISPER_CPP_SERVER` | `SttRuntimeService` | Path to a `whisper-server` binary. Highest-priority `whisper.cpp` runtime candidate. |
| `MURMUR_WHISPER_CPP_CUDA_SERVER` | `SttRuntimeService` | Path to a CUDA-enabled `whisper-server` binary. Highest-priority `whisper.cpp` CUDA candidate. |
| `MURMUR_SHERPA_ONNX_OFFLINE` | `SttRuntimeService` | Path to a `sherpa-onnx-offline` binary. Highest-priority Sherpa ONNX runtime candidate. |
| `MURMUR_SHERPA_ONNX_CUDA_OFFLINE` | `SttRuntimeService` | Path to a CUDA/cuDNN-enabled `sherpa-onnx-offline` binary. Highest-priority Sherpa ONNX CUDA candidate. |
| `MURMUR_STT_THREADS` | STT runtime args | Thread count passed to `whisper-server` and `sherpa-onnx-offline`. Defaults to `4`. |
| `MURMUR_STT_GPU_DEVICE` | STT runtime args | Optional GPU device id passed to `whisper-server` GPU variants. |
| `MURMUR_RUNTIME_PLATFORM` | `scripts/stage-bundled-runtimes.mjs` | Runtime platform key or `linux`/`darwin` platform used when `--platform` is not passed. Defaults to `current`. |
| `MURMUR_RUNTIME_ARCH` | `scripts/stage-bundled-runtimes.mjs` | Runtime architecture used with `MURMUR_RUNTIME_PLATFORM=linux` or `darwin` when `--arch` is not passed. Accepts `x64`, `arm64`, `amd64`, or `aarch64`. |
| `MURMUR_RUNTIME_VENDOR_ROOT` | `scripts/stage-bundled-runtimes.mjs` | Override the prepared runtime input root. Defaults to `vendor/runtimes`. |
| `MURMUR_RUNTIME_STAGING_ROOT` | `scripts/stage-bundled-runtimes.mjs` | Override the packaged runtime staging root. Defaults to `.cache/bundled-runtimes/runtimes`. Custom roots must be a `runtimes` leaf whose parent contains a `.murmur-runtime-staging-parent` marker with `murmur-runtime-staging-v1` as its contents. |
| `MURMUR_RUNTIME_READY_TIMEOUT_MS` | `TranscriptionService` | Timeout for `whisper-server` readiness. Defaults to `45000`. |
| `MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS` | `TranscriptionService`, `LlmService` | Total response timeout for STT and LLM HTTP provider calls. |
| `MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS` | `TranscriptionService`, `LlmService` | Idle response timeout for STT and LLM HTTP provider calls. |
| `MURMUR_LINUX_FAST_PASTE` | `LinuxTextAutomationService` | Path to the optional native Linux text automation helper. |
| `MURMUR_XWAYLAND_RELAUNCHED` | Main startup and packaged launcher | Internal guard indicating the Linux Wayland app has already been relaunched under XWayland. |

## Development and Electron

| Variable | Used by | Effect |
| --- | --- | --- |
| `ELECTRON_RENDERER_URL` | `AppController.loadRenderer()` | In non-packaged builds, loads the renderer from a trusted localhost dev server instead of built HTML. Ignored in packaged builds. |
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
