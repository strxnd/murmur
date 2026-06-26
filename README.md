# Murmur

Murmur is an Electron desktop app for system-wide AI dictation. It records speech, transcribes it with a local or cloud STT provider, optionally rewrites it with an LLM, and pastes the result back into the active desktop app.

The app is currently Linux-first. Text automation, active-window context, and the packaged launcher are designed around Linux desktop sessions, with Wayland sessions relaunched under XWayland for more reliable overlay and focus behavior.

## Quick Start

Use mise for the repo toolchain and task entrypoints:

```sh
mise install
mise run install
mise run dev
```

The mise tasks wrap the existing npm scripts in `package.json`; npm remains the package manager for this repo.

## Documentation

- [Documentation index](docs/README.md)
- [User getting started](docs/getting-started/README.md)
- [Architecture overview](docs/architecture/README.md)
- [Development guide](docs/development/README.md)
- [Reference](docs/reference/README.md)

## Common Commands

| Command | Description |
| --- | --- |
| `mise run install` | Install dependencies from `package-lock.json`. |
| `mise run dev` | Start the Electron/Vite development app. |
| `mise run build` | Run TypeScript checking and produce production Electron/Vite output in `out/`. |
| `mise run test` | Run the Vitest test suite. |
| `mise run lint` | Run TypeScript type checking. |
| `mise run preview` | Preview the built Electron app. |
| `mise run pack` | Build and package an unpacked Electron app. |
| `mise run dist` | Build distributable Electron artifacts. |
| `mise run runtimes:prepare` | Prepare current-platform local STT runtime binaries. |
| `mise run runtimes:package` | Package current-platform local STT runtime binaries. |
| `mise run runtimes:stage` | Stage prepared current-platform STT runtimes for app packaging. |
| `mise run runtimes:doctor` | Check current-platform local STT runtime readiness. |
| `mise run runtimes:manifest-check` | Validate pinned STT runtime archive metadata. |
| `mise run linux-helper:build` | Build the optional native Linux keyboard helper. |

Packaged app artifacts include the prepared `whisper.cpp` and `sherpa-onnx` runtime binaries for the target platform. Voice model files are still downloaded separately into the user cache.
