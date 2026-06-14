import { z } from "zod";

export const dictationModeKindSchema = z.enum(["default", "custom"]);
export const modePresetIdSchema = z.enum(["voice_to_text", "message", "mail", "note", "custom"]);
export const sttStreamingModeSchema = z.enum(["none", "completed_audio_sse", "live_realtime"]);
export const transcriptionProviderTypeSchema = z.enum([
  "whisper_cpp",
  "sherpa_onnx",
  "local_openai_compatible_stt",
  "cloud_openai",
  "cloud_groq",
  "cloud_openai_compatible_stt"
]);
export const llmProviderTypeSchema = z.enum([
  "ollama",
  "lmstudio",
  "llama_cpp_openai",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "custom_openai_compatible"
]);
export const modelKindSchema = z.enum(["voice", "language"]);
export const modelProviderSchema = z.enum(["whisper_cpp", "nvidia", "ollama", "openai", "groq", "anthropic", "google", "openrouter"]);
export const modelDownloadStrategySchema = z.enum(["direct_file", "archive", "ollama_pull", "none"]);
export const modelDownloadStatusSchema = z.enum(["not_downloaded", "downloading", "downloaded", "error"]);
export const sttRuntimeIdSchema = z.enum(["whisper.cpp", "sherpa-onnx"]);
export const runtimeAvailabilityStatusSchema = z.enum(["available", "missing", "unsupported"]);

const optionalStringSchema = z.string().optional();

export const contextSnapshotSchema = z
  .object({
    appName: optionalStringSchema,
    appId: optionalStringSchema,
    windowTitle: optionalStringSchema,
    browserUrl: optionalStringSchema,
    browserDomain: optionalStringSchema,
    focusedRole: optionalStringSchema,
    focusedText: optionalStringSchema,
    selectedText: optionalStringSchema,
    clipboardText: optionalStringSchema,
    capturedAt: z.string(),
    sourceQuality: z.enum(["full", "partial", "fallback", "unavailable"]),
    diagnostics: z.array(z.string())
  });

export const modeConfigSchema = z
  .object({
    id: z.string().min(1),
    kind: dictationModeKindSchema,
    presetId: modePresetIdSchema.catch("custom"),
    name: z.string().min(1, "Name is required."),
    aiEnabled: z.boolean(),
    instructionPrompt: z.string(),
    examples: z.array(z.object({ input: z.string(), output: z.string() })),
    language: z.union([z.string(), z.literal("auto")]).optional(),
    context: z.object({
      app: z.boolean(),
      selectedText: z.boolean(),
      clipboardText: z.boolean()
    })
  });

export const releaseNoteSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  heading: z.string().min(1),
  summary: optionalStringSchema
});

export const modelCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: modelKindSchema,
  provider: modelProviderSchema,
  description: optionalStringSchema,
  sizeBytes: z.number().optional(),
  isCloud: z.boolean(),
  isOffline: z.boolean(),
  tags: z.array(z.string()),
  downloadStrategy: modelDownloadStrategySchema,
  downloadUrl: optionalStringSchema,
  filename: optionalStringSchema,
  extractDir: optionalStringSchema,
  ollamaModel: optionalStringSchema,
  defaultProviderConfig: z
    .object({
      sttProviderType: transcriptionProviderTypeSchema.optional(),
      llmProviderType: llmProviderTypeSchema.optional(),
      baseUrl: optionalStringSchema,
      endpointPath: optionalStringSchema,
      model: optionalStringSchema
    })
    .optional()
});

export const modelDownloadStateSchema = z.object({
  modelId: z.string().min(1),
  status: modelDownloadStatusSchema,
  progressBytes: z.number().min(0),
  totalBytes: z.number().optional(),
  localPath: optionalStringSchema,
  error: optionalStringSchema,
  downloadedAt: optionalStringSchema,
  favorite: z.boolean()
});

export const modelLibrarySnapshotSchema = z.object({
  catalog: z.array(modelCatalogItemSchema),
  downloads: z.array(modelDownloadStateSchema),
  activeModelIds: z
    .object({
      voice: optionalStringSchema,
      language: optionalStringSchema
    })
    .catch({})
});

export const transcriptionProviderConfigSchema = z
  .object({
    id: z.string().min(1),
    type: transcriptionProviderTypeSchema,
    name: z.string().min(1, "Name is required."),
    baseUrl: z.string().min(1, "Base URL is required."),
    endpointPath: optionalStringSchema,
    apiKeySecretId: optionalStringSchema,
    apiKey: optionalStringSchema,
    isCloud: z.boolean(),
    isLocal: z.boolean(),
    defaultModel: optionalStringSchema,
    defaultLanguage: z.union([z.string(), z.literal("auto")]).optional(),
    streamingMode: sttStreamingModeSchema,
    enabled: z.boolean()
  });

export const llmProviderConfigSchema = z
  .object({
    id: z.string().min(1),
    type: llmProviderTypeSchema,
    name: z.string().min(1, "Name is required."),
    baseUrl: z.string().optional(),
    apiKeySecretId: optionalStringSchema,
    apiKey: optionalStringSchema,
    isCloud: z.boolean(),
    defaultModel: optionalStringSchema,
    enabled: z.boolean()
  });

export const autoModeRuleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1, "Name is required."),
    modeId: z.string().min(1),
    priority: z.number(),
    enabled: z.boolean(),
    match: z
      .object({
        domain: optionalStringSchema,
        domainWildcard: optionalStringSchema,
        appId: optionalStringSchema,
        appName: optionalStringSchema,
        windowTitleIncludes: optionalStringSchema
      })
  });

export const replacementRuleSchema = z
  .object({
    id: z.string().min(1),
    source: z.string(),
    target: z.string(),
    category: optionalStringSchema,
    caseSensitive: z.boolean(),
    regex: z.boolean(),
    runBeforeLlm: z.boolean(),
    runAfterLlm: z.boolean(),
    enabled: z.boolean(),
    notes: optionalStringSchema
  });

export const vocabularyEntrySchema = z
  .object({
    id: z.string().min(1),
    term: z.string(),
    pronunciation: optionalStringSchema,
    category: optionalStringSchema,
    enabled: z.boolean(),
    notes: optionalStringSchema
  });

export const appSettingsSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    launchAtLogin: z.boolean(),
    localOnly: z.boolean(),
    retainAudio: z.boolean(),
    audioRetentionDays: z.number().min(0),
    textRetentionDays: z.number().min(0),
    selectedTextCapture: z.enum(["disabled", "clipboard_restore"]),
    pasteMethod: z.enum(["clipboard_restore", "clipboard_only"]),
    activeModeId: z.string().min(1),
    toggleHotkey: z.string().min(1),
    pushToTalkHotkey: z.string().min(1),
    cancelHotkey: z.string().min(1),
    preferredAudioInputId: optionalStringSchema,
    typingBaselineWpm: z.number().min(1),
    autoIncreaseMicVolume: z.boolean()
  });

export const dictationHistoryItemSchema = z
  .object({
    id: z.string().min(1),
    audioPath: z.string().nullable(),
    rawTranscript: z.string(),
    processedOutput: z.string(),
    modeId: z.string(),
    modeName: z.string(),
    transcriptionProviderId: optionalStringSchema,
    transcriptionProviderType: optionalStringSchema,
    transcriptionModel: optionalStringSchema,
    transcriptionProviderCloud: z.boolean(),
    transcriptionStreamingMode: sttStreamingModeSchema,
    llmProviderId: optionalStringSchema,
    llmProviderType: optionalStringSchema,
    llmModel: optionalStringSchema,
    llmProviderCloud: z.boolean(),
    appName: optionalStringSchema,
    appId: optionalStringSchema,
    windowTitle: optionalStringSchema,
    browserDomain: optionalStringSchema,
    createdAt: z.string(),
    recordingStartedAt: optionalStringSchema,
    recordingStoppedAt: optionalStringSchema,
    recordingDurationMs: z.number().min(0).optional(),
    rawWordCount: z.number().min(0).optional(),
    processedWordCount: z.number().min(0).optional()
  });

export const dictationSessionSchema = z
  .object({
    id: z.string(),
    status: z.enum(["idle", "recording", "transcribing", "processing", "pasting", "complete", "cancelled", "error"]),
    modeId: z.string(),
    startedAt: optionalStringSchema,
    transcriptPreview: optionalStringSchema,
    error: optionalStringSchema,
    cloudStt: z.boolean(),
    cloudLlm: z.boolean(),
    streamingMode: sttStreamingModeSchema
  });

export const sttRuntimeAvailabilitySchema = z
  .object({
    id: sttRuntimeIdSchema,
    label: z.string(),
    status: runtimeAvailabilityStatusSchema,
    platformKey: z.string(),
    binaryPath: optionalStringSchema,
    source: z.enum(["env", "resources", "vendor", "legacy_vendor"]).optional(),
    version: optionalStringSchema,
    message: z.string()
  })
  .passthrough();

export const capabilityReportSchema = z
  .object({
    sttRuntimes: z.record(sttRuntimeIdSchema, sttRuntimeAvailabilitySchema),
    hotkeys: z
      .object({
        backend: z.literal("electron_global_shortcut"),
        pushToTalkRelease: z.boolean(),
        registered: z.boolean(),
        diagnostics: z.array(z.string())
      }),
    context: z
      .object({
        backend: z.literal("hyprctl_clipboard_fallback"),
        appMetadata: z.boolean(),
        focusedText: z.boolean(),
        selectedText: z.boolean(),
        browserDomain: z.boolean(),
        diagnostics: z.array(z.string())
      }),
    paste: z
      .object({
        backend: z.enum(["ydotool_clipboard", "clipboard_only"]),
        automationAvailable: z.boolean(),
        diagnostics: z.array(z.string())
      }),
    storage: z
      .object({
        backend: z.enum(["sqlite", "json"]),
        diagnostics: z.array(z.string())
      }),
    sound: z
      .object({
        backend: z.literal("wpctl_pactl"),
        wpctlAvailable: z.boolean(),
        pactlAvailable: z.boolean(),
        diagnostics: z.array(z.string())
      })
  })
  .passthrough();

export const appStateSnapshotSchema = z
  .object({
    settings: appSettingsSchema,
    modes: z.array(modeConfigSchema),
    transcriptionProviders: z.array(transcriptionProviderConfigSchema),
    llmProviders: z.array(llmProviderConfigSchema),
    autoModeRules: z.array(autoModeRuleSchema),
    replacements: z.array(replacementRuleSchema),
    vocabulary: z.array(vocabularyEntrySchema),
    history: z.array(dictationHistoryItemSchema),
    modelLibrary: modelLibrarySnapshotSchema,
    releaseNotes: z.array(releaseNoteSchema),
    session: dictationSessionSchema,
    capabilities: capabilityReportSchema
  })
  .passthrough();

export const providerValidationResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    capabilities: z
      .object({
        fileTranscription: z.boolean().optional(),
        completedAudioStreaming: z.boolean().optional(),
        liveRealtimeStreaming: z.boolean().optional(),
        modelDiscovery: z.boolean().optional()
      })
      .optional()
  })
  .passthrough();

export const completeRecordingPayloadSchema = z.object({
  sessionId: z.string().min(1),
  audio: z.instanceof(ArrayBuffer),
  mimeType: z.string().min(1)
});

export const copyResultSchema = z.object({ ok: z.boolean() }).passthrough();
export const pasteResultSchema = z
  .object({
    pasted: z.boolean(),
    message: z.string()
  })
  .passthrough();
