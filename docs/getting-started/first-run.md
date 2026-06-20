# First Run

On startup, Murmur creates a main window, tray icon, and hidden recording pill window. Closing the main window hides it to the tray; using the tray menu quits the app.

## Basic Flow

1. Start the app with `mise run dev` or a packaged build.
2. Open **Configuration** and confirm the activation hotkey and audio input.
3. Configure a speech-to-text provider or use the local setup flow from [local STT setup](local-stt.md).
4. Press the activation hotkey or use the in-app controls to start dictation.
5. Press the hotkey again, release push-to-talk, or stop manually to finish recording.

## Modes

Murmur ships with built-in modes for default dictation, direct voice-to-text, messages, mail, and notes. Modes control whether AI cleanup is used, the instruction prompt, language, examples, and what context can be included.

Auto-mode rules can switch modes based on captured app metadata such as app id, app name, window title, or browser domain when that metadata is available.

## Local-Only Mode

When local-only mode is enabled, cloud STT and cloud LLM providers are blocked. Local-only mode still requires at least one usable local STT provider or active local voice model.
