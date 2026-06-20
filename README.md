# Murmur

Murmur is a desktop app for system-wide AI dictation.

## Setup

Use mise for the repo toolchain and task entrypoints:

```sh
mise install
mise run install
mise run dev
```

The mise tasks wrap the existing npm scripts in `package.json`; npm remains the package manager for this repo.

## Commands

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
| `mise run runtimes:doctor` | Check current-platform local STT runtime readiness. |
| `mise run runtimes:manifest-check` | Validate pinned STT runtime archive metadata. |
| `mise run linux-helper:build` | Build the optional native Linux keyboard helper. |
