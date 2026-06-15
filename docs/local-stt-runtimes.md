# Local STT Runtimes

Murmur manages native runtime binaries for local voice models:

- `whisper.cpp` for local Whisper GGML models.
- `sherpa-onnx` for NVIDIA Parakeet ONNX models.

Supported platform keys:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Windows ARM64 and GPU-specific runtime variants are not currently bundled.

## Runtime Layout

Development runtime artifacts live under:

```text
vendor/runtimes/<platform-key>/whisper.cpp/...
vendor/runtimes/<platform-key>/sherpa-onnx/...
```

Managed installs live in the user cache:

```text
${XDG_CACHE_HOME:-$HOME/.cache}/murmur/runtimes/stt/<platform-key>/<runtime-id>/<version>/...
```

Production builds download versioned runtime archives from GitHub Releases on demand, verify SHA-256 against `src/shared/stt-runtime-catalog.ts`, and install them into the cache. `vendor/runtimes` remains a development fallback and is not required by `pack` or `dist`.

## Preparing Runtimes

Generate the current platform runtimes with:

```sh
npm run runtimes:prepare
```

Check the current platform runtime tree with:

```sh
npm run runtimes:doctor
```

The prepare script downloads Sherpa ONNX, verifies SHA-256, extracts the archive, builds pinned `whisper.cpp`, applies Murmur's temporary server patch, and installs both runtimes under `vendor/runtimes/<platform-key>/`.

Runtime binaries are generated/downloaded during release prep. They are not committed to source control.

Create release archives and print their SHA-256/size values with:

```sh
npm run runtimes:package
```

## Environment Overrides

Runtime lookup order:

1. `MURMUR_WHISPER_CPP_SERVER` or `MURMUR_SHERPA_ONNX_OFFLINE`
2. `process.resourcesPath/runtimes/<platform-key>/...`
3. Managed cache install under `runtimes/stt/<platform-key>/<runtime-id>/<version>/`
4. `vendor/runtimes/<platform-key>/...`
5. Legacy `vendor/runtimes/<runtime-dir>/...`

Useful environment variables:

```sh
MURMUR_WHISPER_CPP_SERVER=/absolute/path/to/whisper-server
MURMUR_SHERPA_ONNX_OFFLINE=/absolute/path/to/sherpa-onnx-offline
MURMUR_STT_THREADS=4
MURMUR_RUNTIME_READY_TIMEOUT_MS=45000
```

## Runtime Behavior

When a Whisper model is activated, Murmur configures:

```text
type: whisper_cpp
baseUrl: murmur://runtime/whisper.cpp
model: <ggml filename>
```

At transcription time, Murmur starts `whisper-server` on an ephemeral localhost port and posts the recorded WAV to `/inference`.

When an NVIDIA Parakeet model is activated, Murmur configures:

```text
type: sherpa_onnx
baseUrl: murmur://runtime/sherpa-onnx
model: <extracted model directory>
```

At transcription time, Murmur runs `sherpa-onnx-offline` directly against the recorded WAV. Supported model layouts:

- NeMo CTC: `model.int8.onnx` or `model.onnx` plus `tokens.txt`.
- NeMo transducer: `encoder`, `decoder`, and `joiner` ONNX files plus `tokens.txt`.

The renderer records mono 16-bit PCM WAV, so FFmpeg is not required for normal bundled local dictation.

Murmur uses a patched `whisper-server` until upstream multipart WAV handling is fixed for the non-FFmpeg path.
