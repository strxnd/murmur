# Release and Packaging

Packaging uses Electron Vite for build output and `electron-builder` for app artifacts. Runtime archives can be built manually when needed, but this project does not currently publish release artifacts automatically.

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
  Stage["stage-bundled-runtimes.mjs"]
  Doctor["check-runtimes.mjs"]
  PackageRuntime["package-runtimes.mjs"]
  ManifestCheck["check-runtime-manifest.mjs"]
  RuntimeCatalog["src/shared/stt-runtime-catalog.ts"]
  RuntimeArchives["dist/runtimes/*.tar.gz"]
  BundledRuntimes[".cache/bundled-runtimes/runtimes"]

  Source --> Build --> Pack --> AfterPack --> AppArtifacts
  Build --> Dist --> AfterPack
  Prepare --> Stage --> BundledRuntimes --> Pack
  BundledRuntimes --> Dist
  RuntimeManifest --> Prepare --> Doctor --> PackageRuntime --> RuntimeArchives
  RuntimeCatalog --> PackageRuntime
  RuntimeCatalog --> ManifestCheck
  RuntimeCatalog --> Stage
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
npm run runtimes:stage
electron-builder --dir
```

`dist` runs the same build, manifest check, and runtime staging, then invokes `electron-builder`.

The `build` block in `package.json` sets:

- `appId: dev.murmur.app`
- `afterPack: scripts/after-pack.cjs`
- Linux distributable targets: `AppImage`, `deb`, and `rpm`
- Linux package maintainer: `Kumar Aarav <kumaraarav@kumaraarav.dev>`
- packaged files from `out/**` and `package.json`
- extra resource `resources/bin/linux-fast-paste` to `bin/linux-fast-paste`
- extra resource `.cache/bundled-runtimes/runtimes` to `runtimes`

`pack` and `dist` require prepared runtimes for the target platform. Run `mise run runtimes:prepare` first; staging fails before `electron-builder` if either runtime executable is missing.

Building the `rpm` target also requires the host system to provide `rpmbuild`.

## Linux afterPack Launcher

[`scripts/after-pack.cjs`](../../scripts/after-pack.cjs) runs only for Linux. It renames the Electron binary to `<binary>-app`, writes a shell launcher at the original binary path, and forces `--ozone-platform=x11` when a Wayland session is detected. The launcher also reads user flags from `${XDG_CONFIG_HOME:-$HOME/.config}/<binary>-flags.conf`.

## Runtime Artifacts

Runtime binaries are prepared manually with the runtime scripts before packaging. Supported runtime platform keys are:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

For the current platform, run:

```sh
mise run runtimes:prepare
mise run runtimes:doctor
mise run runtimes:stage
mise run runtimes:package
```

`runtimes:stage` copies one platform from `vendor/runtimes/<platform-key>/` into `.cache/bundled-runtimes/runtimes/<platform-key>/` for inclusion under `<process.resourcesPath>/runtimes/` in packaged apps. Packaged apps do not download runtime binaries at startup; voice model files are still downloaded separately into the user cache.

`runtimes:package` writes archives to `dist/runtimes/*.tar.gz`.

Runtime archive metadata used by the app is pinned in [`src/shared/stt-runtime-catalog.ts`](../../src/shared/stt-runtime-catalog.ts). Build inputs are defined in [`scripts/runtime-manifest.json`](../../scripts/runtime-manifest.json).
