# Providers

Provider config types live in [`src/shared/types.ts`](../../apps/desktop/src/shared/types.ts). Defaults live in [`src/shared/defaults.ts`](../../apps/desktop/src/shared/defaults.ts).

## STT Providers

Supported transcription provider types:

- `whisper_cpp`
- `sherpa_onnx`
- `local_openai_compatible_stt`
- `cloud_openai`
- `cloud_openai_compatible_stt`

Bundled `whisper.cpp` uses `murmur://runtime/whisper.cpp`; external `whisper.cpp` uses a configured HTTP base URL. Bundled Sherpa ONNX uses `murmur://runtime/sherpa-onnx` and runs the local binary directly.

OpenAI-compatible STT providers post completed audio to `/audio/transcriptions` by default. Completed-audio SSE is used only when `streamingMode` remains effective for the provider and model. `whisper-1` forces non-streaming behavior.

Validation checks:

- Base URL presence and URL syntax for HTTP providers.
- API key presence for cloud providers.
- Runtime and model availability for bundled runtime providers.
- `/models` reachability for OpenAI-compatible providers when applicable.

## LLM Providers

Supported language provider types:

- `ollama`
- `lmstudio`
- `llama_cpp_openai`
- `openai`
- `anthropic`
- `google`
- `custom_openai_compatible`

Ollama uses `/api/chat`. OpenAI-compatible providers use `/chat/completions`. Anthropic uses `/v1/messages`. Google uses `/models/<model>:generateContent`.

If LLM processing fails during dictation, Murmur logs a warning and uses the transcript rather than failing the whole dictation.

## Model Activation

The model library can synthesize provider configs from catalog items through [`src/shared/model-activation.ts`](../../apps/desktop/src/shared/model-activation.ts). Voice models map to STT providers; language models map to LLM providers. A model is only selectable when its download state and required runtime are ready.
