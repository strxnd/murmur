import type {
  AppSettings,
  AutoModeRule,
  LlmProviderConfig,
  ModeConfig,
  TranscriptionProviderConfig,
  VocabularyEntry
} from "../../shared/types";
export type RecordingSource = "dictation" | "onboarding";
export type DictationSessionPhase = "recording" | "awaiting_audio" | "processing";
export type DictationInvalidationReason = "cancelled" | "cleared" | "failed" | "shutdown" | "superseded" | "timed_out" | "completed";

export interface DictationProcessingPlan {
  readonly source: RecordingSource;
  readonly settings: AppSettings;
  readonly modes: readonly ModeConfig[];
  readonly autoModeRules: readonly AutoModeRule[];
  readonly vocabulary: readonly VocabularyEntry[];
  readonly sttProvider: TranscriptionProviderConfig;
  readonly llmProvider?: LlmProviderConfig;
}

export interface DictationSessionOperation {
  readonly sessionId: string;
  readonly generation: number;
  readonly plan: DictationProcessingPlan;
  readonly controller: AbortController;
  phase: DictationSessionPhase;
}

export class StaleDictationSessionError extends Error {
  constructor() {
    super("The dictation session is no longer active.");
    this.name = "StaleDictationSessionError";
  }
}

export class DictationSessionOwner {
  private generation = 0;
  private active: DictationSessionOperation | null = null;

  start(sessionId: string, plan: DictationProcessingPlan): DictationSessionOperation {
    this.invalidate("superseded");
    const operation: DictationSessionOperation = {
      sessionId,
      generation: this.generation,
      plan,
      controller: new AbortController(),
      phase: "recording"
    };
    this.active = operation;
    return operation;
  }

  markAwaitingAudio(operation: DictationSessionOperation): void {
    this.assertCurrent(operation);
    if (operation.phase !== "recording") throw new StaleDictationSessionError();
    operation.phase = "awaiting_audio";
  }

  claimAudio(sessionId: string): DictationSessionOperation | null {
    const operation = this.active;
    if (!operation || operation.sessionId !== sessionId || operation.phase !== "awaiting_audio" || operation.controller.signal.aborted) {
      return null;
    }
    operation.phase = "processing";
    return operation;
  }

  isCurrent(operation: DictationSessionOperation): boolean {
    return this.active === operation && operation.generation === this.generation && !operation.controller.signal.aborted;
  }

  assertCurrent(operation: DictationSessionOperation): void {
    if (!this.isCurrent(operation)) throw new StaleDictationSessionError();
  }

  invalidate(reason: DictationInvalidationReason): void {
    const operation = this.active;
    this.active = null;
    this.generation += 1;
    if (operation && !operation.controller.signal.aborted) {
      operation.controller.abort(new DOMException(`Dictation ${reason}.`, "AbortError"));
    }
  }
}

export function createDictationProcessingPlan(options: {
  source: RecordingSource;
  settings: AppSettings;
  modes: ModeConfig[];
  autoModeRules: AutoModeRule[];
  vocabulary: VocabularyEntry[];
  sttProvider: TranscriptionProviderConfig;
  llmProvider?: LlmProviderConfig;
}): DictationProcessingPlan {
  const settings = Object.freeze({ ...options.settings });
  const modes = Object.freeze(
    options.modes.map((mode) =>
      Object.freeze({
        ...mode,
        examples: Object.freeze(mode.examples.map((example) => Object.freeze({ ...example }))),
        context: Object.freeze({ ...mode.context })
      })
    )
  );
  const autoModeRules = Object.freeze(
    options.autoModeRules.map((rule) => Object.freeze({ ...rule, match: Object.freeze({ ...rule.match }) }))
  );
  const vocabulary = Object.freeze(options.vocabulary.map((entry) => Object.freeze({ ...entry })));
  const sttProvider = Object.freeze({ ...options.sttProvider });
  const llmProvider = options.llmProvider
    ? Object.freeze({
        ...options.llmProvider,
        models: options.llmProvider.models ? Object.freeze([...options.llmProvider.models]) : undefined
      })
    : undefined;

  return Object.freeze({
    source: options.source,
    settings,
    modes,
    autoModeRules,
    vocabulary,
    sttProvider,
    llmProvider
  }) as unknown as DictationProcessingPlan;
}
