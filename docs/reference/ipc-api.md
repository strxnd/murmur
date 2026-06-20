# IPC API

The public renderer API is exposed as `window.murmur` by [`src/preload/index.ts`](../../src/preload/index.ts). Renderer code normally uses [`murmurClient`](../../src/renderer/src/lib/murmur-client.ts), which validates returned data with shared schemas.

## State and Settings

| Method | IPC channel | Returns |
| --- | --- | --- |
| `getState()` | `app:get-state` | `AppStateSnapshot` |
| `updateSettings(patch)` | `settings:update` | `AppStateSnapshot` |
| `clearLocalData()` | `data:clear-local` | `AppStateSnapshot` |
| `onStateChanged(callback)` | `state:changed` | unsubscribe function |

## Hotkeys, Modes, and Rules

| Method | IPC channel | Returns |
| --- | --- | --- |
| `beginHotkeyCapture()` | `hotkeys:capture-start` | `{ ok: boolean }` |
| `endHotkeyCapture()` | `hotkeys:capture-end` | `{ ok: boolean }` |
| `setModes(modes)` | `modes:set` | `AppStateSnapshot` |
| `activateMode(modeId)` | `mode:activate` | `AppStateSnapshot` |
| `setAutoModeRules(rules)` | `rules:set-auto-mode` | `AppStateSnapshot` |
| `setReplacements(replacements)` | `replacements:set` | `AppStateSnapshot` |
| `setVocabulary(vocabulary)` | `vocabulary:set` | `AppStateSnapshot` |

## Providers

| Method | IPC channel | Returns |
| --- | --- | --- |
| `setSttProviders(providers)` | `providers:set-stt` | `AppStateSnapshot` |
| `setLlmProviders(providers)` | `providers:set-llm` | `AppStateSnapshot` |
| `validateSttProvider(provider)` | `provider:validate-stt` | `ProviderValidationResult` |
| `validateLlmProvider(provider)` | `provider:validate-llm` | `ProviderValidationResult` |

## Models and Runtime Setup

| Method | IPC channel | Returns |
| --- | --- | --- |
| `getModelLibrary()` | `models:get-library` | `ModelLibrarySnapshot` |
| `downloadModel(modelId)` | `models:download` | `ModelLibrarySnapshot` |
| `cancelModelDownload(modelId)` | `models:cancel-download` | `ModelLibrarySnapshot` |
| `activateModel(modelId)` | `models:activate` | `ModelLibrarySnapshot` |
| `deleteDownloadedModel(modelId)` | `models:delete` | `ModelLibrarySnapshot` |
| `toggleFavoriteModel(modelId)` | `models:toggle-favorite` | `ModelLibrarySnapshot` |
| `getSttSetup()` | `stt-setup:get` | `SttSetupSnapshot` |
| `downloadSttRuntime(runtimeId)` | `stt-runtime:download` | `SttSetupSnapshot` |
| `repairSttRuntime(runtimeId)` | `stt-runtime:repair` | `SttSetupSnapshot` |
| `cancelSttRuntimeDownload(runtimeId)` | `stt-runtime:cancel-download` | `SttSetupSnapshot` |
| `runSttBenchmark(languageScope)` | `stt-setup:benchmark` | `SttModelRecommendation` |
| `setupBundledStt(modelId)` | `stt-setup:setup-bundled` | `AppStateSnapshot` |
| `skipSttSetup()` | `stt-setup:skip` | `AppStateSnapshot` |
| `onModelDownloadProgress(callback)` | `models:download-progress` | unsubscribe function |
| `onSttRuntimeProgress(callback)` | `stt-runtime:progress` | unsubscribe function |

## Dictation and Recording

| Method | IPC channel | Returns |
| --- | --- | --- |
| `startDictation()` | `dictation:start` | `AppStateSnapshot` |
| `stopDictation()` | `dictation:stop` | `AppStateSnapshot` |
| `cancelDictation()` | `dictation:cancel` | `AppStateSnapshot` |
| `completeRecording(payload)` | `dictation:complete-recording` | `AppStateSnapshot` |
| `publishRecordingLevel(payload)` | `recording:level` send | `void` |
| `onRecordingStart(callback)` | `recording:start` | unsubscribe function |
| `onRecordingStop(callback)` | `recording:stop` | unsubscribe function |
| `onRecordingCancel(callback)` | `recording:cancel` | unsubscribe function |
| `onRecordingLevel(callback)` | `recording:level` | unsubscribe function |
| `onTranscriptDelta(callback)` | `dictation:transcript-delta` | unsubscribe function |

`completeRecording` payload:

```ts
{
  sessionId: string;
  audio: ArrayBuffer;
  mimeType: string;
}
```

`publishRecordingLevel` payload:

```ts
{
  sessionId: string;
  level: number;
}
```

## History

| Method | IPC channel | Returns |
| --- | --- | --- |
| `copyHistoryOutput(text)` | `history:copy` | `{ ok: boolean }` |
| `repasteHistoryOutput(text)` | `history:repaste` | `{ pasted: boolean; message: string }` |
| `deleteHistoryItem(id)` | `history:delete` | `AppStateSnapshot` |
| `clearHistory()` | `history:clear` | `AppStateSnapshot` |
| `reprocessHistoryItem(id)` | `history:reprocess` | `AppStateSnapshot` |
