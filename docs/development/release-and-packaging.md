# Release and Packaging

Packaging uses Electron Vite for build output and `electron-builder` for app artifacts. Runtime archives are built by a dedicated GitHub Actions workflow.

```mermaid
flowchart TD
  Source["Source tree"]
  Build["npm run build: tsc --noEmit and electron-vite build"]
  Pack["electron-builder --dir"]
  Dist["electron-builder"]
  AfterPack["scripts/after-pack.cjs"]
  AppArtifacts["App package artifacts"]

  RuntimeManifest["scripts/runtime-manifest.json"]
  Prepare["prepare-runtimes.mjs"]
  Doctor["check-runtimes.mjs"]
  PackageRuntime["package-runtimes.mjs"]
  ManifestCheck["check-runtime-manifest.mjs"]
  RuntimeCatalog["src/shared/stt-runtime-catalog.ts"]
  RuntimeArchives["dist/runtimes/*.tar.gz"]
  ReleaseTag["GitHub tag v*"]
  GitHubRelease["GitHub Release runtime assets"]

  Source --> Build --> Pack --> AfterPack --> AppArtifacts
  Build --> Dist --> AfterPack
  RuntimeManifest --> Prepare --> Doctor --> PackageRuntime --> RuntimeArchives
  RuntimeCatalog --> PackageRuntime
  RuntimeCatalog --> ManifestCheck
  RuntimeArchives --> ReleaseTag --> GitHubRelease
```

## App Packaging Commands

```sh
mise run pack
mise run dist
```

`pack` runs:

```sh
npm run build
npm run runtimes:manifest-check
electron-builder --dir
```

`dist` runs the same build and manifest check, then invokes `electron-builder`.

The `build` block in `package.json` sets:

- `appId: dev.murmur.app`
- `afterPack: scripts/after-pack.cjs`
- packaged files from `out/**` and `package.json`
- extra resource `resources/bin/linux-fast-paste` to `bin/linux-fast-paste`

## Linux afterPack Launcher

[`scripts/after-pack.cjs`](../../scripts/after-pack.cjs) runs only for Linux. It renames the Electron binary to `<binary>-app`, writes a shell launcher at the original binary path, and forces `--ozone-platform=x11` when a Wayland session is detected. The launcher also reads user flags from `${XDG_CONFIG_HOME:-$HOME/.config}/<binary>-flags.conf`.

## Runtime Artifact CI

[`Runtime Artifacts`](../../.github/workflows/runtimes.yml) runs on manual dispatch, runtime-related pull requests, and matching tag pushes. The matrix builds:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Each job installs dependencies, prepares runtimes, checks runtimes, packages runtime archives, uploads workflow artifacts, and attaches `dist/runtimes/*.tar.gz` to a GitHub Release when the ref is a tag.

Runtime archive metadata used by the app is pinned in [`src/shared/stt-runtime-catalog.ts`](../../src/shared/stt-runtime-catalog.ts). Build inputs are defined in [`scripts/runtime-manifest.json`](../../scripts/runtime-manifest.json).
