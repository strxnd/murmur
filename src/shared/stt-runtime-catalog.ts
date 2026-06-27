import type { SttRuntimeId } from "./types";

export interface SttRuntimeAsset {
  assetName: string;
  url?: string;
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

export const supportedSttRuntimePlatformKeys = ["linux-x64"] as const;

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
        3720870,
        "d59417162bbf89aaecbf6c348a385da67dd71fcdbb6cf62066a53ae49ea685b1"
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
        25574920,
        "563f226035c3905279ac01bf123f7b4f0faa1baa96cae7f2fece96f9e73530b1"
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
    sha256
  };
}
