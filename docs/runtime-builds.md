# Runtime Builds

## Sources

Build inputs are defined in `scripts/runtime-manifest.json`. Downloadable Murmur runtime archive metadata is pinned in `src/shared/stt-runtime-catalog.ts`.

- `whisper.cpp`: `v1.8.6`
  - Repository: `https://github.com/ggml-org/whisper.cpp.git`
  - Patch: `patches/whisper.cpp/v1.8.6-server-multipart-wav.patch`
- `sherpa-onnx`: `v1.13.2`
  - Release base URL: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2`

Sherpa ONNX assets:

- `linux-x64`: `sherpa-onnx-v1.13.2-linux-x64-shared-no-tts.tar.bz2`
- `linux-arm64`: `sherpa-onnx-v1.13.2-linux-aarch64-shared-cpu.tar.bz2`
- `darwin-x64`: `sherpa-onnx-v1.13.2-osx-universal2-shared-no-tts.tar.bz2`
- `darwin-arm64`: `sherpa-onnx-v1.13.2-osx-universal2-shared-no-tts.tar.bz2`
- `win32-x64`: `sherpa-onnx-v1.13.2-win-x64-shared-MT-Release-no-tts.tar.bz2`

## Whisper Patch

The temporary Whisper patch fixes `whisper-server` multipart WAV uploads when FFmpeg conversion is disabled. Upstream `v1.8.6` passes uploaded multipart bytes directly into `read_audio_data`; Murmur's patch writes the uploaded bytes to a temporary WAV file with binary `write()` and then calls `read_audio_data()` with that path.

Remove the patch after the pinned upstream version includes the multipart WAV fix.

## Build Commands

Prepare current platform runtimes:

```sh
npm run runtimes:prepare
```

Check current platform runtime readiness:

```sh
npm run runtimes:doctor
```

Package after runtimes are present:

```sh
npm run runtimes:package
npm run runtimes:manifest-check
npm run pack
npm run dist
```

CI builds runtime artifacts per supported hosted runner, packages one archive per runtime/platform, uploads the archives as workflow artifacts, and attaches them to GitHub Releases on release tags.

## Manual Smoke Tests

Whisper server:

```sh
vendor/runtimes/<platform-key>/whisper.cpp/whisper-server \
  --host 127.0.0.1 \
  --port 8080 \
  --model "${XDG_CACHE_HOME:-$HOME/.cache}/murmur/models/stt/ggml-tiny.en.bin" \
  --inference-path /inference \
  --threads 4

curl http://127.0.0.1:8080/inference \
  -F file=@sample.wav \
  -F response_format=json
```

Sherpa CTC:

```sh
vendor/runtimes/<platform-key>/sherpa-onnx/bin/sherpa-onnx-offline \
  --nemo-ctc-model=<model-dir>/model.int8.onnx \
  --tokens=<model-dir>/tokens.txt \
  --num-threads=4 \
  --decoding-method=greedy_search \
  --debug=false \
  sample.wav
```

Sherpa transducer:

```sh
vendor/runtimes/<platform-key>/sherpa-onnx/bin/sherpa-onnx-offline \
  --encoder=<model-dir>/encoder.int8.onnx \
  --decoder=<model-dir>/decoder.int8.onnx \
  --joiner=<model-dir>/joiner.int8.onnx \
  --tokens=<model-dir>/tokens.txt \
  --model-type=nemo_transducer \
  --num-threads=4 \
  --decoding-method=greedy_search \
  --debug=false \
  sample.wav
```

Use single-channel 16-bit PCM WAV input for bundled runtime smoke tests.

## Troubleshooting

Missing executable:

- Run `npm run runtimes:prepare`.
- Confirm `npm run runtimes:doctor` reports both runtimes available.
- Check that the executable is under `vendor/runtimes/<platform-key>/<runtime>/`.
- For production downloads, confirm `npm run runtimes:manifest-check` passes and the release archive exists.

Unsupported platform:

- Confirm `node -p "process.platform + '-' + process.arch"` returns one of the supported platform keys.
- Windows ARM64 is not currently bundled.

Dynamic library load failure:

- Confirm adjacent runtime `lib` or `bin` directories were copied with the executable.
- For development, run through Murmur so `LD_LIBRARY_PATH`, `DYLD_LIBRARY_PATH`, or `PATH` is adjusted by `SttRuntimeService`.
- For direct shell smoke tests, export the needed library path manually from `vendor/runtimes/<platform-key>/<runtime>/lib`.
