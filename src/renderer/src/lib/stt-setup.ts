import type { AppStateSnapshot, ModelCatalogItem, SttRuntimeId, TranscriptionProviderConfig } from "../../../shared/types";
import {
  isTranscriptionProviderUsable as isBaseTranscriptionProviderUsable,
  transcriptionProviderFromModel
} from "../../../shared/model-activation";

export function shouldShowSttSetupCallout(state: AppStateSnapshot): boolean {
  return Boolean(recordingUnavailableReason(state));
}

export function recordingUnavailableReason(state: AppStateSnapshot): string | null {
  if (hasUsableSttPath(state)) return null;
  return "No speech-to-text provider or local voice model is ready.";
}

export function hasUsableSttPath(state: AppStateSnapshot): boolean {
  const activeVoiceModel = activeReadyVoiceModel(state);
  if (activeVoiceModel) return true;

  return state.transcriptionProviders.some((provider) => providerUsable(state, provider));
}

function activeReadyVoiceModel(state: AppStateSnapshot): ModelCatalogItem | null {
  const activeModelId = state.modelLibrary.activeModelIds.voice;
  const item = activeModelId
    ? state.modelLibrary.catalog.find((candidate) => candidate.id === activeModelId && candidate.kind === "voice")
    : undefined;
  if (!item) return null;

  const runtimeId = runtimeIdForModel(item);
  if (runtimeId && !runtimeReady(state, runtimeId)) return null;
  if (
    item.downloadStrategy !== "none" &&
    !state.modelLibrary.downloads.some((download) => download.modelId === item.id && download.status === "downloaded")
  ) {
    return null;
  }

  const provider = transcriptionProviderFromModel(item, state.transcriptionProviders);
  return provider && providerUsable(state, provider) ? item : null;
}

function providerUsable(state: AppStateSnapshot, provider: TranscriptionProviderConfig): boolean {
  if (!isBaseTranscriptionProviderUsable(provider, state.settings)) return false;

  if (provider.type === "whisper_cpp" && provider.baseUrl === "murmur://runtime/whisper.cpp") {
    return Boolean(provider.defaultModel && runtimeReady(state, "whisper.cpp"));
  }
  if (provider.type === "sherpa_onnx") {
    return Boolean(provider.defaultModel && runtimeReady(state, "sherpa-onnx"));
  }

  return true;
}

function runtimeIdForModel(item: ModelCatalogItem): SttRuntimeId | null {
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return "whisper.cpp";
  if (item.defaultProviderConfig?.sttProviderType === "sherpa_onnx") return "sherpa-onnx";
  return null;
}

function runtimeReady(state: AppStateSnapshot, runtimeId: SttRuntimeId): boolean {
  return state.sttSetup.runtimes[runtimeId]?.status === "ready" || state.capabilities.sttRuntimes[runtimeId]?.status === "available";
}
