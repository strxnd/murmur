# Security and Privacy

Murmur keeps the renderer isolated from Node and Electron internals:

- Main windows use `contextIsolation: true`.
- `nodeIntegration` is disabled.
- The preload bridge exposes only the methods in `window.murmur`.
- Renderer responses are parsed through schemas in [`src/renderer/src/lib/murmur-client.ts`](../../apps/desktop/src/renderer/src/lib/murmur-client.ts).

## Cloud Providers

Cloud STT and LLM providers are opt-in through provider configuration. They are selected only when enabled and, for cloud providers, configured with an API key.

## API Keys

Provider configs include optional `apiKey` and `apiKeySecretId` fields. Current storage migrates raw provider API keys out of `murmur-config.json` into `murmur-provider-secrets.json`, then persists redacted provider configs with `apiKeySecretId`. The secret store uses Electron safe storage when available and falls back to owner-only plaintext storage otherwise. Do not commit local config files or secret files.

## Audio and History

Completed recording audio is not stored in history. History entries keep transcript text and provider metadata; older entries with audio paths are still cleaned up when deleted or when history is cleared.

History text is persisted locally in SQLite or JSON. Text retention settings are part of `AppSettings`, but current storage writes and reads the latest 2000 history items.

## Clipboard Behavior

Selected-text capture temporarily writes a sentinel to the clipboard, sends copy, reads clipboard or primary selection, and restores the original clipboard snapshot including text, HTML, RTF, and image content when present.

Paste writes the final output to the clipboard and then sends a paste shortcut. If automation fails, the final output stays on the clipboard by design.

## External Services

Cloud STT and LLM providers receive audio or prompt text only when enabled, selected, and credentialed. Local services such as Ollama, LM Studio, external whisper.cpp, and local OpenAI-compatible STT run outside Murmur and are addressed by configured URLs.
