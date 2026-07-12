# Configuration

Configuration and snapshot types are defined in [`src/shared/types.ts`](../../apps/desktop/src/shared/types.ts). Defaults are defined in [`src/shared/defaults.ts`](../../apps/desktop/src/shared/defaults.ts).

## AppStateSnapshot

`AppStateSnapshot` is the renderer's main state payload:

```ts
interface AppStateSnapshot {
  settings: AppSettings;
  modes: ModeConfig[];
  transcriptionProviders: TranscriptionProviderConfig[];
  llmProviders: LlmProviderConfig[];
  autoModeRules: AutoModeRule[];
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
- `selectedTextCapture`: `disabled` or `enabled`.
- `activationMode`: `toggle` or `push_to_talk`.
- `activationHotkey`: Electron accelerator string.
- `modeSelectorHotkey`: Electron accelerator string for the centered mode selector overlay.
- `recordingPillPosition`: `bottom_left`, `bottom_center`, or `bottom_right`.
- Murmur-managed local STT runtimes choose acceleration automatically. When an accelerated runtime is available, it is used before CPU.
- `accelerationRuntimeInstallPromptDismissedAt`: timestamp recorded when the first-entry accelerated runtime install prompt is dismissed.

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

`TranscriptionProviderConfig` includes `type`, `baseUrl`, optional `endpointPath`, optional `apiKeySecretId`, cloud/local flags, default model and language, `streamingMode`, and `enabled`. Raw `apiKey` values are accepted during updates and migrated into the provider secret store.

STT provider types:

- `whisper_cpp`
- `sherpa_onnx`
- `local_openai_compatible_stt`
- `cloud_openai`
- `cloud_openai_compatible_stt`

`LlmProviderConfig` includes `type`, optional `baseUrl`, optional `apiKeySecretId`, cloud flag, default model, and `enabled`. Raw `apiKey` values are accepted during updates and migrated into the provider secret store.

LLM provider types:

- `ollama`
- `lmstudio`
- `llama_cpp_openai`
- `openai`
- `anthropic`
- `google`
- `custom_openai_compatible`

## Rules and Vocabulary

`AutoModeRule` matches on app id, app name, or window title text. Enabled rules are sorted by descending priority.

`VocabularyEntry` contributes domain terms and pronunciations to the vocabulary prompt when enabled.

## History and Session

`DictationHistoryItem` stores raw transcript, processed output, mode/provider metadata, context metadata, timestamps, a legacy nullable audio path, and word counts.

`DictationSession.status` is one of `idle`, `recording`, `transcribing`, `processing`, `pasting`, `complete`, `cancelled`, or `error`.

## Capabilities

`CapabilityReport` describes detected runtime variants, advisory STT acceleration probe output, hotkey, automation permission, context, paste, and storage capabilities. It is computed at snapshot time and is not stored directly in config.
