# Runtime Builds

Local STT runtime build inputs are defined in [`scripts/runtime-manifest.json`](../../scripts/runtime-manifest.json). Murmur runtime archive metadata for local packaging is pinned in [`src/shared/stt-runtime-catalog.ts`](../../src/shared/stt-runtime-catalog.ts).

## Sources

- `whisper.cpp`: upstream SemVer `1.8.6`
  - Repository: `https://github.com/ggml-org/whisper.cpp.git`
  - Source tag: `v1.8.6`
  - Patch: `patches/whisper.cpp/v1.8.6-server-multipart-wav.patch`
- `sherpa-onnx`: upstream SemVer `1.13.2`
  - Release base URL: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2`

Sherpa ONNX source assets:

- `linux-x64` CPU: `sherpa-onnx-v1.13.2-linux-x64-shared-no-tts.tar.bz2`

GPU runtime assets published for app download must be Murmur `tar.gz` archives with pinned SHA-256 metadata in `src/shared/stt-runtime-catalog.ts`. Publish CUDA/HIP runtime archives on runtime-only GitHub releases, not app release tags. Do not catalog Sherpa upstream `tar.bz2` GPU archives directly for app downloads; repackage them deterministically as Murmur `tar.gz` assets first.

## Whisper Patch

The temporary Whisper patch fixes `whisper-server` multipart WAV uploads when FFmpeg conversion is disabled. Upstream version `1.8.6` passes uploaded multipart bytes directly into `read_audio_data`; Murmur's patch writes uploaded bytes to a temporary WAV file with binary `write()` and then calls `read_audio_data()` with that path.

Remove the patch after the pinned upstream version includes the multipart WAV fix.

## Build Commands

Prepare current-platform runtimes:

```sh
mise run runtimes:prepare
```

Prepare optional whisper.cpp GPU variants on compatible Linux hosts:

```sh
npm run runtimes:prepare -- --accelerator cuda
MURMUR_ROCM_TARGETS=gfx1100 npm run runtimes:prepare -- --accelerator hip
```

Check current-platform runtime readiness:

```sh
mise run runtimes:doctor
npm run runtimes:doctor -- --accelerator cuda
```

Package after runtimes are present:

```sh
mise run runtimes:stage
mise run runtimes:package
mise run runtimes:manifest-check
mise run runtimes:manifest-check:release
```

`runtimes:stage` copies exactly one prepared platform from `vendor/runtimes/<platform-key>/` into `.cache/bundled-runtimes/runtimes/<platform-key>/` for `electron-builder` to place under `<process.resourcesPath>/runtimes/`.
Only CPU runtimes are staged into packaged app resources. GPU variants are optional installs and may download in packaged builds only when their Murmur release URL, size, and SHA-256 are configured.
Set `MURMUR_RUNTIME_VENDOR_ROOT` or `MURMUR_RUNTIME_STAGING_ROOT` to override those source and staging roots when testing the staging script.

For explicit-target packaging, pass the requested target:

```sh
npm run runtimes:stage -- --platform linux-x64
```

`runtimes:package` writes local packaging archives to `dist/runtimes/` and prints size and SHA-256 values. Those values must match `src/shared/stt-runtime-catalog.ts` for `runtimes:manifest-check` to pass.

To package an optional GPU runtime after preparing it:

```sh
npm run runtimes:package -- --accelerator cuda
npm run runtimes:package -- --accelerator hip
```

Murmur app releases should publish only the Electron app artifacts from `mise run dist`. Optional GPU runtime archives referenced by `src/shared/stt-runtime-catalog.ts` live on separate runtime-only releases, such as `stt-runtimes-0.1.0`. Runtime release versions, runtime bundle versions, and upstream runtime versions are SemVer values without a leading `v`; external source tags may still include their upstream prefix.

To publish prepared GPU runtime archives:

```sh
gh release create stt-runtimes-0.1.0 \
  dist/runtimes/murmur-stt-runtime-*-cuda-0.1.0.tar.gz \
  --repo strxnd/murmur \
  --title "Murmur STT GPU runtimes 0.1.0" \
  --notes "Optional CUDA/HIP STT runtime archives for Murmur."
```

If the runtime release already exists:

```sh
gh release upload stt-runtimes-0.1.0 dist/runtimes/murmur-stt-runtime-*-cuda-0.1.0.tar.gz --repo strxnd/murmur
```

Upload HIP/ROCm archives to the same runtime release after they are built and cataloged.

CPU runtime files are staged into packaged app resources; GPU runtime archives are downloaded into the user cache only after their runtime release URL, size, and SHA-256 are pinned.

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

## GPU Scope

- CUDA and HIP/ROCm apply only to Murmur-managed local STT runtimes.
- Local LLM GPU execution remains owned by Ollama and LM Studio.
- Sherpa ONNX has a CUDA provider path in this version; AMD uses the CPU Sherpa runtime.
- Vulkan is explicitly deferred until CUDA/HIP selection and packaging are proven.
- GPU probe output is advisory. Runtime launch and transcription success decide readiness, and `auto` retries CPU once after a GPU failure.

## Troubleshooting

Missing executable:

- Run `mise run runtimes:prepare`.
- Confirm `mise run runtimes:doctor` reports both runtimes available.
- Check that the executable is under `vendor/runtimes/<platform-key>/<runtime>/`.
- For app packaging, run `mise run runtimes:stage` and confirm both runtimes exist under `.cache/bundled-runtimes/runtimes/<platform-key>/`.
- Confirm `mise run runtimes:manifest-check` passes before packaging app artifacts.

Unsupported platform:

- Confirm `node -p "process.platform + '-' + process.arch"` returns one of the supported platform keys.

Dynamic library load failure:

- Confirm adjacent runtime `lib` or `bin` directories were copied with the executable.
- For development, run through Murmur so `LD_LIBRARY_PATH` is adjusted by `SttRuntimeService`.
- For direct shell smoke tests, export the needed library path manually from `vendor/runtimes/<platform-key>/<runtime>/lib`.
