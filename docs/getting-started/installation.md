# Installation

Murmur is developed with the Node version pinned in `.mise.toml` and npm lockfile installs.

## From Source

```sh
mise install
mise run install
mise run dev
```

`mise run dev` starts Electron through Electron Vite and clears `ELECTRON_RUN_AS_NODE` through the npm script.

## Build Locally

```sh
mise run build
```

The build runs TypeScript checking and produces Electron/Vite output in `apps/desktop/out/`.

For packaging commands, see [release and packaging](../development/release-and-packaging.md).

## Linux Helper

Text insertion can use the optional native Linux keyboard helper when it is built and discoverable:

```sh
mise run linux-helper:build
```

When the helper is unavailable, Murmur tries tool and portal backends before falling back to clipboard-only behavior. See [platform support](../architecture/platform-support.md).
