import type { SttRuntimeId } from "./types";

export interface SttRuntimeAsset {
  assetName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface SttRuntimeCatalogEntry {
  id: SttRuntimeId;
  label: string;
  runtimeDir: string;
  envVar: string;
  version: string;
  executableCandidates: string[];
  libraryDirs: string[];
  platforms: Record<string, SttRuntimeAsset>;
}

export const supportedSttRuntimePlatformKeys = ["linux-x64", "linux-arm64"] as const;

const releaseBaseUrl = "https://github.com/kumaraarav/murmur/releases/download/stt-runtimes-v0.1.0";

export const sttRuntimeCatalog: Record<SttRuntimeId, SttRuntimeCatalogEntry> = {
  "whisper.cpp": {
    id: "whisper.cpp",
    label: "whisper.cpp",
    runtimeDir: "whisper.cpp",
    envVar: "MURMUR_WHISPER_CPP_SERVER",
    version: "v1.8.6",
    executableCandidates: ["whisper-server"],
    libraryDirs: ["lib", "bin"],
    platforms: {
      "linux-x64": runtimeAsset(
        "murmur-stt-runtime-whisper.cpp-v1.8.6-linux-x64.tar.gz",
        3723028,
        "30cb4f0b37b76412cefaa39a25ecd17e1f21f9a3bbc9c7e6266031b3f39f0613"
      ),
      "linux-arm64": runtimeAsset(
        "murmur-stt-runtime-whisper.cpp-v1.8.6-linux-arm64.tar.gz",
        4500000,
        "ab3bb704c5bc579342270c18c0cd82edd424dc7ebfbc00acb90860f9fca18f2a"
      )
    }
  },
  "sherpa-onnx": {
    id: "sherpa-onnx",
    label: "Sherpa ONNX",
    runtimeDir: "sherpa-onnx",
    envVar: "MURMUR_SHERPA_ONNX_OFFLINE",
    version: "v1.13.2",
    executableCandidates: ["sherpa-onnx-offline", "bin/sherpa-onnx-offline"],
    libraryDirs: ["lib", "bin"],
    platforms: {
      "linux-x64": runtimeAsset(
        "murmur-stt-runtime-sherpa-onnx-v1.13.2-linux-x64.tar.gz",
        25574458,
        "9575a3a692ea7e01be05027bc9cd55d47d44e1fd2983df712f1e3d942d649db8"
      ),
      "linux-arm64": runtimeAsset(
        "murmur-stt-runtime-sherpa-onnx-v1.13.2-linux-arm64.tar.gz",
        65000000,
        "8097743e3aa2398e58873db734c3c071da6ac11595f9be28fe24fb5e9fd80506"
      )
    }
  }
};

export const sttRuntimeIds = Object.keys(sttRuntimeCatalog) as SttRuntimeId[];

export function getSttRuntimeCatalogEntry(id: SttRuntimeId): SttRuntimeCatalogEntry {
  return sttRuntimeCatalog[id];
}

function runtimeAsset(assetName: string, sizeBytes: number, sha256: string): SttRuntimeAsset {
  return {
    assetName,
    sizeBytes,
    sha256,
    url: `${releaseBaseUrl}/${assetName}`
  };
}
