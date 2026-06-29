# Filesystem Layout

Paths are resolved by [`resolveAppPaths()`](../../src/main/services/app-paths.ts). Absolute XDG environment overrides are honored; relative XDG values are ignored.

| Field | Default Linux path | Purpose |
| --- | --- | --- |
| `configDir` | `$HOME/.config/murmur` | Config directory. |
| `dataDir` | `$HOME/.local/share/murmur` | Data directory. |
| `cacheDir` | `$HOME/.cache/murmur` | Cache directory. |
| `tempDir` | `<electron temp>/murmur` | Temporary audio and runtime work files. |
| `audioDir` | `$HOME/.local/share/murmur/audio` | Legacy linked recording audio cleanup location. Completed recordings are not stored here by current dictation flow. |
| `modelDir` | `$HOME/.cache/murmur/models/stt` | Downloaded STT models. |
| `runtimeDir` | `$HOME/.cache/murmur/runtimes/stt` | Development-managed STT runtime installs. |
| `configPath` | `$HOME/.config/murmur/murmur-config.json` | Persisted settings and config. |
| `providerSecretsPath` | `$HOME/.config/murmur/murmur-provider-secrets.json` | Out-of-band provider API key storage. |
| `historyDbPath` | `$HOME/.local/share/murmur/murmur-history.sqlite` | SQLite history database. |
| `historyJsonPath` | `$HOME/.local/share/murmur/murmur-history.json` | JSON history fallback. |

## Runtime Cache

Development-managed STT runtimes install under:

```text
<runtimeDir>/<platform-key>/<runtime-id>/<accelerator>/<runtime-bundle-semver>/
```

Each valid cache install includes a `runtime.json` receipt. Development runtime artifacts are read from:

```text
vendor/runtimes/<platform-key>/<runtime-dir>/
```

## Packaged Resources

Packaged Linux builds may include:

```text
<process.resourcesPath>/bin/linux-fast-paste
<process.resourcesPath>/runtimes/<platform-key>/<runtime-dir>/
```

The current `electron-builder` config includes `resources/bin/linux-fast-paste` as an extra resource when present and copies staged STT runtimes from `.cache/bundled-runtimes/runtimes` to `runtimes`. Packaged apps use these runtime resources and do not download runtime binaries; STT model files are still downloaded into `modelDir`.
