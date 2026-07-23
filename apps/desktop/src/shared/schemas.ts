import { z } from "zod";
import { codexModel, codexProviderDefaults } from "./codex-provider";

export const maxIpcTextCharacters = 200_000;
export const maxRecordingAudioBytes = 150 * 1024 * 1024;

export const modeIconKeySchema = z.enum(["mic", "message-square", "mail", "notebook-pen", "sliders-horizontal"]);
export const sttStreamingModeSchema = z.enum(["none", "completed_audio_sse", "live_realtime"]);
export const recordingPillPositionSchema = z.enum(["bottom_left", "bottom_center", "bottom_right"]);
export const transcriptionProviderTypeSchema = z.enum([
  "whisper_cpp",
  "sherpa_onnx",
  "local_openai_compatible_stt",
  "cloud_openai",
  "cloud_openai_compatible_stt"
]);
export const llmProviderTypeSchema = z.enum([
  "ollama",
  "lmstudio",
  "llama_cpp_openai",
  "openai",
  "anthropic",
  "google",
  "codex",
  "custom_openai_compatible"
]);
export const modelKindSchema = z.enum(["voice", "language"]);
export const modelDiscoveryOriginSchema = z.enum(["discovered", "manual"]);
export const modelProviderSchema = z.enum([
  "whisper_cpp",
  "nvidia",
  "ollama",
  "lmstudio",
  "openai",
  "openai_compatible",
  "anthropic",
  "google",
  "codex"
]);
export const modelDownloadStrategySchema = z.enum(["direct_file", "archive", "ollama_pull", "none"]);
export const modelDownloadStatusSchema = z.enum(["not_downloaded", "downloading", "downloaded", "error"]);
export const sttRuntimeIdSchema = z.enum(["whisper.cpp", "sherpa-onnx"]);
export const sttRuntimeAcceleratorSchema = z.enum(["cpu", "cuda"]);

const semverPatternSource =
  "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const semverStringSchema = z.string().regex(new RegExp(`^${semverPatternSource}$`));

export const sttRuntimeVariantKeySchema = z
  .string()
  .regex(new RegExp(`^(whisper\\.cpp|sherpa-onnx)\\|[^|]+\\|(cpu|cuda)\\|${semverPatternSource}$`));
export const sttRuntimeActionTargetSchema = z.union([
  sttRuntimeVariantKeySchema,
  z.object({
    id: sttRuntimeIdSchema,
    accelerator: sttRuntimeAcceleratorSchema,
    variantKey: sttRuntimeVariantKeySchema.optional()
  })
]);
export const runtimeAvailabilityStatusSchema = z.enum(["available", "missing", "unsupported"]);
export const sttRuntimeInstallStatusSchema = z.enum([
  "ready",
  "not_installed",
  "downloading",
  "installing",
  "repairable",
  "error",
  "unsupported"
]);
export const sttRuntimeSourceSchema = z.enum(["env", "resources", "cache", "vendor"]);

const optionalStringSchema = z.string().optional();
const providerCredentialIntentSchema = z.enum(["keep", "replace", "remove"]);

export const contextSnapshotSchema = z
  .object({
    appName: optionalStringSchema,
    appId: optionalStringSchema,
    windowTitle: optionalStringSchema,
    selectedText: optionalStringSchema,
    clipboardText: optionalStringSchema,
    capturedAt: z.string(),
    sourceQuality: z.enum(["full", "partial", "fallback", "unavailable"]),
    diagnostics: z.array(z.string())
  });

export const modeConfigSchema = z
  .object({
    id: z.string().min(1),
    iconKey: modeIconKeySchema.catch("sliders-horizontal"),
    name: z.string().min(1, "Name is required."),
    description: z.string().catch(""),
    aiEnabled: z.boolean(),
    writingStyle: z.string().catch(""),
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
  downloadStrategy: modelDownloadStrategySchema,
  downloadUrl: optionalStringSchema,
  filename: optionalStringSchema,
  extractDir: optionalStringSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  ollamaModel: optionalStringSchema,
  discovery: z
    .object({
      origin: modelDiscoveryOriginSchema,
      providerId: z.string().min(1),
      lastSeenAt: optionalStringSchema,
      reachable: z.boolean(),
      message: optionalStringSchema
    })
    .optional(),
  defaultProviderConfig: z
    .object({
      providerId: z.string().min(1).optional(),
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
    apiKeyIntent: providerCredentialIntentSchema.optional(),
    hasStoredSecret: z.boolean().optional(),
    hasSecretRecord: z.boolean().optional(),
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
    apiKeyIntent: providerCredentialIntentSchema.optional(),
    hasStoredSecret: z.boolean().optional(),
    hasSecretRecord: z.boolean().optional(),
    isCloud: z.boolean(),
    defaultModel: optionalStringSchema,
    models: z.array(z.string()).optional(),
    enabled: z.boolean()
  })
  .superRefine((provider, context) => {
    if (provider.type !== "codex") return;
    if (provider.id !== codexProviderDefaults.id) {
      context.addIssue({ code: "custom", path: ["id"], message: `Codex provider ID must be ${codexProviderDefaults.id}.` });
    }
    if (provider.defaultModel !== codexModel) {
      context.addIssue({ code: "custom", path: ["defaultModel"], message: `Codex model must be ${codexModel}.` });
    }
    for (const field of ["baseUrl", "apiKeySecretId", "apiKey", "models"] as const) {
      if (provider[field] !== undefined) {
        context.addIssue({ code: "custom", path: [field], message: `Codex provider cannot set ${field}.` });
      }
    }
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
        appId: optionalStringSchema,
        appName: optionalStringSchema,
        windowTitleIncludes: optionalStringSchema
      })
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
    textRetentionDays: z.number().min(0),
    selectedTextCapture: z.enum(["disabled", "enabled"]),
    activeModeId: z.string().min(1),
    activationMode: z.enum(["toggle", "push_to_talk"]),
    activationHotkey: z.string().min(1),
    modeSelectorHotkey: z.string().min(1),
    recordingPillPosition: recordingPillPositionSchema,
    preferredAudioInputId: optionalStringSchema,
    typingBaselineWpm: z.number().min(1),
    trayCloseNoticeShownAt: optionalStringSchema,
    accelerationRuntimeInstallPromptDismissedAt: optionalStringSchema,
    sttSetupSkippedAt: optionalStringSchema,
    sttSetupCompletedAt: optionalStringSchema,
    onboardingSkippedAt: optionalStringSchema,
    onboardingCompletedAt: optionalStringSchema
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
    transcriptionAccelerator: sttRuntimeAcceleratorSchema.optional(),
    llmProviderId: optionalStringSchema,
    llmProviderType: optionalStringSchema,
    llmModel: optionalStringSchema,
    llmProviderCloud: z.boolean(),
    appName: optionalStringSchema,
    appId: optionalStringSchema,
    windowTitle: optionalStringSchema,
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
    variantKey: sttRuntimeVariantKeySchema,
    accelerator: sttRuntimeAcceleratorSchema,
    label: z.string(),
    status: runtimeAvailabilityStatusSchema,
    platformKey: z.string(),
    binaryPath: optionalStringSchema,
    source: sttRuntimeSourceSchema.optional(),
    version: semverStringSchema.optional(),
    abi: optionalStringSchema,
    message: z.string()
  })
  .passthrough();

export const sttRuntimeInstallStateSchema = z
  .object({
    id: sttRuntimeIdSchema,
    variantKey: sttRuntimeVariantKeySchema,
    accelerator: sttRuntimeAcceleratorSchema,
    label: z.string(),
    platformKey: z.string(),
    requiredVersion: semverStringSchema,
    installedVersion: semverStringSchema.optional(),
    status: sttRuntimeInstallStatusSchema,
    source: sttRuntimeSourceSchema.optional(),
    binaryPath: optionalStringSchema,
    rootDir: optionalStringSchema,
    abi: optionalStringSchema,
    progressBytes: z.number().min(0),
    totalBytes: z.number().min(0).optional(),
    error: optionalStringSchema,
    message: z.string(),
    canDownload: z.boolean(),
    canRepair: z.boolean()
  })
  .passthrough();

export const sttSetupSnapshotSchema = z
  .object({
    skipped: z.boolean(),
    completed: z.boolean(),
    needsSetup: z.boolean(),
    runtimes: z.record(sttRuntimeVariantKeySchema, sttRuntimeInstallStateSchema)
  })
  .passthrough();

export const accelerationProbeReportSchema = z.object({
  nvidia: z.object({
    available: z.boolean(),
    devices: z.array(z.string()),
    diagnostics: z.array(z.string())
  }),
  diagnostics: z.array(z.string())
});

export const automationPermissionReportSchema = z.object({
  status: z.enum(["not_required", "not_determined_or_denied", "trusted", "trusted_but_helper_failed"]),
  permissionRequired: z.boolean(),
  canPrompt: z.boolean(),
  diagnostics: z.array(z.string())
});

export const capabilityReportSchema = z
  .object({
    sttRuntimes: z.record(sttRuntimeVariantKeySchema, sttRuntimeAvailabilitySchema),
    stt: z.object({
      diagnostics: z.array(z.string()),
      accelerationProbe: accelerationProbeReportSchema
    }),
    hotkeys: z
      .object({
        backend: z.enum([
          "xdg_desktop_portal",
          "gnome_custom_shortcut",
          "kde_kglobalaccel",
          "hyprland_bind",
          "macos_event_tap",
          "electron_global_shortcut"
        ]),
        pushToTalkRelease: z.boolean(),
        registered: z.boolean(),
        triggerDescription: optionalStringSchema,
        diagnostics: z.array(z.string()),
        modeSelector: z.object({
          registered: z.boolean(),
          triggerDescription: optionalStringSchema,
          diagnostics: z.array(z.string())
        })
      }),
    context: z
      .object({
        backend: z.enum(["desktop_metadata", "clipboard_fallback"]),
        appMetadata: z.boolean(),
        selectedText: z.boolean(),
        diagnostics: z.array(z.string())
      }),
    automation: automationPermissionReportSchema,
    paste: z
      .object({
        backend: z.enum([
          "linux_native_helper",
          "macos_accessibility_helper",
          "wtype",
          "xdotool",
          "ydotool",
          "xdg_remote_desktop_keyboard",
          "clipboard_only"
        ]),
        automationAvailable: z.boolean(),
        permissionRequired: z.boolean(),
        diagnostics: z.array(z.string()),
        availableBackends: z
          .array(
            z.enum([
              "linux_native_helper",
              "macos_accessibility_helper",
              "wtype",
              "xdotool",
              "ydotool",
              "xdg_remote_desktop_keyboard",
              "clipboard_only"
            ])
          )
          .optional(),
        attemptedBackends: z
          .array(
            z.enum([
              "linux_native_helper",
              "macos_accessibility_helper",
              "wtype",
              "xdotool",
              "ydotool",
              "xdg_remote_desktop_keyboard",
              "clipboard_only"
            ])
          )
          .optional(),
        missingTools: z.array(z.string()).optional(),
        setupHints: z.array(z.string()).optional()
      }),
    storage: z
      .object({
        backend: z.enum(["sqlite", "json"]),
        diagnostics: z.array(z.string())
      })
  })
  .passthrough();

export const codexProviderRuntimeSchema = z.object({
  status: z.enum(["checking", "unavailable", "signed_out", "signing_in", "connected", "error"]),
  message: z.string(),
  accountLabel: optionalStringSchema,
  modelAvailable: z.boolean()
});

export const providerRuntimeSnapshotSchema = z.object({
  codex: codexProviderRuntimeSchema,
  secretStorage: z
    .object({
      status: z.enum(["encrypted", "plaintext", "unavailable"]),
      message: z.string()
    })
    .optional()
});

export const appStateSnapshotSchema = z
  .object({
    settings: appSettingsSchema,
    modes: z.array(modeConfigSchema),
    transcriptionProviders: z.array(transcriptionProviderConfigSchema),
    llmProviders: z.array(llmProviderConfigSchema),
    autoModeRules: z.array(autoModeRuleSchema),
    vocabulary: z.array(vocabularyEntrySchema),
    history: z.array(dictationHistoryItemSchema),
    modelLibrary: modelLibrarySnapshotSchema,
    releaseNotes: z.array(releaseNoteSchema),
    sttSetup: sttSetupSnapshotSchema,
    providerRuntime: providerRuntimeSnapshotSchema,
    session: dictationSessionSchema,
    capabilities: capabilityReportSchema
  })
  .passthrough();

export const pillStateSnapshotSchema = z
  .object({
    session: dictationSessionSchema,
    theme: appSettingsSchema.shape.theme
  })
  .passthrough();

export const modeSelectorStateSnapshotSchema = z
  .object({
    theme: appSettingsSchema.shape.theme,
    modes: z.array(modeConfigSchema),
    activeModeId: z.string().min(1),
    session: dictationSessionSchema
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

export const settingsUpdatePayloadSchema = appSettingsSchema.partial().strict();
export const modesSetPayloadSchema = z.array(modeConfigSchema);
export const sttProvidersSetPayloadSchema = z.array(transcriptionProviderConfigSchema);
export const llmProvidersSetPayloadSchema = z.array(llmProviderConfigSchema);
export const autoModeRulesSetPayloadSchema = z.array(autoModeRuleSchema);
export const vocabularySetPayloadSchema = z.array(vocabularyEntrySchema);
export const ipcIdPayloadSchema = z.string().min(1).max(512);
export const ipcTextPayloadSchema = z.string().max(maxIpcTextCharacters);
export const onboardingDictationScopePayloadSchema = z.object({ active: z.boolean() });
export const modeSelectorMovePayloadSchema = z.number().int().min(-1).max(1);

export const completeRecordingPayloadSchema = z.object({
  sessionId: z.string().min(1),
  audio: z.instanceof(ArrayBuffer).refine((audio) => audio.byteLength <= maxRecordingAudioBytes, "Recording is too large."),
  mimeType: z.string().min(1)
});

export const recordingErrorPayloadSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(2000)
});

export const recordingLevelPayloadSchema = z.object({
  sessionId: z.string().min(1),
  level: z
    .number()
    .finite()
    .transform((level) => Math.max(0, Math.min(1, level)))
});

export const copyResultSchema = z.object({ ok: z.boolean() }).passthrough();
export const pasteResultSchema = z
  .object({
    pasted: z.boolean(),
    message: z.string()
  })
  .passthrough();
