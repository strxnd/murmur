# Troubleshooting

## No STT Provider Is Ready

Murmur blocks recording when no enabled STT provider or local voice model is usable.

- Complete the local setup flow from [local STT setup](local-stt.md).
- Confirm the selected local model is downloaded.
- Confirm the required runtime is ready in the setup or models view.
- If using a cloud provider, confirm the provider is enabled and has an API key.

## Output Is Copied But Not Pasted

Paste automation writes output to the clipboard first, then sends a paste shortcut through the best available backend. If automation fails, the output remains on the clipboard.

On Linux, install or enable one of the supported automation backends:

- Build the native helper with `mise run linux-helper:build`.
- Install `wtype` for wlroots Wayland compositors.
- Install `xdotool` for X11 or XWayland targets.
- Use `ydotool` only when `ydotoold` and `/dev/uinput` access are configured.
- Use the XDG RemoteDesktop keyboard portal when available.

## Selected Text Is Not Captured

Selected-text capture uses clipboard restore plus text automation. It is skipped when automation is unavailable or when selected-text capture is disabled in settings.

## Local Runtime Is Missing

For development, run:

```sh
mise run runtimes:prepare
mise run runtimes:doctor
```

For managed installs, use the in-app runtime setup flow or repair action. Runtime lookup and environment overrides are documented in [environment variables](../reference/environment-variables.md).
