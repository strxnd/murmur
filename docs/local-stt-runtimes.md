# Local STT Runtimes

Murmur supports two bundled native STT runtime targets:

- `whisper.cpp` for local Whisper GGML models.
- `sherpa-onnx` for NVIDIA Parakeet models converted to ONNX.

## Runtime Binary Layout

During development, put runtime binaries under:

```text
vendor/runtimes/<platform>-<arch>/whisper.cpp/whisper-server
vendor/runtimes/<platform>-<arch>/sherpa-onnx/sherpa-onnx-offline
```

For the current Linux x64 target, that is:

```text
vendor/runtimes/linux-x64/whisper.cpp/whisper-server
vendor/runtimes/linux-x64/sherpa-onnx/sherpa-onnx-offline
```

Packaged builds should place the same `runtimes/<platform>-<arch>/...` tree under Electron `process.resourcesPath`.
Sherpa model archive extraction uses the system `tar` command.

Development overrides:

```sh
MURMUR_WHISPER_CPP_SERVER=/absolute/path/to/whisper-server
MURMUR_SHERPA_ONNX_OFFLINE=/absolute/path/to/sherpa-onnx-offline
MURMUR_STT_THREADS=4
```

## Model Storage

Downloaded STT models live under Electron `userData`:

```text
<userData>/models/stt/
```

Whisper models are direct GGML files, for example:

```text
<userData>/models/stt/ggml-base.en.bin
```

Sherpa ONNX Parakeet models are downloaded as `.tar.bz2` archives, extracted, and then tracked by their extracted directory:

```text
<userData>/models/stt/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/
```

## Runtime Behavior

When a Whisper model is selected from the model library, Murmur configures the STT provider with:

```text
baseUrl: murmur://runtime/whisper.cpp
model: <ggml filename>
```

At transcription time, Murmur starts `whisper-server` on an ephemeral localhost port with the selected model and posts the recorded WAV to `/inference`.

When a NVIDIA Parakeet model is selected, Murmur configures:

```text
type: sherpa_onnx
baseUrl: murmur://runtime/sherpa-onnx
model: <extracted model directory>
```

At transcription time, Murmur runs `sherpa-onnx-offline` directly against the recorded WAV. It auto-detects supported Sherpa model layouts:

- NeMo CTC: `model.int8.onnx` or `model.onnx` plus `tokens.txt`.
- NeMo transducer: `encoder`, `decoder`, and `joiner` ONNX files plus `tokens.txt`.

The renderer records mono 16-bit PCM WAV so these native runtimes do not need FFmpeg for normal dictation.
