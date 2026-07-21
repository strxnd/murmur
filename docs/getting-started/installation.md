# Installation

Murmur uses the Bun and Node versions pinned in `.mise.toml`. Bun installs the workspace from `bun.lock`; Node remains required by Electron and the repository tooling that explicitly invokes it.

## From Source

```sh
mise install
bun install --frozen-lockfile
bun run dev
```

`bun install --frozen-lockfile` performs a frozen Bun install. `bun run dev` starts the desktop app through Electron Vite and clears `ELECTRON_RUN_AS_NODE` through the desktop package script.

## Build Locally

```sh
bun run build
```

The build runs TypeScript checking and produces Electron/Vite output in `apps/desktop/out/`.

For packaging commands, see [release and packaging](../development/release-and-packaging.md).

## Linux Helper

Text insertion can use the optional native Linux keyboard helper when it is built and discoverable:

```sh
bun run linux-helper:build
```

When the helper is unavailable, Murmur tries tool and portal backends before falling back to clipboard-only behavior. See [platform support](../architecture/platform-support.md).
