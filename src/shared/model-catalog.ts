import type { ModelCatalogItem } from "./types";

const whisperBaseUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const sherpaOnnxModelBaseUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
const bundledWhisperCppRuntimeUrl = "murmur://runtime/whisper.cpp";
const bundledSherpaOnnxRuntimeUrl = "murmur://runtime/sherpa-onnx";

export const modelCatalog: ModelCatalogItem[] = [
  ...[
    {
      id: "whisper-tiny",
      name: "Whisper Tiny",
      description: "Fast, lightweight multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 75 * 1024 * 1024,
      tags: ["stt", "local", "openai", "whisper", "multilingual", "fast", "ggml"],
      filename: "ggml-tiny.bin"
    },
    {
      id: "whisper-base",
      name: "Whisper Base",
      description: "Balanced multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 142 * 1024 * 1024,
      tags: ["stt", "local", "openai", "whisper", "multilingual", "balanced", "ggml"],
      filename: "ggml-base.bin"
    },
    {
      id: "whisper-small",
      name: "Whisper Small",
      description: "Higher-quality multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 466 * 1024 * 1024,
      tags: ["stt", "local", "openai", "whisper", "multilingual", "quality", "ggml"],
      filename: "ggml-small.bin"
    },
    {
      id: "whisper-medium",
      name: "Whisper Medium",
      description: "High-quality multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: Math.round(1.5 * 1024 * 1024 * 1024),
      tags: ["stt", "local", "openai", "whisper", "multilingual", "quality", "ggml"],
      filename: "ggml-medium.bin"
    },
    {
      id: "whisper-large",
      name: "Whisper Large",
      description: "Large-v3 multilingual Whisper model for maximum local transcription quality.",
      sizeBytes: Math.round(2.9 * 1024 * 1024 * 1024),
      tags: ["stt", "local", "openai", "whisper", "multilingual", "large-v3", "quality", "ggml"],
      filename: "ggml-large-v3.bin"
    },
    {
      id: "whisper-turbo",
      name: "Whisper Turbo",
      description: "Large-v3-turbo Whisper model for faster high-quality local transcription.",
      sizeBytes: Math.round(1.5 * 1024 * 1024 * 1024),
      tags: ["stt", "local", "openai", "whisper", "multilingual", "turbo", "ggml"],
      filename: "ggml-large-v3-turbo.bin"
    },
    {
      id: "whisper-tiny-en",
      name: "Whisper Tiny English",
      description: "Fast, lightweight English-only Whisper model for local whisper.cpp transcription.",
      sizeBytes: 75 * 1024 * 1024,
      tags: ["stt", "local", "openai", "whisper", "english", "fast", "ggml"],
      filename: "ggml-tiny.en.bin"
    },
    {
      id: "whisper-base-en",
      name: "Whisper Base English",
      description: "Balanced English-only Whisper model for local whisper.cpp transcription.",
      sizeBytes: 142 * 1024 * 1024,
      tags: ["stt", "local", "openai", "whisper", "english", "balanced", "ggml"],
      filename: "ggml-base.en.bin"
    },
    {
      id: "whisper-small-en",
      name: "Whisper Small English",
      description: "Higher-quality English-only Whisper model for local whisper.cpp transcription.",
      sizeBytes: 466 * 1024 * 1024,
      tags: ["stt", "local", "openai", "whisper", "english", "quality", "ggml"],
      filename: "ggml-small.en.bin"
    }
  ].map((item): ModelCatalogItem => ({
    id: item.id,
    name: item.name,
    kind: "voice",
    provider: "whisper_cpp",
    description: item.description,
    sizeBytes: item.sizeBytes,
    isCloud: false,
    isOffline: true,
    tags: item.tags,
    downloadStrategy: "direct_file",
    downloadUrl: `${whisperBaseUrl}/${item.filename}`,
    filename: item.filename,
    defaultProviderConfig: {
      sttProviderType: "whisper_cpp",
      baseUrl: bundledWhisperCppRuntimeUrl,
      endpointPath: "/inference",
      model: item.filename
    }
  })),
  ...[
    {
      id: "nvidia-parakeet-tdt-06b-v3",
      name: "Parakeet TDT 0.6B v3",
      description: "Multilingual Parakeet speech-to-text model converted for local Sherpa ONNX decoding.",
      sizeBytes: 640 * 1024 * 1024,
      filename: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
      extractDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
      tags: ["stt", "local", "nvidia", "parakeet", "multilingual", "tdt", "nemo", "sherpa-onnx", "int8"]
    },
    {
      id: "nvidia-parakeet-tdt-06b-v2",
      name: "Parakeet TDT 0.6B v2",
      description: "High-quality English Parakeet speech-to-text model converted for local Sherpa ONNX decoding.",
      sizeBytes: 631 * 1024 * 1024,
      filename: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
      extractDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
      tags: ["stt", "local", "nvidia", "parakeet", "english", "tdt", "nemo", "sherpa-onnx", "int8"]
    },
    {
      id: "nvidia-parakeet-tdt-ctc-110m",
      name: "Parakeet TDT-CTC 110M",
      description: "Smaller English Parakeet model converted for fast local Sherpa ONNX decoding.",
      sizeBytes: 126 * 1024 * 1024,
      filename: "sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8.tar.bz2",
      extractDir: "sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8",
      tags: ["stt", "local", "nvidia", "parakeet", "english", "tdt", "ctc", "fast", "nemo", "sherpa-onnx", "int8"]
    }
  ].map((item): ModelCatalogItem => ({
    id: item.id,
    name: item.name,
    kind: "voice",
    provider: "nvidia",
    description: item.description,
    isCloud: false,
    isOffline: true,
    tags: item.tags,
    sizeBytes: item.sizeBytes,
    downloadStrategy: "archive",
    downloadUrl: `${sherpaOnnxModelBaseUrl}/${item.filename}`,
    filename: item.filename,
    extractDir: item.extractDir,
    defaultProviderConfig: {
      sttProviderType: "sherpa_onnx",
      baseUrl: bundledSherpaOnnxRuntimeUrl,
      model: item.extractDir
    }
  }))
];
