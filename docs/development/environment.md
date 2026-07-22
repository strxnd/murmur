# Environment

Use mise only to install and pin the Bun, Node, and CMake toolchain. Run repository tasks directly through Bun.

```sh
mise install
bun install --frozen-lockfile
```

The pinned versions live in `.mise.toml`: Bun `1.3.14`, Node `25.9.0`, and CMake `3.31.12`. Mise does not define task aliases; `bun install --frozen-lockfile` installs the workspace from `bun.lock`.

Bun is the repository package manager and workspace script runner. Node remains the runtime for Electron, Electron Vite, native tooling, and repository scripts whose package commands explicitly invoke `node`.

## Application

`apps/desktop` uses Electron, Electron Vite, React, TanStack Router, Tailwind CSS, and Radix UI.

Start the app:

```sh
bun run dev
# Equivalent: bun run dev:desktop
```

In non-packaged development builds, `AppController.loadRenderer()` reads `ELECTRON_RENDERER_URL` and loads that Vite renderer URL when it is a trusted localhost URL; otherwise it loads the built renderer HTML. Packaged builds ignore `ELECTRON_RENDERER_URL`.

## Common Tasks

| Command | Description |
| --- | --- |
| `bun run build` | Typecheck and build production output. |
| `bun run clean` | Remove generated build and packaging output. |
| `bun run clean:all` | Remove generated output and prepared local runtime artifacts. |
| `bun run test` | Run desktop and repository-script Vitest suites. |
| `bun run lint` | Run desktop TypeScript checking. |
| `bun run preview` | Preview the built Electron app. |
| `bun run pack` | Build and package an unpacked Electron app. |
| `bun run dist` | Build distributable Electron artifacts. |
| `bun run runtimes:prepare` | Prepare current-platform STT runtime binaries. |
| `bun run runtimes:package` | Package current-platform STT runtime archives. |
| `bun run runtimes:stage` | Stage prepared current-platform STT runtimes for app packaging. |
| `bun run runtimes:doctor` | Check current-platform runtime readiness. |
| `bun run runtimes:manifest-check` | Validate runtime archive metadata. |
| `bun run runtimes:manifest-check:release` | Validate configured runtime release URLs are reachable. |
| `bun run linux-helper:build` | Build the optional native Linux keyboard helper. |
| `bun run release:prepare` | Prepare local release artifacts without committing, tagging, pushing, or creating releases. |

## Generated Output

Do not edit generated output directly:

- `apps/desktop/out/`
- `dist/runtimes/`
- `.cache/bundled-runtimes/`
- `vendor/runtimes/`
- `resources/bin/linux-fast-paste`

Runtime and helper artifacts are generated as part of specific development or release workflows.

Use `bun run clean` to remove app build and package output while preserving prepared runtime directories. Use `bun run clean:all` when you also want to remove prepared local runtime artifacts and rebuild them with `bun run runtimes:prepare`.
