import type {
  AppStateSnapshot,
  ModelCatalogItem,
  SttRuntimeAccelerator,
  SttRuntimeId,
  SttRuntimeInstallState
} from "../../../shared/types";

export type DetectedAccelerator = Extract<SttRuntimeAccelerator, "cuda">;

const runtimeOrder: SttRuntimeId[] = ["whisper.cpp", "sherpa-onnx"];
const acceleratorOrder: SttRuntimeAccelerator[] = ["cpu", "cuda"];

export interface AccelerationRuntimePromptState {
  accelerators: DetectedAccelerator[];
  candidates: SttRuntimeInstallState[];
  installable: SttRuntimeInstallState[];
}

export function uniqueRuntimeInstallStates(state: AppStateSnapshot): SttRuntimeInstallState[] {
  const byVariant = new Map<string, SttRuntimeInstallState>();
  for (const runtime of Object.values(state.sttSetup.runtimes)) {
    byVariant.set(runtime.variantKey, runtime);
  }
  return Array.from(byVariant.values()).sort(compareRuntimeStates);
}

export function detectedAccelerators(state: AppStateSnapshot): DetectedAccelerator[] {
  return state.capabilities.stt.accelerationProbe.nvidia.available ? ["cuda"] : [];
}

export function accelerationRuntimePromptState(state: AppStateSnapshot): AccelerationRuntimePromptState | null {
  if (state.settings.accelerationRuntimeInstallPromptDismissedAt) return null;

  const accelerators = detectedAccelerators(state);
  if (accelerators.length === 0) return null;

  const detected = new Set<SttRuntimeAccelerator>(accelerators);
  const candidates = uniqueRuntimeInstallStates(state).filter(
    (runtime) =>
      detected.has(runtime.accelerator) &&
      runtime.status !== "ready" &&
      runtime.status !== "unsupported"
  );
  if (candidates.length === 0) return null;
  const installable = candidates.filter(canInstallRuntime);

  return {
    accelerators,
    candidates,
    installable
  };
}

export function runtimeInstallForModel(state: AppStateSnapshot, item: ModelCatalogItem): SttRuntimeInstallState | undefined {
  if (item.kind !== "voice") return undefined;
  const runtimeId = runtimeIdForModel(item);
  if (!runtimeId) return undefined;
  const variants = runtimeVariantsForModel(state, runtimeId);
  const cpu = variants.find((runtime) => runtime.accelerator === "cpu");
  return (
    variants.find((runtime) => runtime.accelerator !== "cpu" && isRuntimeBusy(runtime)) ??
    variants.find((runtime) => runtime.accelerator !== "cpu" && runtime.status === "ready") ??
    cpu ??
    variants[0]
  );
}

export function runtimeStatusLabel(runtime: SttRuntimeInstallState): string {
  const label = acceleratorLabel(runtime.accelerator);
  if (runtime.status === "ready") return `${label} ready`;
  if (runtime.status === "downloading") return `${label} downloading`;
  if (runtime.status === "installing") return `${label} installing`;
  if (runtime.status === "repairable") return `${label} repairable`;
  if (runtime.status === "unsupported") return `${label} unsupported`;
  if (runtime.status === "error") return `${label} error`;
  return `${label} missing`;
}

export function userRuntimeStatusMessage(runtime: SttRuntimeInstallState): string {
  if (runtime.status === "ready") return `${runtime.label} is ready.`;
  if (runtime.status === "downloading" || runtime.status === "installing") return `Installing ${runtime.label}.`;
  if (runtime.status === "repairable") return `${runtime.label} needs repair.`;
  if (runtime.status === "error") return `Could not install ${runtime.label}. Try again.`;
  if (runtime.status === "unsupported") return `${runtime.label} is not available on this system.`;
  return `${runtime.label} is not installed.`;
}

export function acceleratorLabel(accelerator: SttRuntimeAccelerator): string {
  if (accelerator === "cuda") return "CUDA";
  return "CPU";
}

export function canInstallRuntime(runtime: SttRuntimeInstallState): boolean {
  return runtime.canDownload && runtime.status !== "ready" && !isRuntimeBusy(runtime) && runtime.status !== "unsupported";
}

export function isRuntimeBusy(runtime: SttRuntimeInstallState): boolean {
  return runtime.status === "downloading" || runtime.status === "installing";
}

export function canCancelRuntimeOperation(runtime: SttRuntimeInstallState | undefined): boolean {
  return Boolean(runtime && isRuntimeBusy(runtime));
}

export function runtimeProgressValue(runtime: SttRuntimeInstallState | undefined): number | null {
  if (!runtime?.totalBytes) return null;
  return Math.max(4, Math.min(100, (runtime.progressBytes / runtime.totalBytes) * 100));
}

function runtimeIdForModel(item: ModelCatalogItem): SttRuntimeId | null {
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return "whisper.cpp";
  if (item.defaultProviderConfig?.sttProviderType === "sherpa_onnx") return "sherpa-onnx";
  return null;
}

function runtimeVariantsForModel(state: AppStateSnapshot, runtimeId: SttRuntimeId): SttRuntimeInstallState[] {
  return uniqueRuntimeInstallStates(state).filter((runtime) => runtime.id === runtimeId);
}

function compareRuntimeStates(left: SttRuntimeInstallState, right: SttRuntimeInstallState): number {
  const runtimeDelta = runtimeOrder.indexOf(left.id) - runtimeOrder.indexOf(right.id);
  if (runtimeDelta !== 0) return runtimeDelta;
  const acceleratorDelta = acceleratorOrder.indexOf(left.accelerator) - acceleratorOrder.indexOf(right.accelerator);
  if (acceleratorDelta !== 0) return acceleratorDelta;
  return left.label.localeCompare(right.label);
}
