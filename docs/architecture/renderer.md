# Renderer

Renderer entrypoints:

- [`src/renderer/src/main.tsx`](../../apps/desktop/src/renderer/src/main.tsx) mounts React.
- [`src/renderer/src/app/App.tsx`](../../apps/desktop/src/renderer/src/app/App.tsx) chooses the main shell or recording pill.
- [`src/renderer/src/app/AppShell.tsx`](../../apps/desktop/src/renderer/src/app/AppShell.tsx) renders the tabbed app frame.
- [`src/renderer/src/state/murmur-store.ts`](../../apps/desktop/src/renderer/src/state/murmur-store.ts) owns client state.
- [`src/renderer/src/hooks/useRecordingBridge.ts`](../../apps/desktop/src/renderer/src/hooks/useRecordingBridge.ts) records and encodes WAV audio.

## State

The Zustand store initializes by calling `murmurClient.getState()`, then subscribes to:

- `state:changed`
- `models:download-progress`
- `stt-runtime:progress`

Store actions call `murmurClient` methods and commit returned snapshots. Model and runtime progress events update the relevant nested portion of the current snapshot without waiting for a full state broadcast.

## Views

`AppShell` uses Base UI tabs and renders:

- `HomeView`
- `ModesView`
- `VocabularyView`
- `ConfigurationView`
- `ModelsLibraryView`
- `HistoryView`

The same renderer bundle is used for the recording pill. `App.tsx` checks `window.location.search` for `pill` and renders `RecordingPill` when present.

## Recording Bridge

`useRecordingBridge` only runs in the main renderer window. On `recording:start`, it calls `navigator.mediaDevices.getUserMedia`, creates an `AudioContext`, merges input channels to mono, publishes smoothed levels every 50 ms, and stores Float32 chunks. On `recording:stop`, it encodes a mono 16-bit PCM WAV and sends it to `dictation:complete-recording`.

Failure modes:

- Browser microphone permission or device errors reject recording startup.
- If a session is cancelled, chunks are discarded and no audio is sent to the main process.
- The hook ignores stale completions whose session id no longer matches the active session.
