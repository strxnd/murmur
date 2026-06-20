# Dictation Lifecycle

Dictation is coordinated by [`AppController`](../../src/main/app-controller.ts). Audio capture happens in the renderer, while STT, prompt construction, LLM processing, paste automation, and history writes happen in the main process.

```mermaid
sequenceDiagram
  participant User
  participant Hotkey as Hotkey or UI
  participant Main as AppController
  participant Context as ContextService
  participant Renderer
  participant STT as TranscriptionService
  participant LLM as LlmService
  participant Paste as PasteService
  participant Storage as StorageService

  User->>Hotkey: Start dictation
  Hotkey->>Main: dictation:start or activation callback
  Main->>Main: Check STT usability and create session
  Main-->>Renderer: recording:start(sessionId)
  Main->>Context: Capture app and selection context
  Renderer->>Renderer: Capture microphone and encode levels
  User->>Hotkey: Stop dictation
  Hotkey->>Main: dictation:stop
  Main-->>Renderer: recording:stop(sessionId)
  Renderer->>Main: dictation:complete-recording(WAV)
  Main->>STT: Transcribe audio
  STT-->>Main: Raw transcript and model metadata
  Main->>Main: Apply before-LLM replacements
  alt mode.aiEnabled and provider enabled
    Main->>LLM: Process prompt with context and vocabulary
    LLM-->>Main: Processed text
  else no LLM
    Main->>Main: Use transcript text
  end
  Main->>Main: Apply after-LLM replacements
  Main->>Paste: Insert text
  Paste-->>Main: pasted or clipboard fallback
  Main->>Storage: Add history item
  Main-->>Renderer: state:changed
```

## Session States

`DictationSession.status` moves through:

- `recording`
- `transcribing`
- `processing`
- `pasting`
- `complete`
- `cancelled`
- `error`

The controller blocks a new recording while `transcribing`, `processing`, or `pasting` is active.

## Processing Order

1. Capture context during recording.
2. Receive completed WAV from the renderer.
3. Transcribe audio through the selected STT provider.
4. Apply enabled replacements marked `runBeforeLlm`.
5. Build an LLM prompt from mode instructions, examples, vocabulary, transcript, and context.
6. If AI processing fails, fall back to the before-LLM transcript.
7. Apply enabled replacements marked `runAfterLlm`.
8. Paste or leave output on the clipboard.
9. Store history and optional retained audio.

## Extension Points

- Add new STT provider behavior in [`src/main/services/stt.ts`](../../src/main/services/stt.ts).
- Add prompt behavior in [`src/shared/prompts.ts`](../../src/shared/prompts.ts).
- Add replacement behavior in [`src/shared/replacements.ts`](../../src/shared/replacements.ts).
- Add paste backends behind [`TextAutomationService`](../../src/main/services/text-automation.ts).
