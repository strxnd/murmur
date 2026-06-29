import type {
  AppStateSnapshot,
  ModelCatalogItem,
  SttRuntimeAccelerator,
  SttRuntimeId,
  SttRuntimeInstallState
} from "../../../shared/types";

export type DetectedGpuAccelerator = Extract<SttRuntimeAccelerator, "cuda" | "hip">;

const runtimeOrder: SttRuntimeId[] = ["whisper.cpp", "sherpa-onnx"];
const acceleratorOrder: SttRuntimeAccelerator[] = ["cpu", "cuda", "hip"];

export interface GpuRuntimePromptState {
  accelerators: DetectedGpuAccelerator[];
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

export function detectedGpuAccelerators(state: AppStateSnapshot): DetectedGpuAccelerator[] {
  const detected: DetectedGpuAccelerator[] = [];
  if (state.capabilities.stt.gpuProbe.nvidia.available) detected.push("cuda");
  if (state.capabilities.stt.gpuProbe.amd.available) detected.push("hip");
  return detected;
}

export function gpuRuntimePromptState(state: AppStateSnapshot): GpuRuntimePromptState | null {
  if (state.settings.gpuRuntimeInstallPromptDismissedAt) return null;

  const accelerators = detectedGpuAccelerators(state);
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
  const preference = state.settings.sttAccelerationPreference;

  if (preference !== "auto") {
    return variants.find((runtime) => runtime.accelerator === preference) ?? unsupportedRuntimeState(runtimeId, preference, cpu);
  }

  return variants.find((runtime) => runtime.accelerator !== "cpu" && runtime.status === "ready") ?? cpu ?? variants[0];
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
  if (accelerator === "hip") return "HIP";
  return "CPU";
}

export function canInstallRuntime(runtime: SttRuntimeInstallState): boolean {
  return runtime.canDownload && runtime.status !== "ready" && !isRuntimeBusy(runtime) && runtime.status !== "unsupported";
}

export function isRuntimeBusy(runtime: SttRuntimeInstallState): boolean {
  return runtime.status === "downloading" || runtime.status === "installing";
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

function unsupportedRuntimeState(
  runtimeId: SttRuntimeId,
  accelerator: SttRuntimeAccelerator,
  fallback?: SttRuntimeInstallState
): SttRuntimeInstallState {
  const label = runtimeId === "whisper.cpp" ? "whisper.cpp" : "Sherpa ONNX";
  const unsupportedVersion = "0.0.0-unsupported";
  const message =
    runtimeId === "sherpa-onnx" && accelerator === "hip"
      ? "Sherpa ONNX HIP is not available in this version; Parakeet uses CPU on AMD."
      : `${label} ${acceleratorLabel(accelerator)} acceleration is not configured for this platform.`;
  return {
    id: runtimeId,
    variantKey: `${runtimeId}|${fallback?.platformKey ?? "linux-x64"}|${accelerator}|${unsupportedVersion}`,
    accelerator,
    label: `${label} ${acceleratorLabel(accelerator)}`,
    platformKey: fallback?.platformKey ?? "linux-x64",
    requiredVersion: fallback?.requiredVersion ?? unsupportedVersion,
    status: "unsupported",
    progressBytes: 0,
    message,
    canDownload: false,
    canRepair: false
  };
}

function compareRuntimeStates(left: SttRuntimeInstallState, right: SttRuntimeInstallState): number {
  const runtimeDelta = runtimeOrder.indexOf(left.id) - runtimeOrder.indexOf(right.id);
  if (runtimeDelta !== 0) return runtimeDelta;
  const acceleratorDelta = acceleratorOrder.indexOf(left.accelerator) - acceleratorOrder.indexOf(right.accelerator);
  if (acceleratorDelta !== 0) return acceleratorDelta;
  return left.label.localeCompare(right.label);
}
