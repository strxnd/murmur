import type { SttRuntimeAccelerator, SttRuntimeId, SttRuntimeVariantKey } from "./types";

export interface SttRuntimeAsset {
  assetName: string;
  url?: string;
  sizeBytes?: number;
  sha256?: string;
  archiveFormat?: "tar.gz" | "tar.bz2";
  abi?: string;
  runtimeDir?: string;
}

export interface SttRuntimeCatalogEntry {
  id: SttRuntimeId;
  label: string;
  runtimeDir: string;
  envVar: string;
  acceleratorEnvVars?: Partial<Record<SttRuntimeAccelerator, string>>;
  upstreamVersion: string;
  version: string;
  executableCandidates: string[];
  libraryDirs: string[];
  platforms: Record<string, SttRuntimeAsset>;
  variants?: Record<string, Partial<Record<SttRuntimeAccelerator, SttRuntimeAsset>>>;
}

export const supportedSttRuntimePlatformKeys = ["linux-x64", "darwin-arm64", "darwin-x64"] as const;
export const sttRuntimeAccelerators = ["cpu", "cuda", "apple"] as const satisfies SttRuntimeAccelerator[];
export const sttRuntimeReleaseVersion = "0.1.0";
export const sttRuntimeReleaseTag = `stt-runtimes-${sttRuntimeReleaseVersion}`;
export const sttGpuRuntimeReleaseVersion = sttRuntimeReleaseVersion;

const sttRuntimeReleaseBaseUrl = `https://github.com/strxnd/murmur/releases/download/${sttRuntimeReleaseTag}`;

export const sttRuntimeCatalog: Record<SttRuntimeId, SttRuntimeCatalogEntry> = {
  "whisper.cpp": {
    id: "whisper.cpp",
    label: "whisper.cpp",
    runtimeDir: "whisper.cpp",
    envVar: "MURMUR_WHISPER_CPP_SERVER",
    acceleratorEnvVars: {
      cpu: "MURMUR_WHISPER_CPP_SERVER",
      cuda: "MURMUR_WHISPER_CPP_CUDA_SERVER",
      apple: "MURMUR_WHISPER_CPP_APPLE_SERVER"
    },
    upstreamVersion: "1.8.6",
    version: "0.1.0",
    executableCandidates: ["whisper-server"],
    libraryDirs: ["lib", "bin"],
    platforms: {
      "linux-x64": runtimeAsset(
        "murmur-stt-runtime-whisper.cpp-1.8.6-linux-x64-0.1.0.tar.gz",
        3720870,
        "d59417162bbf89aaecbf6c348a385da67dd71fcdbb6cf62066a53ae49ea685b1"
      ),
      "darwin-arm64": runtimeAsset("murmur-stt-runtime-whisper.cpp-1.8.6-darwin-arm64-0.1.0.tar.gz"),
      "darwin-x64": runtimeAsset("murmur-stt-runtime-whisper.cpp-1.8.6-darwin-x64-0.1.0.tar.gz")
    },
    variants: {
      "linux-x64": {
        cuda: runtimeAsset(
          "murmur-stt-runtime-whisper.cpp-1.8.6-linux-x64-cuda-0.1.0.tar.gz",
          430368535,
          "c91b1b9a97e8a95ee8689cf364fd3ad85d24b6101789b02e33bf547e560ec778",
          {
            url: runtimeReleaseUrl("murmur-stt-runtime-whisper.cpp-1.8.6-linux-x64-cuda-0.1.0.tar.gz"),
            abi: "CUDA",
            runtimeDir: "whisper.cpp-cuda"
          }
        )
      },
      "darwin-arm64": {
        apple: runtimeAsset(
          "murmur-stt-runtime-whisper.cpp-1.8.6-darwin-arm64-apple-0.1.0.tar.gz",
          undefined,
          undefined,
          {
            abi: "Metal",
            runtimeDir: "whisper.cpp-apple"
          }
        )
      }
    }
  },
  "sherpa-onnx": {
    id: "sherpa-onnx",
    label: "Sherpa ONNX",
    runtimeDir: "sherpa-onnx",
    envVar: "MURMUR_SHERPA_ONNX_OFFLINE",
    acceleratorEnvVars: {
      cpu: "MURMUR_SHERPA_ONNX_OFFLINE",
      cuda: "MURMUR_SHERPA_ONNX_CUDA_OFFLINE"
    },
    upstreamVersion: "1.13.2",
    version: "0.1.0",
    executableCandidates: ["sherpa-onnx-offline", "bin/sherpa-onnx-offline"],
    libraryDirs: ["lib", "bin"],
    platforms: {
      "linux-x64": runtimeAsset(
        "murmur-stt-runtime-sherpa-onnx-1.13.2-linux-x64-0.1.0.tar.gz",
        25574920,
        "563f226035c3905279ac01bf123f7b4f0faa1baa96cae7f2fece96f9e73530b1"
      ),
      "darwin-arm64": runtimeAsset("murmur-stt-runtime-sherpa-onnx-1.13.2-darwin-arm64-0.1.0.tar.gz"),
      "darwin-x64": runtimeAsset("murmur-stt-runtime-sherpa-onnx-1.13.2-darwin-x64-0.1.0.tar.gz")
    },
    variants: {
      "linux-x64": {
        cuda: runtimeAsset(
          "murmur-stt-runtime-sherpa-onnx-1.13.2-linux-x64-cuda-0.1.0.tar.gz",
          225775663,
          "41d0c216303b3e1de55924fc68df877e25f66590fdb3551d326cb531832ac745",
          {
            url: runtimeReleaseUrl("murmur-stt-runtime-sherpa-onnx-1.13.2-linux-x64-cuda-0.1.0.tar.gz"),
            abi: "CUDA 12.x/cuDNN 9.x",
            runtimeDir: "sherpa-onnx-cuda"
          }
        )
      }
    }
  }
};

export const sttRuntimeIds = Object.keys(sttRuntimeCatalog) as SttRuntimeId[];

export function getSttRuntimeCatalogEntry(id: SttRuntimeId): SttRuntimeCatalogEntry {
  return sttRuntimeCatalog[id];
}

export function getSttRuntimeVariantAsset(
  entry: SttRuntimeCatalogEntry,
  platformKey: string,
  accelerator: SttRuntimeAccelerator
): SttRuntimeAsset | undefined {
  if (accelerator === "cpu") {
    return entry.variants?.[platformKey]?.cpu ?? entry.platforms[platformKey];
  }
  return entry.variants?.[platformKey]?.[accelerator];
}

export function getSttRuntimeSupportedAccelerators(
  entry: SttRuntimeCatalogEntry,
  platformKey: string
): SttRuntimeAccelerator[] {
  return sttRuntimeAccelerators.filter((accelerator) => Boolean(getSttRuntimeVariantAsset(entry, platformKey, accelerator)));
}

export function getSttRuntimeExpectedAssetName(
  entry: SttRuntimeCatalogEntry,
  platformKey: string,
  accelerator: SttRuntimeAccelerator
): string {
  const acceleratorSuffix = accelerator === "cpu" ? "" : `-${accelerator}`;
  return `murmur-stt-runtime-${entry.id}-${entry.upstreamVersion}-${platformKey}${acceleratorSuffix}-${entry.version}.tar.gz`;
}

export function getSttRuntimeVariantKey(
  id: SttRuntimeId,
  platformKey: string,
  accelerator: SttRuntimeAccelerator,
  version: string
): SttRuntimeVariantKey {
  return [id, platformKey, accelerator, version].join("|");
}

export function parseSttRuntimeVariantKey(value: string): {
  id: SttRuntimeId;
  platformKey: string;
  accelerator: SttRuntimeAccelerator;
  version: string;
} | null {
  const [id, platformKey, accelerator, version] = value.split("|");
  if (!isSttRuntimeId(id) || !isSttRuntimeAccelerator(accelerator) || !platformKey || !version || !isSemverVersion(version)) return null;
  return { id, platformKey, accelerator, version };
}

export function sttRuntimeVariantLabel(entry: SttRuntimeCatalogEntry, accelerator: SttRuntimeAccelerator): string {
  if (accelerator === "cpu") return entry.label;
  if (accelerator === "apple") return `${entry.label} Apple Silicon`;
  return `${entry.label} ${accelerator.toUpperCase()}`;
}

export function sttRuntimeVariantRuntimeDir(entry: SttRuntimeCatalogEntry, platformKey: string, accelerator: SttRuntimeAccelerator): string {
  const asset = getSttRuntimeVariantAsset(entry, platformKey, accelerator);
  return asset?.runtimeDir ?? (accelerator === "cpu" ? entry.runtimeDir : `${entry.runtimeDir}-${accelerator}`);
}

function runtimeAsset(assetName: string, sizeBytes?: number, sha256?: string, patch: Partial<SttRuntimeAsset> = {}): SttRuntimeAsset {
  return {
    assetName,
    archiveFormat: "tar.gz",
    sizeBytes,
    sha256,
    ...patch
  };
}

function runtimeReleaseUrl(assetName: string): string {
  return `${sttRuntimeReleaseBaseUrl}/${assetName}`;
}

export function isSemverVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function isSttRuntimeId(value: string): value is SttRuntimeId {
  return value === "whisper.cpp" || value === "sherpa-onnx";
}

function isSttRuntimeAccelerator(value: string): value is SttRuntimeAccelerator {
  return value === "cpu" || value === "cuda" || value === "apple";
}
