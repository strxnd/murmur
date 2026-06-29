# Release and Packaging

Packaging uses Electron Vite for build output and `electron-builder` for app artifacts. Version tags create draft GitHub releases with Linux artifacts and checksums; releases are not published automatically.

```mermaid
flowchart TD
  Source["Source tree"]
  Build["npm run build: tsc --noEmit and electron-vite build"]
  Pack["electron-builder --dir"]
  Dist["electron-builder"]
  AfterPack["scripts/after-pack.cjs"]
  AppArtifacts["App package artifacts"]
  Checksums["generate-linux-release-checksums.mjs"]
  Sha256Sums["dist/SHA256SUMS-linux.txt"]
  DraftRelease["draft GitHub release"]

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
  Dist --> Checksums --> Sha256Sums
  AppArtifacts --> DraftRelease
  Sha256Sums --> DraftRelease
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
npm run linux-helper:build
npm run runtimes:manifest-check
npm run runtimes:stage
electron-builder --dir
```

`dist` runs the same build, native helper build, manifest check, and runtime staging, then invokes `electron-builder`.

The `build` block in `package.json` sets:

- `appId: dev.kumaraarav.murmur`
- `afterPack: scripts/after-pack.cjs`
- `productName: Murmur`
- `desktopName: murmur`
- Linux distributable targets: `AppImage`, `deb`, and `rpm`
- Linux desktop-name syncing for installed package integration
- Linux package category: `Utility`
- Linux package maintainer: `Kumar Aarav <kumaraarav@kumaraarav.dev>`
- packaged files from `out/**` and `package.json`
- extra resource `resources/bin/linux-fast-paste` to `bin/linux-fast-paste`
- extra resource `.cache/bundled-runtimes/runtimes` to `runtimes`

`pack` and `dist` require prepared runtimes for the target platform. Run `mise run runtimes:prepare` first; staging fails before `electron-builder` if either runtime executable is missing.

Building the `rpm` target also requires the host system to provide `rpmbuild`.

## Draft GitHub Releases

Pushing a SemVer app version tag creates a draft GitHub Release. The workflow lives at [`.github/workflows/release.yml`](../../.github/workflows/release.yml) and runs on tags that start with a numeric SemVer core, such as `0.1.0`.

Before pushing a release tag:

1. Update `package.json` to the release version.
2. Add meaningful release notes at `docs/releases/<version>.md`.
3. Commit the version and release notes.
4. Push the matching tag, for example:

```sh
git tag 0.1.0
git push origin 0.1.0
```

The workflow verifies that the tag matches `package.json`, requires the release notes file, runs lint/tests/audit, prepares bundled STT runtimes, builds `AppImage`, `deb`, and `rpm`, generates `SHA256SUMS-linux.txt`, verifies the checksums, and creates a draft release with those files attached.

## Linux Checksums and Signing

`electron-builder` writes SHA-512 values into `dist/latest-linux.yml` for updater metadata. Treat that file as update-channel metadata, not as the release checksum policy for people downloading packages directly.

For every Linux release, publish an explicit SHA-256 manifest next to the Linux package artifacts:

```sh
mise run dist
node scripts/generate-linux-release-checksums.mjs
```

The checksum script writes `dist/SHA256SUMS-linux.txt` with deterministic, sorted entries for:

- top-level `dist/*.AppImage`, `dist/*.deb`, and `dist/*.rpm` packages
- `dist/runtimes/*.tar.gz` runtime archives when those archives exist and are being published

It intentionally excludes `latest-linux.yml`, `.blockmap` files, and other metadata files. Regenerate `SHA256SUMS-linux.txt` after any rebuild or artifact replacement, and publish the checksum file with the artifacts it describes.

To verify a staged release locally before upload:

```sh
cd dist
sha256sum -c SHA256SUMS-linux.txt
```

Package signing is not currently performed:

- AppImage artifacts are not signed.
- `.deb` packages are not signed, and no signed apt repository metadata is produced.
- `.rpm` packages are not signed, and `rpmsign` is not configured.
- No project GPG release-signing key is configured, so detached signatures such as `SHA256SUMS-linux.txt.asc` are not generated.

If a release-signing key is added later, sign the checksum manifest with a detached signature and publish the public key fingerprint in the release notes. Package-level signing for `.deb` repository metadata or `.rpm` packages should be configured as a separate release step rather than implied by the checksum manifest.

## Linux afterPack Launcher

[`scripts/after-pack.cjs`](../../scripts/after-pack.cjs) runs only for Linux. It renames the Electron binary to `<binary>-app`, writes a shell launcher at the original binary path, and forces `--ozone-platform=x11` when a Wayland session is detected. The launcher also reads user flags from `${XDG_CONFIG_HOME:-$HOME/.config}/<binary>-flags.conf`.

## Runtime Artifacts

Runtime binaries are prepared manually with the runtime scripts before packaging. Supported runtime platform keys are:

- `linux-x64`

For the current platform, run:

```sh
mise run runtimes:prepare
mise run runtimes:doctor
mise run runtimes:stage
mise run runtimes:package
```

`runtimes:stage` copies CPU runtime files from `vendor/runtimes/<platform-key>/` into `.cache/bundled-runtimes/runtimes/<platform-key>/` for inclusion under `<process.resourcesPath>/runtimes/` in packaged apps. GPU runtime variants are optional assets published on runtime-only GitHub releases, separate from app releases, and are downloaded into the user cache only when their catalog URL, size, and SHA-256 are configured.

`runtimes:package` writes archives to `dist/runtimes/*.tar.gz`.

Runtime archive metadata used by the app is pinned in [`src/shared/stt-runtime-catalog.ts`](../../src/shared/stt-runtime-catalog.ts). Build inputs are defined in [`scripts/runtime-manifest.json`](../../scripts/runtime-manifest.json).
