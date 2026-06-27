# Local STT Setup

Murmur manages native runtime binaries for local voice models:

- `whisper.cpp` for local Whisper GGML models.
- `sherpa-onnx` for NVIDIA Parakeet ONNX models.

Packaged apps include the native runtime binaries for the target platform. The local setup flow downloads the selected voice model, activates the model, and records setup completion in settings. In development, the same setup flow can also download or repair runtime binaries.

## Supported Runtime Platforms

Bundled runtime archives are currently cataloged for:

- `linux-x64`

## User Cache Layout

Models are stored under the app cache:

```text
${XDG_CACHE_HOME:-$HOME/.cache}/murmur/models/stt/
```

Managed runtime installs are stored under:

```text
${XDG_CACHE_HOME:-$HOME/.cache}/murmur/runtimes/stt/<platform-key>/<runtime-id>/<version>/
```

Packaged runtime binaries are loaded from:

```text
<process.resourcesPath>/runtimes/<platform-key>/<runtime-dir>/
```

Development runtime artifacts may also exist under `vendor/runtimes/<platform-key>/`, but production builds do not require that directory.

## Runtime Behavior

When a Whisper model is activated, Murmur uses a provider like:

```text
type: whisper_cpp
baseUrl: murmur://runtime/whisper.cpp
model: <ggml filename>
```

At transcription time, Murmur starts `whisper-server` on an ephemeral localhost port and posts the recorded WAV to `/inference`.

When an NVIDIA Parakeet model is activated, Murmur uses a provider like:

```text
type: sherpa_onnx
baseUrl: murmur://runtime/sherpa-onnx
model: <extracted model directory>
```

At transcription time, Murmur runs `sherpa-onnx-offline` directly against the recorded WAV.

The renderer records mono 16-bit PCM WAV, so FFmpeg is not required for normal bundled local dictation.

## Advanced Overrides

Runtime binary overrides are documented in [environment variables](../reference/environment-variables.md). Maintainer details for runtime lookup and cache behavior are in [model library and runtimes](../architecture/model-library-and-runtimes.md).
