import type { AppStateSnapshot, ModelCatalogItem, ModelDownloadState, SttRuntimeId } from "../../../shared/types";
import { hasUsableSttPath } from "./stt-setup";

export const defaultOnboardingVoiceModelId = "whisper-tiny-en";

export type OnboardingStepId = "microphone" | "stt" | "hotkey" | "paste" | "dictation";

export const onboardingStepIds: OnboardingStepId[] = ["microphone", "stt", "hotkey", "paste", "dictation"];

export function shouldAutoOpenOnboarding(state: AppStateSnapshot): boolean {
  if (state.settings.onboardingCompletedAt || state.settings.onboardingSkippedAt) return false;
  return state.sttSetup.needsSetup || !hasUsableSttPath(state) || state.history.length === 0;
}

export function onboardingVoiceModel(state: AppStateSnapshot): ModelCatalogItem | null {
  const readyLocalModel = activeReadyLocalVoiceModel(state);
  if (readyLocalModel) return readyLocalModel;
  return state.modelLibrary.catalog.find((item) => item.id === defaultOnboardingVoiceModelId) ?? null;
}

export function onboardingSttReady(state: AppStateSnapshot): boolean {
  return Boolean(activeReadyLocalVoiceModel(state)) || hasUsableSttPath(state);
}

export function activeReadyLocalVoiceModel(state: AppStateSnapshot): ModelCatalogItem | null {
  const activeModelId = state.modelLibrary.activeModelIds.voice;
  const item = activeModelId
    ? state.modelLibrary.catalog.find((candidate) => candidate.id === activeModelId && candidate.kind === "voice")
    : undefined;
  if (!item || item.isCloud || !localVoiceModelReady(state, item)) return null;
  return item;
}

export function localVoiceModelReady(state: AppStateSnapshot, item: ModelCatalogItem): boolean {
  if (item.kind !== "voice" || item.isCloud) return false;
  const runtimeId = runtimeIdForVoiceModel(item);
  if (runtimeId && !runtimeReady(state, runtimeId)) return false;
  if (item.downloadStrategy === "none") return true;
  return downloadForModel(state, item.id)?.status === "downloaded";
}

export function runtimeIdForVoiceModel(item: ModelCatalogItem): SttRuntimeId | null {
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return "whisper.cpp";
  if (item.defaultProviderConfig?.sttProviderType === "sherpa_onnx") return "sherpa-onnx";
  return null;
}

export function downloadForModel(state: AppStateSnapshot, modelId: string): ModelDownloadState | undefined {
  return state.modelLibrary.downloads.find((download) => download.modelId === modelId);
}

export function progressValue(progressBytes: number, totalBytes: number | undefined): number | null {
  if (!totalBytes || totalBytes <= 0) return null;
  return Math.max(4, Math.min(100, (progressBytes / totalBytes) * 100));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function runtimeReady(state: AppStateSnapshot, runtimeId: SttRuntimeId): boolean {
  return state.sttSetup.runtimes[runtimeId]?.status === "ready" || state.capabilities.sttRuntimes[runtimeId]?.status === "available";
}
