# Filesystem Layout

Paths are resolved by [`resolveAppPaths()`](../../src/main/services/app-paths.ts). Absolute XDG environment overrides are honored; relative XDG values are ignored.

| Field | Default Linux path | Purpose |
| --- | --- | --- |
| `configDir` | `$HOME/.config/murmur` | Config directory. |
| `dataDir` | `$HOME/.local/share/murmur` | Data directory. |
| `cacheDir` | `$HOME/.cache/murmur` | Cache directory. |
| `tempDir` | `<electron temp>/murmur` | Temporary audio and runtime work files. |
| `audioDir` | `$HOME/.local/share/murmur/audio` | Retained recording audio. |
| `modelDir` | `$HOME/.cache/murmur/models/stt` | Downloaded STT models. |
| `runtimeDir` | `$HOME/.cache/murmur/runtimes/stt` | Managed STT runtime installs. |
| `configPath` | `$HOME/.config/murmur/murmur-config.json` | Persisted settings and config. |
| `historyDbPath` | `$HOME/.local/share/murmur/murmur-history.sqlite` | SQLite history database. |
| `historyJsonPath` | `$HOME/.local/share/murmur/murmur-history.json` | JSON history fallback. |

## Runtime Cache

Managed STT runtimes install under:

```text
<runtimeDir>/<platform-key>/<runtime-id>/<version>/
```

Each valid cache install includes a `runtime.json` receipt. Development fallbacks are read from:

```text
vendor/runtimes/<platform-key>/<runtime-dir>/
vendor/runtimes/<runtime-dir>/
```

## Packaged Resources

Packaged Linux builds may include:

```text
<process.resourcesPath>/bin/linux-fast-paste
<process.resourcesPath>/runtimes/<platform-key>/<runtime-dir>/
```

The current `electron-builder` config includes `resources/bin/linux-fast-paste` as an extra resource when present. Runtime resources are supported by lookup order, but production runtime installs are primarily managed through cache downloads.
