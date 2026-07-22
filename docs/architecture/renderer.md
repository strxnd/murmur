# Renderer

Renderer entrypoints:

- [`src/renderer/src/main.tsx`](../../apps/desktop/src/renderer/src/main.tsx) mounts React.
- [`src/renderer/src/app/App.tsx`](../../apps/desktop/src/renderer/src/app/App.tsx) chooses the main app, recording pill, or mode selector.
- [`src/renderer/src/app/main-router.tsx`](../../apps/desktop/src/renderer/src/app/main-router.tsx) defines main-window TanStack Router routes.
- [`src/renderer/src/app/AppShell.tsx`](../../apps/desktop/src/renderer/src/app/AppShell.tsx) renders the main routed app frame.
- [`src/renderer/src/state/murmur-store.ts`](../../apps/desktop/src/renderer/src/state/murmur-store.ts) owns client state.
- [`src/renderer/src/hooks/useRecordingBridge.ts`](../../apps/desktop/src/renderer/src/hooks/useRecordingBridge.ts) records and encodes WAV audio.

The renderer uses React, TanStack Router, Tailwind CSS, native controls, and Radix UI primitives. It remains sandboxed behind the preload bridge and does not import Electron directly.

## State

The Zustand store initializes by calling `murmurClient.getState()`, then subscribes to:

- `state:changed`
- `models:download-progress`
- `stt-runtime:progress`

Store actions call `murmurClient` methods and commit returned snapshots. Model and runtime progress events update the relevant nested portion of the current snapshot without waiting for a full state broadcast.

## Windows and Routes

The same renderer bundle serves three window kinds:

- The main window uses a hash-history TanStack Router.
- `?pill` renders `RecordingPill` with a focused pill-state subscription.
- `?mode-selector` renders `ModeSelectorOverlay` with a focused mode-selector subscription.

The main router defines routes for:

- `/home`
- `/modes`
- `/vocabulary`
- `/history`
- `/models`
- `/providers`
- `/configuration`

The root and unknown routes redirect to `/home`. `AppShell` renders route links and an `Outlet`. Navigation away from Modes or Configuration is blocked when those views report unsaved changes, including browser unload attempts.

Shared dialog foundations live under `src/renderer/src/components/ui/` and wrap Radix Dialog or Alert Dialog behavior so feature views do not duplicate focus, overlay, and confirmation mechanics.

## Recording Bridge

`useRecordingBridge` only runs in the main renderer window. On `recording:start`, it calls `navigator.mediaDevices.getUserMedia`, creates an `AudioContext`, merges input channels to mono, publishes smoothed levels every 50 ms, and stores Float32 chunks. On `recording:stop`, it encodes a mono 16-bit PCM WAV and sends it to `dictation:complete-recording`.

Failure modes:

- Browser microphone permission or device errors reject recording startup.
- If a session is cancelled, chunks are discarded and no audio is sent to the main process.
- The hook ignores stale completions whose session id no longer matches the active session.
