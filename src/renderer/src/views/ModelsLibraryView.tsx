import { Popover } from "@base-ui/react/popover";
import { BrainCircuit, Check, ChevronRight, Download, HardDrive, Heart, Mic, Search, Settings, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type {
  AppStateSnapshot,
  LlmProviderConfig,
  ModelCatalogItem,
  ModelDownloadState,
  ModelProvider,
  TranscriptionProviderConfig
} from "../../../shared/types";
import { ProviderConfigurationPanels } from "../components/ProviderConfigurationPanels";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Select } from "../components/ui/Select";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { cn } from "../lib/cn";
import { useMurmurStore } from "../state/murmur-store";

type ModelFilter = "all" | "voice" | "language" | "offline" | "favorites" | "downloaded";

const providers: Array<{ value: "all" | ModelProvider; label: string }> = [
  { value: "all", label: "All providers" },
  { value: "whisper_cpp", label: "whisper.cpp" },
  { value: "nvidia", label: "NVIDIA" },
  { value: "ollama", label: "Ollama" },
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "openrouter", label: "OpenRouter" }
];

const filters: Array<{ id: ModelFilter; label: string }> = [
  { id: "voice", label: "Voice models" },
  { id: "language", label: "Language models" },
  { id: "offline", label: "Offline" },
  { id: "favorites", label: "Favorites" },
  { id: "downloaded", label: "Downloaded" }
];

export function ModelsLibraryView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const getModelLibrary = useMurmurStore((store) => store.getModelLibrary);
  const downloadModel = useMurmurStore((store) => store.downloadModel);
  const deleteDownloadedModel = useMurmurStore((store) => store.deleteDownloadedModel);
  const toggleFavoriteModel = useMurmurStore((store) => store.toggleFavoriteModel);
  const setSttProviders = useMurmurStore((store) => store.setSttProviders);
  const setLlmProviders = useMurmurStore((store) => store.setLlmProviders);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<"all" | ModelProvider>("all");
  const [filter, setFilter] = useState<ModelFilter>("all");
  const [openModelId, setOpenModelId] = useState<string | null>(null);
  const providerConfigurationRef = useRef<HTMLDivElement | null>(null);
  const modelListParent = useAutoAnimateRef<HTMLDivElement>();
  const downloadsById = useMemo(
    () => new Map(state.modelLibrary.downloads.map((download) => [download.modelId, download])),
    [state.modelLibrary.downloads]
  );

  useEffect(() => {
    void getModelLibrary();
  }, [getModelLibrary]);

  const models = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.modelLibrary.catalog.filter((item) => {
      const download = downloadsById.get(item.id);
      if (provider !== "all" && item.provider !== provider) return false;
      if (filter === "voice" && item.kind !== "voice") return false;
      if (filter === "language" && item.kind !== "language") return false;
      if (filter === "offline" && !item.isOffline) return false;
      if (filter === "favorites" && !download?.favorite) return false;
      if (filter === "downloaded" && download?.status !== "downloaded") return false;
      if (!needle) return true;
      return [item.name, providerLabel(item.provider), item.description, ...item.tags]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [downloadsById, filter, provider, query, state.modelLibrary.catalog]);

  useEffect(() => {
    setOpenModelId((current) => (current && models.some((model) => model.id === current) ? current : null));
  }, [models]);

  const scrollToProviderConfiguration = (): void => {
    providerConfigurationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const useAsDefaultModel = async (item: ModelCatalogItem): Promise<void> => {
    if (item.kind === "voice") {
      const result = upsertTranscriptionProvider(state.transcriptionProviders, item);
      if (!result) return;

      await setSttProviders(result.providers);
      return;
    }

    const result = upsertLlmProvider(state.llmProviders, item);
    if (!result) return;

    await setLlmProviders(result.providers);
  };

  return (
    <View title="Models">
      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)_14rem] gap-3 max-[760px]:grid-cols-1">
          <label className="relative block">
            <Search className="absolute left-2.5 top-2.5 text-muted-foreground" size={18} />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search model name, provider, or tags"
            />
          </label>
          <Select items={providers} value={provider} onValueChange={(value) => setProvider(value as "all" | ModelProvider)} />
        </div>
        <Toolbar className="mt-3">
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterButton>
          {filters.map((candidate) => (
            <FilterButton key={candidate.id} active={filter === candidate.id} onClick={() => setFilter(candidate.id)}>
              {candidate.label}
            </FilterButton>
          ))}
        </Toolbar>
      </Panel>

      {models.length === 0 ? (
        <Panel>
          <EmptyState title="No models found" detail="Adjust the search or filters." />
        </Panel>
      ) : (
        <section>
          <div ref={modelListParent} className="flex flex-col gap-2">
            {models.map((item) => {
              const download = downloadsById.get(item.id);
              const active = isDefaultModel(state, item);
              return (
                <Popover.Root
                  key={item.id}
                  open={openModelId === item.id}
                  onOpenChange={(open) => setOpenModelId(open ? item.id : null)}
                >
                  <Popover.Trigger
                    type="button"
                    className={cn(
                      "model-row grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left outline-none hover:bg-muted/70 focus-visible:bg-muted",
                      openModelId === item.id && "bg-muted"
                    )}
                  >
                    <ModelGlyph item={item} active={openModelId === item.id || active} />
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                      {active && (
                        <Badge tone="success" className="shrink-0">
                          Default
                        </Badge>
                      )}
                      {download?.favorite && <Heart size={14} fill="currentColor" className="shrink-0 text-muted-foreground" />}
                    </span>
                    <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                      <Badge>{providerLabel(item.provider)}</Badge>
                      <StatusBadge item={item} download={download} />
                      {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
                      <RuntimeBadge item={item} />
                    </span>
                    <ChevronRight
                      size={16}
                      className={cn("model-row-chevron text-muted-foreground", openModelId === item.id && "rotate-90 text-foreground")}
                    />
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner side="bottom" align="start" sideOffset={8} className="z-50 outline-none">
                      <Popover.Popup
                        className="model-popover-popup overflow-y-auto rounded-md border border-border bg-surface-raised p-4 text-sm text-foreground shadow-2xl shadow-black/40 outline-none"
                        style={{ width: "min(36rem, calc(100vw - 2rem))", maxHeight: "calc(100vh - 7rem)" }}
                      >
                        <ModelPopover
                          item={item}
                          download={download}
                          active={active}
                          onToggleFavorite={() => void toggleFavoriteModel(item.id)}
                          onDownload={() => void downloadModel(item.id)}
                          onDelete={() => void deleteDownloadedModel(item.id)}
                          onConfigureProvider={() => {
                            setOpenModelId(null);
                            scrollToProviderConfiguration();
                          }}
                          onUseAsDefault={() => void useAsDefaultModel(item)}
                          onClose={() => setOpenModelId(null)}
                        />
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
              );
            })}
          </div>
        </section>
      )}

      <div ref={providerConfigurationRef}>
        <ProviderConfigurationPanels state={state} />
      </div>
    </View>
  );
}

function ModelPopover({
  item,
  download,
  active,
  onToggleFavorite,
  onDownload,
  onDelete,
  onConfigureProvider,
  onUseAsDefault,
  onClose
}: {
  item: ModelCatalogItem;
  download?: ModelDownloadState;
  active: boolean;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onConfigureProvider: () => void;
  onUseAsDefault: () => void;
  onClose: () => void;
}): JSX.Element {
  const status = download?.status ?? "not_downloaded";
  const progress =
    item.downloadStrategy === "none"
      ? "Local runtime"
      : status === "downloading"
        ? progressLabel(download)
        : statusLabel(status);
  const canDownload = item.downloadStrategy !== "none" && status !== "downloading" && status !== "downloaded";
  const canDelete = item.downloadStrategy !== "none" && status === "downloaded";
  const canUseAsDefault = hasDefaultProviderConfig(item) && (item.downloadStrategy === "none" || status === "downloaded");
  const popoverParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div ref={popoverParent} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ModelGlyph item={item} active />
          <div className="min-w-0">
            <h2 className="m-0 truncate text-base font-semibold text-foreground">{item.name}</h2>
            <p className="m-0 truncate text-xs text-muted-foreground">{providerLabel(item.provider)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton title={download?.favorite ? "Remove favorite" : "Add favorite"} onClick={onToggleFavorite}>
            <Heart size={18} fill={download?.favorite ? "currentColor" : "none"} />
          </IconButton>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge>{kindLabel(item.kind)}</Badge>
        <RuntimeBadge item={item} />
        <Badge>{progress}</Badge>
        {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
        {item.downloadStrategy === "direct_file" && <Badge>Direct file</Badge>}
        {item.downloadStrategy === "archive" && <Badge>Archive</Badge>}
      </div>

      {item.description && <p className="m-0 text-sm leading-6 text-muted-foreground">{item.description}</p>}

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <Badge key={tag} className="text-subtle">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {download?.error && <p className="m-0 rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">{download.error}</p>}

      {status === "downloading" && <ProgressBar value={progressValue(download)} label={`Downloading ${item.name}`} />}

      <Toolbar>
        {item.downloadStrategy === "none" ? (
          <Button onClick={onConfigureProvider}>
            <Settings size={18} /> Configure provider
          </Button>
        ) : (
          <>
            <Button onClick={onDownload} disabled={!canDownload}>
              <Download size={18} /> {status === "error" ? "Retry" : "Download"}
            </Button>
            <Button onClick={onDelete} disabled={!canDelete}>
              <Trash2 size={18} /> Delete
            </Button>
          </>
        )}
        {canUseAsDefault && (
          <Button variant={active ? "secondary" : "primary"} onClick={onUseAsDefault} disabled={active}>
            <Check size={18} /> {active ? "Default" : "Use as default"}
          </Button>
        )}
        {status === "downloaded" && !canUseAsDefault && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
            <Check size={18} /> Downloaded
          </span>
        )}
      </Toolbar>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}): JSX.Element {
  return (
    <Button
      variant={active ? "primary" : "secondary"}
      size="sm"
      className={cn(
        "rounded-md",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-surface-raised text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function ModelGlyph({ item, active = false }: { item: ModelCatalogItem; active?: boolean }): JSX.Element {
  const ProviderIcon = providerIcon(item.provider);
  const FallbackIcon = item.kind === "language" ? BrainCircuit : Mic;

  return (
    <span
      className={cn(
        "model-glyph relative grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-foreground",
        active && "scale-105 border-foreground/40"
      )}
    >
      {ProviderIcon ? <ProviderIcon className="h-[19px] w-[19px]" /> : <FallbackIcon size={17} />}
      {item.isOffline && <HardDrive size={10} className="absolute bottom-1 right-1 text-muted-foreground" />}
    </span>
  );
}

function StatusBadge({ item, download }: { item: ModelCatalogItem; download?: ModelDownloadState }): JSX.Element {
  if (item.downloadStrategy === "none") {
    return <Badge tone={item.isCloud ? "cloud" : "local"}>{item.isCloud ? "Provider config" : "Local runtime"}</Badge>;
  }

  const status = download?.status ?? "not_downloaded";
  const tone = status === "error" ? "warning" : status === "downloaded" ? "success" : "neutral";

  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function RuntimeBadge({ item }: { item: ModelCatalogItem }): JSX.Element {
  if (item.isCloud) return <Badge tone="cloud">Cloud</Badge>;
  if (item.isOffline) return <Badge tone="local">Offline</Badge>;
  return <Badge>Runtime</Badge>;
}

function kindLabel(kind: ModelCatalogItem["kind"]): string {
  return kind === "voice" ? "Voice" : "Language";
}

function hasDefaultProviderConfig(item: ModelCatalogItem): boolean {
  const config = item.defaultProviderConfig;
  return item.kind === "voice" ? Boolean(config?.sttProviderType) : Boolean(config?.llmProviderType);
}

function upsertTranscriptionProvider(
  providers: TranscriptionProviderConfig[],
  item: ModelCatalogItem
): { providerId: string; providers: TranscriptionProviderConfig[] } | null {
  const config = item.defaultProviderConfig;
  if (!config?.sttProviderType) return null;

  const providerId = sttProviderId(item);
  const existing = providers.find((provider) => provider.id === providerId);
  const nextProvider: TranscriptionProviderConfig = {
    id: existing?.id ?? providerId,
    type: config.sttProviderType,
    name: existing?.name || sttProviderName(item),
    baseUrl: config.baseUrl ?? existing?.baseUrl ?? "",
    endpointPath: config.endpointPath ?? existing?.endpointPath,
    apiKeySecretId: existing?.apiKeySecretId,
    apiKey: existing?.apiKey,
    isCloud: item.isCloud,
    isLocal: !item.isCloud,
    defaultModel: config.model ?? existing?.defaultModel,
    defaultLanguage: existing?.defaultLanguage ?? "auto",
    streamingMode: existing?.streamingMode ?? "none",
    enabled: true
  };

  return {
    providerId: nextProvider.id,
    providers: [nextProvider, ...providers.filter((provider) => provider.id !== nextProvider.id)]
  };
}

function upsertLlmProvider(
  providers: LlmProviderConfig[],
  item: ModelCatalogItem
): { providerId: string; providers: LlmProviderConfig[] } | null {
  const config = item.defaultProviderConfig;
  if (!config?.llmProviderType) return null;

  const providerId = llmProviderId(item);
  const existing = providers.find((provider) => provider.id === providerId);
  const nextProvider: LlmProviderConfig = {
    id: existing?.id ?? providerId,
    type: config.llmProviderType,
    name: existing?.name || llmProviderName(item),
    baseUrl: config.baseUrl ?? existing?.baseUrl,
    apiKeySecretId: existing?.apiKeySecretId,
    apiKey: existing?.apiKey,
    isCloud: item.isCloud,
    defaultModel: modelName(item) ?? existing?.defaultModel,
    enabled: true
  };

  return {
    providerId: nextProvider.id,
    providers: [nextProvider, ...providers.filter((provider) => provider.id !== nextProvider.id)]
  };
}

function isDefaultModel(state: AppStateSnapshot, item: ModelCatalogItem): boolean {
  if (item.kind === "voice") {
    const provider = state.transcriptionProviders.find((candidate) => candidate.enabled);
    return Boolean(provider && provider.id === sttProviderId(item) && providerMatchesModel(provider.defaultModel, item));
  }

  const provider = state.llmProviders.find((candidate) => candidate.enabled);
  return Boolean(provider && provider.id === llmProviderId(item) && providerMatchesModel(provider.defaultModel, item));
}

function providerMatchesModel(providerModel: string | undefined, item: ModelCatalogItem): boolean {
  const expectedModel = modelName(item);
  return expectedModel ? providerModel === expectedModel : true;
}

function modelName(item: ModelCatalogItem): string | undefined {
  return item.defaultProviderConfig?.model ?? item.ollamaModel ?? item.filename;
}

function sttProviderId(item: ModelCatalogItem): string {
  const type = item.defaultProviderConfig?.sttProviderType;
  if (type === "whisper_cpp") return "local-whisper-cpp";
  if (item.provider === "nvidia") return "local-nvidia-parakeet-stt";
  if (type === "local_openai_compatible_stt") return "local-openai-stt";
  return `${item.id}-stt`;
}

function sttProviderName(item: ModelCatalogItem): string {
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return "Local whisper.cpp";
  if (item.provider === "nvidia") return "Local NVIDIA Parakeet STT";
  return `${providerLabel(item.provider)} transcription`;
}

function llmProviderId(item: ModelCatalogItem): string {
  const type = item.defaultProviderConfig?.llmProviderType;
  if (type === "ollama") return "ollama";
  if (type === "lmstudio") return "lmstudio";
  if (type === "openai") return "openai-llm";
  if (type === "anthropic") return "anthropic";
  if (type === "google") return "google";
  if (type === "openrouter") return "openrouter";
  if (type === "llama_cpp_openai") return "llama-cpp-openai";
  return `${item.id}-llm`;
}

function llmProviderName(item: ModelCatalogItem): string {
  if (item.defaultProviderConfig?.llmProviderType === "ollama") return "Ollama";
  return `${providerLabel(item.provider)} language`;
}

type ProviderIcon = ({ className }: { className?: string }) => JSX.Element;

function providerIcon(provider: ModelProvider): ProviderIcon | null {
  if (provider === "openai") return OpenAiMark;
  if (provider === "nvidia") return NvidiaMark;
  return null;
}

function OpenAiMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 4.5a4 4 0 0 1 7.2 1.7 4 4 0 0 1 3.2 6.6 4 4 0 0 1-3.3 6.6 4 4 0 0 1-7.2-1.7 4 4 0 0 1-3.2-6.6A4 4 0 0 1 8.5 4.5Z" />
      <path d="m8.5 4.5 7 4v8" />
      <path d="m15.7 6.2-7.2 4.2v7.8" />
      <path d="m5.2 11.1 6.8 3.9 6.9-4" />
      <path d="m5.2 12.8 6.8-3.9 6.8 3.9" />
    </svg>
  );
}

function NvidiaMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" fill="#76b900" />
      <path
        d="M5.8 12c2.4-2.8 7.2-2.8 9.7 0-2.5 2.8-7.3 2.8-9.7 0Z"
        fill="#0b1308"
      />
      <circle cx="10.6" cy="12" r="1.8" fill="#76b900" />
      <circle cx="10.6" cy="12" r="0.85" fill="#0b1308" />
      <path d="M12.9 8.8c2.3.4 4.2 1.5 5.2 3.2-1 1.7-2.9 2.8-5.2 3.2" fill="none" stroke="#0b1308" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function providerLabel(provider: ModelProvider): string {
  const option = providers.find((candidate) => candidate.value === provider);
  return option?.label ?? provider;
}

function statusLabel(status: ModelDownloadState["status"] | "not_downloaded"): string {
  if (status === "downloaded") return "Downloaded";
  if (status === "downloading") return "Downloading";
  if (status === "error") return "Error";
  return "Not downloaded";
}

function progressLabel(download: ModelDownloadState | undefined): string {
  if (!download) return "Downloading";
  if (!download.totalBytes) return `${formatBytes(download.progressBytes)} downloaded`;
  return `${formatBytes(download.progressBytes)} / ${formatBytes(download.totalBytes)}`;
}

function progressValue(download: ModelDownloadState | undefined): number | null {
  if (!download?.totalBytes) return null;
  return Math.max(4, Math.min(100, (download.progressBytes / download.totalBytes) * 100));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
