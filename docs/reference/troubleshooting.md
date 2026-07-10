# Reference Troubleshooting

This page is a maintainer-oriented checklist for common failure areas.

## Startup

- On Linux Wayland, confirm the app relaunched with `--ozone-platform=x11` or `MURMUR_XWAYLAND_RELAUNCHED=1`.
- If the renderer fails to load in development, confirm `ELECTRON_RENDERER_URL` points at the trusted localhost Vite dev server. Packaged builds ignore this variable.
- If a second instance does not show the window, check single-instance lock handling in `app-main.ts`.

## Hotkeys

- Inspect `capabilities.hotkeys` in `AppStateSnapshot`.
- Check diagnostics for portal, native desktop, and Electron fallback registration.
- During hotkey capture, registration is intentionally suspended and diagnostics report capture activity.
- Push-to-talk release requires a backend that reports release support.

## STT

- `sttSetup.needsSetup` means no usable STT provider or active local voice model is ready.
- Check `capabilities.sttRuntimes` for runtime variant status and source.
- Check `capabilities.stt.accelerationProbe` for advisory NVIDIA acceleration detection. Launch and transcription success are the source of truth.
- For bundled Whisper, confirm the model exists under `modelDir` and the runtime can start `whisper-server`.
- For Sherpa ONNX, confirm `tokens.txt` plus CTC or transducer ONNX files are present.
- Sherpa ONNX supports CPU and CUDA in this version; macOS Sherpa runtimes are CPU-only.
- Use [runtime builds](../development/runtime-builds.md) for direct runtime smoke tests.

## Providers

- Cloud providers need API keys before validation.
- OpenAI-compatible validation checks `/models` where applicable.
- LLM failure during dictation falls back to transcript text; STT failure fails the session.

## Paste and Context

- Inspect `capabilities.paste` and `capabilities.context`.
- Selected-text capture requires text automation availability and `selectedTextCapture !== "disabled"`.
- On macOS, `capabilities.automation` reports Accessibility permission status. Window titles, selected text, paste automation, and push-to-talk release detection require trusted Accessibility plus the bundled helper.
- Paste always writes output to the clipboard first; automation failure leaves the output there.
- Clipboard restore is used for Linux selected-text capture, not final paste. macOS selected-text capture uses Accessibility APIs and does not copy through the clipboard.

## Storage

- `capabilities.storage.backend` reports `sqlite` or `json`.
- SQLite initialization failure falls back to JSON history.
- `clearLocalData()` removes config, history, and any legacy audio files linked from history, but not downloaded models or runtime cache.
