import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { modelCatalog } from "../../shared/model-catalog";
import {
  isTranscriptionProviderUsable as isBaseTranscriptionProviderUsable,
  transcriptionProviderFromModel
} from "../../shared/model-activation";
import type {
  LlmProviderConfig,
  ModelCatalogItem,
  ModelLibrarySnapshot,
  SttRuntimeId,
  SttSetupSnapshot,
  AppSettings,
  TranscriptionProviderConfig
} from "../../shared/types";
import type { AppPaths } from "./app-paths";
import { ModelLibraryService } from "./model-library";
import { StorageService } from "./storage";
import { SttRuntimeService } from "./stt-runtime";

export interface SttUsabilityResult {
  usable: boolean;
  reason: string;
}

export class SttSetupService {
  constructor(
    private paths: AppPaths,
    private storage: StorageService,
    private modelLibrary: ModelLibraryService,
    private runtimeService: SttRuntimeService
  ) {}

  getSnapshot(): SttSetupSnapshot {
    const state = this.storage.getState();
    const usability = getSttUsability(state, this.runtimeService, this.paths);

    return {
      skipped: Boolean(state.settings.sttSetupSkippedAt),
      completed: Boolean(state.settings.sttSetupCompletedAt),
      needsSetup: !usability.usable && !state.settings.sttSetupSkippedAt,
      runtimes: this.runtimeService.getInstallStates()
    };
  }

  async setupBundledStt(modelId: string): Promise<void> {
    const item = modelCatalog.find((candidate) => candidate.id === modelId);
    if (!item || item.kind !== "voice") {
      throw new Error("Choose a voice model for local dictation setup.");
    }

    const runtimeId = sttRuntimeIdForModel(item);
    if (!runtimeId) {
      throw new Error(`${item.name} is not a Murmur-managed local STT model.`);
    }

    const runtimeState = this.runtimeService.getInstallState(runtimeId);
    if (runtimeState.status === "unsupported") {
      throw new Error(runtimeState.message);
    }
    if (runtimeState.status !== "ready") {
      if (runtimeState.canRepair || runtimeState.canDownload) {
        await this.runtimeService.repairRuntime(runtimeId);
      } else {
        throw new Error(runtimeState.message);
      }
    }

    const readyRuntime = this.runtimeService.getInstallState(runtimeId);
    if (readyRuntime.status !== "ready") {
      throw new Error(readyRuntime.error || readyRuntime.message);
    }

    const modelReady = await this.ensureModelDownloaded(item);
    if (!modelReady) {
      throw new Error(`Could not download ${item.name}.`);
    }

    const activated = await this.modelLibrary.activateModel(item.id);
    if (activated.activeModelIds.voice !== item.id) {
      throw new Error(`${item.name} could not be activated after installation verification.`);
    }
    this.storage.updateSettings({
      sttSetupCompletedAt: new Date().toISOString(),
      sttSetupSkippedAt: undefined
    });
  }

  skipSttSetup(): void {
    this.storage.updateSettings({ sttSetupSkippedAt: new Date().toISOString() });
  }

  private async ensureModelDownloaded(item: ModelCatalogItem): Promise<boolean> {
    if (item.downloadStrategy === "none") return true;

    const modelPath = this.expectedLocalPath(item);
    if (!modelPath) return false;
    const snapshot = this.modelLibrary.snapshot();
    const existing = snapshot.downloads.find((download) => download.modelId === item.id);
    if (existing?.status === "downloaded" && this.modelLibrary.verifyModelPathForUse(modelPath)) return true;

    const afterDownload = await this.modelLibrary.downloadModel(item.id);
    const download = afterDownload.downloads.find((candidate) => candidate.modelId === item.id);
    return Boolean(download?.status === "downloaded" && this.modelLibrary.verifyModelPathForUse(modelPath));
  }

  private expectedLocalPath(item: ModelCatalogItem): string | undefined {
    const modelName = item.defaultProviderConfig?.model ?? item.extractDir ?? item.filename;
    if (!modelName) return undefined;
    return isAbsolute(modelName) ? modelName : join(this.paths.modelDir, modelName);
  }
}

export function getSttUsability(
  state: {
    transcriptionProviders: TranscriptionProviderConfig[];
    llmProviders?: LlmProviderConfig[];
    modelLibrary: ModelLibrarySnapshot;
  },
  runtimeService: Pick<SttRuntimeService, "getAvailability" | "getAutomaticAvailability">,
  paths: Pick<AppPaths, "modelDir">
): SttUsabilityResult {
  const activeModel = selectReadyActiveVoiceModel(state.modelLibrary, runtimeService, paths);
  if (activeModel) {
    const provider = transcriptionProviderFromModel(activeModel, state.transcriptionProviders);
    if (provider && providerUsable(provider, runtimeService, paths)) {
      return { usable: true, reason: `${activeModel.name} is ready.` };
    }
  }

  for (const provider of state.transcriptionProviders) {
    if (providerUsable(provider, runtimeService, paths)) {
      return { usable: true, reason: `${provider.name} is configured.` };
    }
  }

  return {
    usable: false,
    reason: "No enabled speech-to-text provider or local voice model is ready."
  };
}

export function sttRuntimeIdForModel(item: ModelCatalogItem): SttRuntimeId | null {
  if (item.kind !== "voice") return null;
  const type = item.defaultProviderConfig?.sttProviderType;
  if (type === "whisper_cpp") return "whisper.cpp";
  if (type === "sherpa_onnx") return "sherpa-onnx";
  return null;
}

function selectReadyActiveVoiceModel(
  modelLibrary: ModelLibrarySnapshot,
  runtimeService: Pick<SttRuntimeService, "getAvailability" | "getAutomaticAvailability">,
  paths: Pick<AppPaths, "modelDir">
): ModelCatalogItem | undefined {
  const modelId = modelLibrary.activeModelIds.voice;
  const item = modelId ? modelLibrary.catalog.find((candidate) => candidate.id === modelId && candidate.kind === "voice") : undefined;
  if (!item) return undefined;
  if (!modelReady(item, modelLibrary, runtimeService, paths)) return undefined;
  return item;
}

function providerUsable(
  provider: TranscriptionProviderConfig,
  runtimeService: Pick<SttRuntimeService, "getAvailability" | "getAutomaticAvailability">,
  paths: Pick<AppPaths, "modelDir">
): boolean {
  if (!isBaseTranscriptionProviderUsable(provider)) return false;

  if (provider.type === "whisper_cpp" && provider.baseUrl === "murmur://runtime/whisper.cpp") {
    return bundledProviderReady(provider, "whisper.cpp", runtimeService, paths);
  }
  if (provider.type === "sherpa_onnx") {
    return bundledProviderReady(provider, "sherpa-onnx", runtimeService, paths);
  }

  return true;
}

function bundledProviderReady(
  provider: TranscriptionProviderConfig,
  runtimeId: SttRuntimeId,
  runtimeService: Pick<SttRuntimeService, "getAutomaticAvailability">,
  paths: Pick<AppPaths, "modelDir">
): boolean {
  if (runtimeService.getAutomaticAvailability(runtimeId).status !== "available") return false;
  if (!provider.defaultModel) return false;
  const modelPath = isAbsolute(provider.defaultModel) ? provider.defaultModel : join(paths.modelDir, provider.defaultModel);
  return existsSync(modelPath);
}

function modelReady(
  item: ModelCatalogItem,
  modelLibrary: ModelLibrarySnapshot,
  runtimeService: Pick<SttRuntimeService, "getAvailability" | "getAutomaticAvailability">,
  paths: Pick<AppPaths, "modelDir">
): boolean {
  const runtimeId = sttRuntimeIdForModel(item);
  if (runtimeId && runtimeService.getAutomaticAvailability(runtimeId).status !== "available") return false;
  if (item.downloadStrategy === "none") return true;
  const download = modelLibrary.downloads.find((candidate) => candidate.modelId === item.id);
  if (download?.status !== "downloaded") return false;
  const modelName = item.defaultProviderConfig?.model ?? item.extractDir ?? item.filename;
  if (!modelName) return false;
  const modelPath = isAbsolute(modelName) ? modelName : join(paths.modelDir, modelName);
  return existsSync(modelPath);
}
