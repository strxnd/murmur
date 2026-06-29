# Environment

Use mise as the entrypoint for the pinned Node toolchain and repo tasks.

```sh
mise install
mise run install
```

The pinned Node version is `25.9.0` in `.mise.toml`. `mise run install` runs `npm ci`, and npm remains the package manager for the repository.

## Development Server

```sh
mise run dev
```

This starts Electron through Electron Vite. In non-packaged development builds, `AppController.loadRenderer()` reads `ELECTRON_RENDERER_URL` and loads that Vite renderer URL when it is a trusted localhost URL; otherwise it loads the built renderer HTML. Packaged builds ignore `ELECTRON_RENDERER_URL`.

## Common Tasks

| Command | Description |
| --- | --- |
| `mise run build` | Typecheck and build production output. |
| `mise run clean` | Remove generated build and packaging output. |
| `mise run clean:all` | Remove generated output and prepared local runtime artifacts. |
| `mise run test` | Run Vitest tests. |
| `mise run lint` | Run TypeScript checking only. |
| `mise run preview` | Preview the built Electron app. |
| `mise run pack` | Build and package an unpacked Electron app. |
| `mise run dist` | Build distributable Electron artifacts. |
| `mise run runtimes:prepare` | Prepare current-platform STT runtime binaries. |
| `mise run runtimes:package` | Package current-platform STT runtime archives. |
| `mise run runtimes:stage` | Stage prepared current-platform STT runtimes for app packaging. |
| `mise run runtimes:doctor` | Check current-platform runtime readiness. |
| `mise run runtimes:manifest-check` | Validate runtime archive metadata. |
| `mise run runtimes:manifest-check:release` | Validate configured runtime release URLs are reachable. |
| `mise run linux-helper:build` | Build the optional native Linux keyboard helper. |

## Generated Output

Do not edit generated output directly:

- `out/`
- `dist/runtimes/`
- `.cache/bundled-runtimes/`
- `vendor/runtimes/`
- `resources/bin/linux-fast-paste`

Runtime and helper artifacts are generated as part of specific development or release workflows.

Use `mise run clean` to remove build and package output while preserving prepared runtime directories. Use `mise run clean:all` when you also want to remove prepared local runtime artifacts and rebuild them with `mise run runtimes:prepare`.
