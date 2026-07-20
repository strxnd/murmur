# AGENTS.md

## Repository Overview

Murmur is an early-stage, cross-platform AI dictation desktop app for Linux and macOS. The repository is an npm workspace, but `apps/desktop` is currently the only implemented application; `apps/marketing` has no source or build pipeline yet.

Use npm package scripts as the command source of truth. Mise pins the toolchain and wraps the root scripts, which delegate to `apps/desktop`.

## Commands

```sh
mise install             # Install pinned Node 25.9.0 and CMake 3.31.12
mise run install         # npm ci
mise run dev             # Start Electron through Electron Vite
mise run build           # Typecheck and build apps/desktop/out
mise run preview         # Preview the production build
mise run lint            # Typecheck only (tsc --noEmit; no separate linter)
mise run test            # Run desktop and repository-script Vitest suites
mise run clean           # Remove normal generated build/package output
mise run clean:all       # Also remove prepared runtime caches/vendor artifacts
```

Run a single desktop test file from the repository root:

```sh
npm --prefix apps/desktop run test -- src/main/services/storage.test.ts
```

Run one named test:

```sh
npm --prefix apps/desktop run test -- src/main/services/storage.test.ts -t "writes config state to the config dir"
```

There is no formatter command or formatter configuration. `mise run build` is the minimum repository verification before handing off changes, including documentation-only changes. CI additionally runs runtime manifest checks and `npm audit`.

Packaging requires current-platform STT runtimes to be prepared:

```sh
mise run runtimes:prepare
mise run runtimes:doctor
mise run pack             # Unpacked Electron app
mise run dist             # Distributable artifacts in dist/
```

## Architecture

### Process boundaries

Electron Vite builds a main process, preload, and one React renderer bundle. `src/main/index.ts` handles the Linux Wayland/XWayland entrypoint behavior; `src/main/app-main.ts` handles platform checks, single-instance startup, and shutdown. `AppController` in `src/main/app-controller.ts` is the composition root: it creates services, registers IPC and hotkeys, manages the tray, and owns the main, recording-pill, and mode-selector windows. All windows use the same renderer bundle and select their UI using query parameters.

The renderer is sandboxed: it must not import Electron directly. Keep context isolation enabled and Node integration disabled. `src/preload/index.ts` exposes the narrow `window.murmur` API, and `src/renderer/src/lib/murmur-client.ts` wraps that bridge and validates responses. Main-process IPC handlers also validate payloads and reject senders outside owned windows and trusted renderer URLs.

### Shared contracts and state flow

`apps/desktop/src/shared/` is the cross-process contract layer; there is no separate shared workspace. Keep shared types in `types.ts`, Zod IPC/runtime schemas in `schemas.ts`, cross-process defaults in `defaults.ts`, and provider/model mapping logic in the other shared modules rather than duplicating shapes in main or renderer code.

The main process is authoritative for application state. It produces `AppStateSnapshot` from persisted configuration/history/model data plus runtime capabilities and the active dictation session. The main renderer mirrors this in the Zustand store at `src/renderer/src/state/murmur-store.ts`: actions call the validated client and replace the returned snapshot, while main broadcasts `state:changed` and narrower model/runtime progress events. The pill and mode-selector windows use focused event subscriptions instead of the main store.

Microphone capture runs in the main renderer. `useRecordingBridge` records mono PCM, creates the WAV buffer, publishes audio levels, and sends completed audio to the main process over IPC. Native integration, provider calls, persistence, and subprocesses remain in the main process.

### Main-process orchestration

Main services under `src/main/services/` are organized by system boundary: storage and secrets, STT and LLM adapters, model/runtime management, context capture, hotkeys and permissions, clipboard, and platform text automation. Keep platform/provider mechanics in these services rather than growing IPC handlers.

The dictation pipeline is coordinated by `AppController`: check STT and automation readiness, capture context and audio, transcribe, optionally run LLM cleanup, paste or preserve the clipboard fallback, persist history, and broadcast state. LLM cleanup failure intentionally falls back to the raw transcript instead of failing the dictation.

Context capture and output insertion share the serialized `TextAutomationService` queue. This prevents selected-text copy operations and paste operations from racing over the clipboard or keyboard automation backends.

### Models, runtimes, and persistence

The model library handles catalog merging, downloads, integrity checks, activation, favorites, and local deletion. STT runtime management is separate and resolves binaries in this order: environment override, packaged resources, managed cache, then development vendor files. CPU runtimes are bundled for releases; accelerated variants are optional downloads described by pinned URL, size, and SHA-256 metadata.

`StorageService` owns settings, modes, providers, rules, vocabulary, model-library state, release notes, and history. Configuration writes are atomic owner-only JSON. History uses `node:sqlite` with full-text search when available and owner-only JSON as a fallback. Provider keys are removed from normal config and stored separately through `ProviderSecretsService`, using Electron safe storage when available.

Runtime supply-chain metadata has two coordinated sources: `scripts/runtime-manifest.json` describes upstream build/download inputs, while `src/shared/stt-runtime-catalog.ts` describes app-visible assets. When changing runtime versions or artifacts, update and validate both sides with the runtime manifest tasks.

## Repository Conventions

- Preserve strict TypeScript and two-space indentation. Prefer shared interfaces over local duplicates.
- Use `PascalCase` for components/classes, `camelCase` for functions and variables, and kebab-case service filenames.
- Keep tests colocated with behavior. Main-service tests inject or mock filesystem, process, HTTP, runtime, and desktop dependencies. No Electron/Playwright end-to-end harness is currently configured.
- Motion is intentional in the renderer: keep it fast and restrained, avoid layout jank, and honor `prefers-reduced-motion`.
- Do not edit generated output directly: `apps/desktop/out/`, `dist/runtimes/`, `.cache/bundled-runtimes/`, `vendor/runtimes/`, or generated binaries in `resources/bin/`.
- Current code behavior is the documentation source of truth. Documentation is plain Markdown; use relative links and Mermaid for architecture diagrams.
