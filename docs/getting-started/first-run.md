# First Run

On startup, Murmur creates a main window, tray icon, and hidden recording pill window. Closing the main window hides it to the tray; using the tray menu quits the app.

## Basic Flow

1. Start the app with `bun run dev` or a packaged build.
2. Complete the first-time setup wizard:
   - **Microphone**: choose an input device and allow capture.
   - **STT Model**: pick and set up a downloadable local voice model backed by whisper.cpp or Sherpa ONNX.
   - **Hotkey & Test**: save the activation shortcut and run a transcription test with the in-wizard Start button or the configured global hotkey. On macOS, this step may request Accessibility permission.
   - **READY TO GO**: confirm the completed checks and finish onboarding.
3. Open **Configuration** later to change the activation hotkey or audio input.
4. Press the activation hotkey or use the in-app controls to start dictation.
5. Press the hotkey again, release push-to-talk, or stop manually to finish recording.

## Modes

Murmur ships with built-in modes for default dictation, direct voice-to-text, messages, mail, and notes. Modes control whether AI cleanup is used, the instruction prompt, language, examples, and what context can be included.

Auto-mode rules can switch modes based on captured app metadata such as app id, app name, or window title when that metadata is available.
