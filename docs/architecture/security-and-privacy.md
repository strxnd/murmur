# Security and Privacy

Murmur keeps the renderer isolated from Node and Electron internals:

- Main windows use `contextIsolation: true`.
- `nodeIntegration` is disabled.
- The preload bridge exposes only the methods in `window.murmur`.
- Renderer responses are parsed through schemas in [`src/renderer/src/lib/murmur-client.ts`](../../src/renderer/src/lib/murmur-client.ts).

## Local-Only Mode

When `settings.localOnly` is true, cloud STT and cloud LLM providers are blocked. Provider configuration remains stored, but selection and invocation reject cloud providers.

## API Keys

Provider configs include optional `apiKey` and `apiKeySecretId` fields. Current storage persists provider config in `murmur-config.json`; do not commit local config files or secrets.

## Audio and History

Retained audio is opt-in through `settings.retainAudio`. When enabled, completed recordings are written under the app data audio directory and referenced from history. Deleting a history item or clearing history removes retained audio files whose paths are inside that audio directory.

History text is persisted locally in SQLite or JSON. Text retention settings are part of `AppSettings`, but current storage writes and reads the latest 2000 history items.

## Clipboard Behavior

Selected-text capture temporarily writes a sentinel to the clipboard, sends copy, reads clipboard or primary selection, and restores the original clipboard snapshot including text, HTML, RTF, and image content when present.

Paste writes the final output to the clipboard and then sends a paste shortcut. If automation fails, the final output stays on the clipboard by design.

## External Services

Cloud STT and LLM providers receive audio or prompt text only when enabled and selected, and when local-only mode is disabled. Local services such as Ollama, LM Studio, external whisper.cpp, and local OpenAI-compatible STT run outside Murmur and are addressed by configured URLs.
