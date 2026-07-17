import type { ModelCatalogItem } from "./types";

const whisperBaseUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const sherpaOnnxModelBaseUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
const bundledWhisperCppRuntimeUrl = "murmur://runtime/whisper.cpp";
const bundledSherpaOnnxRuntimeUrl = "murmur://runtime/sherpa-onnx";

export const modelCatalog: ModelCatalogItem[] = [
  {
    id: "openai-gpt-4o-transcribe",
    name: "GPT-4o Transcribe",
    kind: "voice",
    provider: "openai",
    description: "Remote API-based OpenAI transcription model for speech-to-text.",
    isCloud: true,
    isOffline: false,
    downloadStrategy: "none",
    defaultProviderConfig: {
      sttProviderType: "cloud_openai",
      baseUrl: "https://api.openai.com/v1",
      endpointPath: "/audio/transcriptions",
      model: "gpt-4o-transcribe"
    }
  },
  {
    id: "openai-gpt-5-5",
    name: "GPT-5.5",
    kind: "language",
    provider: "openai",
    description: "Remote API-based OpenAI language model for dictation cleanup and rewriting.",
    isCloud: true,
    isOffline: false,
    downloadStrategy: "none",
    defaultProviderConfig: {
      llmProviderType: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.5"
    }
  },
  {
    id: "codex-gpt-5-6-luna",
    name: "GPT-5.6 Luna",
    kind: "language",
    provider: "codex",
    description: "Codex subscription model for dictation cleanup and rewriting.",
    isCloud: true,
    isOffline: false,
    downloadStrategy: "none",
    defaultProviderConfig: {
      providerId: "codex",
      llmProviderType: "codex",
      model: "gpt-5.6-luna"
    }
  },
  {
    id: "anthropic-claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    kind: "language",
    provider: "anthropic",
    description: "Remote API-based Anthropic language model for dictation cleanup and rewriting.",
    isCloud: true,
    isOffline: false,
    downloadStrategy: "none",
    defaultProviderConfig: {
      llmProviderType: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6"
    }
  },
  {
    id: "google-gemini-3-5-flash",
    name: "Gemini 3.5 Flash",
    kind: "language",
    provider: "google",
    description: "Remote API-based Google Gemini language model for dictation cleanup and rewriting.",
    isCloud: true,
    isOffline: false,
    downloadStrategy: "none",
    defaultProviderConfig: {
      llmProviderType: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.5-flash"
    }
  },
  ...[
    {
      id: "whisper-tiny",
      name: "Whisper Tiny",
      description: "Fast, lightweight multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 77691713,
      filename: "ggml-tiny.bin",
      sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"
    },
    {
      id: "whisper-base",
      name: "Whisper Base",
      description: "Balanced multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 147951465,
      filename: "ggml-base.bin",
      sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"
    },
    {
      id: "whisper-small",
      name: "Whisper Small",
      description: "Higher-quality multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 487601967,
      filename: "ggml-small.bin",
      sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
    },
    {
      id: "whisper-medium",
      name: "Whisper Medium",
      description: "High-quality multilingual Whisper model for local whisper.cpp transcription.",
      sizeBytes: 1533763059,
      filename: "ggml-medium.bin",
      sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"
    },
    {
      id: "whisper-large",
      name: "Whisper Large",
      description: "Large-v3 multilingual Whisper model for maximum local transcription quality.",
      sizeBytes: 3095033483,
      filename: "ggml-large-v3.bin",
      sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2"
    },
    {
      id: "whisper-turbo",
      name: "Whisper Turbo",
      description: "Large-v3-turbo Whisper model for faster high-quality local transcription.",
      sizeBytes: 1624555275,
      filename: "ggml-large-v3-turbo.bin",
      sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"
    },
    {
      id: "whisper-tiny-en",
      name: "Whisper Tiny English",
      description: "Fast, lightweight English-only Whisper model for local whisper.cpp transcription.",
      sizeBytes: 77704715,
      filename: "ggml-tiny.en.bin",
      sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f"
    },
    {
      id: "whisper-base-en",
      name: "Whisper Base English",
      description: "Balanced English-only Whisper model for local whisper.cpp transcription.",
      sizeBytes: 147964211,
      filename: "ggml-base.en.bin",
      sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
    },
    {
      id: "whisper-small-en",
      name: "Whisper Small English",
      description: "Higher-quality English-only Whisper model for local whisper.cpp transcription.",
      sizeBytes: 487614201,
      filename: "ggml-small.en.bin",
      sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"
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
    downloadStrategy: "direct_file",
    downloadUrl: `${whisperBaseUrl}/${item.filename}`,
    filename: item.filename,
    sha256: item.sha256,
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
      sizeBytes: 487170055,
      filename: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
      extractDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
      sha256: "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf"
    },
    {
      id: "nvidia-parakeet-tdt-06b-v2",
      name: "Parakeet TDT 0.6B v2",
      description: "High-quality English Parakeet speech-to-text model converted for local Sherpa ONNX decoding.",
      sizeBytes: 482468385,
      filename: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
      extractDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
      sha256: "157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad"
    },
    {
      id: "nvidia-parakeet-tdt-ctc-110m",
      name: "Parakeet TDT-CTC 110M",
      description: "Smaller English Parakeet model converted for fast local Sherpa ONNX decoding.",
      sizeBytes: 104337827,
      filename: "sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8.tar.bz2",
      extractDir: "sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8",
      sha256: "17f945007b52ccd8b7200ffc7c5652e9e8e961dfdf479cefcabd06cf5703630b"
    }
  ].map((item): ModelCatalogItem => ({
    id: item.id,
    name: item.name,
    kind: "voice",
    provider: "nvidia",
    description: item.description,
    isCloud: false,
    isOffline: true,
    sizeBytes: item.sizeBytes,
    downloadStrategy: "archive",
    downloadUrl: `${sherpaOnnxModelBaseUrl}/${item.filename}`,
    filename: item.filename,
    extractDir: item.extractDir,
    sha256: item.sha256,
    defaultProviderConfig: {
      sttProviderType: "sherpa_onnx",
      baseUrl: bundledSherpaOnnxRuntimeUrl,
      model: item.extractDir
    }
  }))
];

export const modelListCatalogIds = [
  "openai-gpt-4o-transcribe",
  "openai-gpt-5-5",
  "codex-gpt-5-6-luna",
  "anthropic-claude-sonnet-4-6",
  "google-gemini-3-5-flash",
  "whisper-tiny",
  "whisper-base",
  "whisper-small",
  "whisper-medium",
  "whisper-large",
  "whisper-turbo",
  "whisper-tiny-en",
  "whisper-base-en",
  "whisper-small-en",
  "nvidia-parakeet-tdt-06b-v3",
  "nvidia-parakeet-tdt-06b-v2",
  "nvidia-parakeet-tdt-ctc-110m"
] as const;

const modelListCatalogIdSet = new Set<string>(modelListCatalogIds);

export const modelListCatalog = modelCatalog.filter((item) => modelListCatalogIdSet.has(item.id));
