# Processes and IPC

The renderer never imports Electron directly. [`src/preload/index.ts`](../../src/preload/index.ts) exposes `window.murmur`; [`src/renderer/src/lib/murmur-client.ts`](../../src/renderer/src/lib/murmur-client.ts) wraps it and validates responses with shared schemas.

```mermaid
flowchart TB
  Renderer["Renderer"]
  Preload["Preload window.murmur"]
  Main["AppController IPC handlers"]

  Renderer <--> Preload
  Preload <--> Main

  subgraph State["State and settings"]
    S1["app:get-state"]
    S2["settings:update"]
    S3["state:changed event"]
    S4["data:clear-local"]
  end

  subgraph Config["Modes and provider config"]
    C1["modes:set"]
    C2["mode:activate"]
    C3["providers:set-stt"]
    C4["providers:set-llm"]
    C5["provider:validate-stt"]
    C6["provider:validate-llm"]
    C7["rules:set-auto-mode"]
    C8["replacements:set"]
    C9["vocabulary:set"]
    C10["hotkeys:capture-start/end"]
  end

  subgraph Models["Models and runtimes"]
    M1["models:get-library"]
    M2["models:download/cancel-download"]
    M3["models:activate/delete/toggle-favorite"]
    M4["models:download-progress event"]
    R1["stt-setup:get"]
    R2["stt-runtime:download/repair/cancel-download"]
    R3["stt-runtime:progress event"]
    R4["stt-setup:setup-bundled/skip"]
  end

  subgraph Dictation["Dictation and recording"]
    D1["dictation:start/stop/cancel"]
    D2["recording:start/stop/cancel events"]
    D3["dictation:complete-recording"]
    D4["recording:level send/event"]
    D5["dictation:transcript-delta event"]
  end

  subgraph History["History"]
    H1["history:copy"]
    H2["history:repaste"]
    H3["history:delete"]
    H4["history:clear"]
    H5["history:reprocess"]
  end

  Main --> State
  Main --> Config
  Main --> Models
  Main --> Dictation
  Main --> History
```

## Request Pattern

Most invoke handlers mutate storage or service state, broadcast `state:changed`, and return a fresh `AppStateSnapshot`. Model library and runtime setup calls can return narrower snapshots for optimistic renderer updates.

## Event Pattern

Long-running work reports progress through events:

- `models:download-progress` updates one `ModelDownloadState`.
- `stt-runtime:progress` updates one `SttRuntimeInstallState`.
- `dictation:transcript-delta` streams completed-audio STT deltas when available.
- `recording:level` is sent by the renderer during recording and forwarded to the pill window.

The full API surface is listed in [IPC API](../reference/ipc-api.md).
