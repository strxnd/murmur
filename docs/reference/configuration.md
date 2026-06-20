# Configuration

Configuration and snapshot types are defined in [`src/shared/types.ts`](../../src/shared/types.ts). Defaults are defined in [`src/shared/defaults.ts`](../../src/shared/defaults.ts).

## AppStateSnapshot

`AppStateSnapshot` is the renderer's main state payload:

```ts
interface AppStateSnapshot {
  settings: AppSettings;
  modes: ModeConfig[];
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
  autoModeRules: AutoModeRule[];
  replacements: ReplacementRule[];
  vocabulary: VocabularyEntry[];
  history: DictationHistoryItem[];
  modelLibrary: ModelLibrarySnapshot;
  releaseNotes: ReleaseNote[];
  sttSetup: SttSetupSnapshot;
  session: DictationSession;
  capabilities: CapabilityReport;
}
```

## AppSettings

Important settings:

- `theme`: `system`, `light`, or `dark`.
- `launchAtLogin`: passed to Electron login item settings.
- `localOnly`: blocks cloud STT and LLM provider use.
- `retainAudio`: controls whether completed recordings are saved.
- `selectedTextCapture`: `disabled` or `clipboard_restore`.
- `pasteMethod`: currently normalized to `clipboard_restore`.
- `activationMode`: `toggle` or `push_to_talk`.
- `activationHotkey`: Electron accelerator string.
- `recordingPillPosition`: `bottom_left`, `bottom_center`, or `bottom_right`.
- `sttPreferredLanguageScope`: `multilingual` or `english`.

## Modes

`ModeConfig` controls dictation behavior:

- `kind`: `built_in` or `custom`.
- `aiEnabled`: whether LLM processing runs.
- `instructionPrompt`: mode-specific processing instruction.
- `examples`: input/output examples used by prompt building.
- `language`: model language or `auto`.
- `context`: booleans for app, selected text, and clipboard text.

Built-in mode ids are `default`, `voice_to_text`, `message`, `mail`, and `note`.

## Providers

`TranscriptionProviderConfig` includes `type`, `baseUrl`, optional `endpointPath`, optional `apiKey`, cloud/local flags, default model and language, `streamingMode`, and `enabled`.

STT provider types:

- `whisper_cpp`
- `sherpa_onnx`
- `local_openai_compatible_stt`
- `cloud_openai`
- `cloud_groq`
- `cloud_openai_compatible_stt`

`LlmProviderConfig` includes `type`, optional `baseUrl`, optional `apiKey`, cloud flag, default model, and `enabled`.

LLM provider types:

- `ollama`
- `lmstudio`
- `llama_cpp_openai`
- `openai`
- `anthropic`
- `google`
- `openrouter`
- `custom_openai_compatible`

## Rules, Replacements, and Vocabulary

`AutoModeRule` matches on domain, domain wildcard, app id, app name, or window title text. Enabled rules are sorted by descending priority.

`ReplacementRule` can run before and/or after LLM processing, with optional regex and case-sensitive behavior.

`VocabularyEntry` contributes domain terms and pronunciations to the vocabulary prompt when enabled.

## History and Session

`DictationHistoryItem` stores raw transcript, processed output, mode/provider metadata, context metadata, timestamps, optional retained audio path, and word counts.

`DictationSession.status` is one of `idle`, `recording`, `transcribing`, `processing`, `pasting`, `complete`, `cancelled`, or `error`.

## Capabilities

`CapabilityReport` describes detected runtime, hotkey, context, paste, and storage capabilities. It is computed at snapshot time and is not stored directly in config.
