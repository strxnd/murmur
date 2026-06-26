# First Run

On startup, Murmur creates a main window, tray icon, and hidden recording pill window. Closing the main window hides it to the tray; using the tray menu quits the app.

## Basic Flow

1. Start the app with `mise run dev` or a packaged build.
2. Complete the first-time setup wizard for microphone access, local speech-to-text setup, hotkey registration, paste capability, and a test dictation.
3. Open **Configuration** later to change the activation hotkey or audio input.
4. Press the activation hotkey or use the in-app controls to start dictation.
5. Press the hotkey again, release push-to-talk, or stop manually to finish recording.

## Modes

Murmur ships with built-in modes for default dictation, direct voice-to-text, messages, mail, and notes. Modes control whether AI cleanup is used, the instruction prompt, language, examples, and what context can be included.

Auto-mode rules can switch modes based on captured app metadata such as app id, app name, window title, or browser domain when that metadata is available.
