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

export const supportedSttRuntimePlatformKeys = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"] as const;

const releaseBaseUrl = "https://github.com/kumaraarav/murmur/releases/download/stt-runtimes-v0.1.0";

export const sttRuntimeCatalog: Record<SttRuntimeId, SttRuntimeCatalogEntry> = {
  "whisper.cpp": {
    id: "whisper.cpp",
    label: "whisper.cpp",
    runtimeDir: "whisper.cpp",
    envVar: "MURMUR_WHISPER_CPP_SERVER",
    version: "v1.8.6",
    executableCandidates: ["whisper-server", "whisper-server.exe"],
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
      ),
      "darwin-x64": runtimeAsset(
        "murmur-stt-runtime-whisper.cpp-v1.8.6-darwin-x64.tar.gz",
        5000000,
        "afd5cddbe10b80e2f6186d2c21c01a8d6c5dd55e2605369b369344831507cc3e"
      ),
      "darwin-arm64": runtimeAsset(
        "murmur-stt-runtime-whisper.cpp-v1.8.6-darwin-arm64.tar.gz",
        5000000,
        "253975061c198e6eea010bdabe6c4231fb424dae7923883187b77849d73aae93"
      ),
      "win32-x64": runtimeAsset(
        "murmur-stt-runtime-whisper.cpp-v1.8.6-win32-x64.tar.gz",
        5500000,
        "fcd3e735a6a9e4a19d634dbd588712423ecce4cfe75fedf7c9b2ca61594bb81d"
      )
    }
  },
  "sherpa-onnx": {
    id: "sherpa-onnx",
    label: "Sherpa ONNX",
    runtimeDir: "sherpa-onnx",
    envVar: "MURMUR_SHERPA_ONNX_OFFLINE",
    version: "v1.13.2",
    executableCandidates: [
      "sherpa-onnx-offline",
      "sherpa-onnx-offline.exe",
      "bin/sherpa-onnx-offline",
      "bin/sherpa-onnx-offline.exe"
    ],
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
      ),
      "darwin-x64": runtimeAsset(
        "murmur-stt-runtime-sherpa-onnx-v1.13.2-darwin-x64.tar.gz",
        70000000,
        "9918605b7aee9849a770238d529136a25190b2650f03521986d462e64bca23cb"
      ),
      "darwin-arm64": runtimeAsset(
        "murmur-stt-runtime-sherpa-onnx-v1.13.2-darwin-arm64.tar.gz",
        70000000,
        "a2fcd80ac49a085c5ab0ba394526fc137b7a0868b5371bcea63b294e84ce825e"
      ),
      "win32-x64": runtimeAsset(
        "murmur-stt-runtime-sherpa-onnx-v1.13.2-win32-x64.tar.gz",
        75000000,
        "0fc4866b168c3d53e1365c0fba47e4816d7b17c729a279d861d38e66765889c4"
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
