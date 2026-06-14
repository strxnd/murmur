import { Popover } from "@base-ui/react/popover";
import { BrainCircuit, Check, ChevronRight, Download, HardDrive, Heart, Mic, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type JSX } from "react";
import type {
  AppStateSnapshot,
  ModelCatalogItem,
  ModelDownloadState,
  ModelProvider,
  SttRuntimeAvailability
} from "../../../shared/types";
import { canActivateModel, providerLabel } from "../../../shared/model-activation";
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
  const activateModel = useMurmurStore((store) => store.activateModel);
  const deleteDownloadedModel = useMurmurStore((store) => store.deleteDownloadedModel);
  const toggleFavoriteModel = useMurmurStore((store) => store.toggleFavoriteModel);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<"all" | ModelProvider>("all");
  const [filter, setFilter] = useState<ModelFilter>("all");
  const [openModelId, setOpenModelId] = useState<string | null>(null);
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
              const active = isActiveModel(state, item, download);
              const runtime = runtimeAvailabilityForModel(state, item);
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
                          Active
                        </Badge>
                      )}
                      {download?.favorite && <Heart size={14} fill="currentColor" className="shrink-0 text-muted-foreground" />}
                    </span>
                    <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                      <Badge>{providerLabel(item.provider)}</Badge>
                      <StatusBadge item={item} download={download} />
                      {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
                      <RuntimeBadge item={item} runtime={runtime} />
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
                          onActivate={() => void activateModel(item.id)}
                          onClose={() => setOpenModelId(null)}
                          runtime={runtime}
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
  onActivate,
  onClose,
  runtime
}: {
  item: ModelCatalogItem;
  download?: ModelDownloadState;
  active: boolean;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onActivate: () => void;
  onClose: () => void;
  runtime?: SttRuntimeAvailability;
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
  const runtimeReady = !runtime || runtime.status === "available";
  const canActivate = canActivateModel(item) && (item.downloadStrategy === "none" || status === "downloaded");
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
        <RuntimeBadge item={item} runtime={runtime} />
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
      {runtime && <p className="m-0 rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">{runtime.message}</p>}

      {status === "downloading" && <ProgressBar value={progressValue(download)} label={`Downloading ${item.name}`} />}

      <Toolbar>
        {item.downloadStrategy !== "none" && (
          <>
            <Button onClick={onDownload} disabled={!canDownload}>
              <Download size={18} /> {status === "error" ? "Retry" : "Download"}
            </Button>
            <Button onClick={onDelete} disabled={!canDelete}>
              <Trash2 size={18} /> Delete
            </Button>
          </>
        )}
        {canActivate && (
          <Button variant={active ? "secondary" : "primary"} onClick={onActivate} disabled={active || !runtimeReady}>
            <Check size={18} /> {active ? "Active" : "Activate"}
          </Button>
        )}
        {item.downloadStrategy === "none" && !canActivate && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">Advanced setup required</span>
        )}
        {status === "downloaded" && !canActivate && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
            <Check size={18} /> Downloaded
          </span>
        )}
        {status === "downloaded" && canActivate && runtime && !runtimeReady && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">{runtimeStatusLabel(runtime.status)}</span>
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
    return <Badge tone={item.isCloud ? "cloud" : "local"}>{item.isCloud ? "Cloud setup" : "Local runtime"}</Badge>;
  }

  const status = download?.status ?? "not_downloaded";
  const tone = status === "error" ? "warning" : status === "downloaded" ? "success" : "neutral";

  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function RuntimeBadge({ item, runtime }: { item: ModelCatalogItem; runtime?: SttRuntimeAvailability }): JSX.Element {
  if (runtime) {
    return <Badge tone={runtime.status === "available" ? "success" : "warning"}>{runtimeStatusLabel(runtime.status)}</Badge>;
  }
  if (item.isCloud) return <Badge tone="cloud">Cloud</Badge>;
  if (item.isOffline) return <Badge tone="local">Offline</Badge>;
  return <Badge>Runtime</Badge>;
}

function kindLabel(kind: ModelCatalogItem["kind"]): string {
  return kind === "voice" ? "Voice" : "Language";
}

function isActiveModel(state: AppStateSnapshot, item: ModelCatalogItem, download?: ModelDownloadState): boolean {
  if (state.modelLibrary.activeModelIds[item.kind] !== item.id) return false;
  return item.downloadStrategy === "none" || download?.status === "downloaded";
}

function runtimeAvailabilityForModel(state: AppStateSnapshot, item: ModelCatalogItem): SttRuntimeAvailability | undefined {
  if (item.kind !== "voice") return undefined;
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return state.capabilities.sttRuntimes["whisper.cpp"];
  if (item.defaultProviderConfig?.sttProviderType === "sherpa_onnx") return state.capabilities.sttRuntimes["sherpa-onnx"];
  return undefined;
}

function runtimeStatusLabel(status: SttRuntimeAvailability["status"]): string {
  if (status === "available") return "Runtime ready";
  if (status === "unsupported") return "Unsupported platform";
  return "Runtime missing";
}

type ProviderIcon = ({ className }: { className?: string }) => JSX.Element;

const openAiLogoPath = [
  "M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073",
  "M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494",
  "M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646",
  "M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872z",
  "m16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667",
  "m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66z",
  "m-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681z",
  "m1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z"
].join(" ");

const nvidiaLogoPath = [
  "M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035",
  "m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063z",
  "m0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11",
  "M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z"
].join(" ");

function providerIcon(provider: ModelProvider): ProviderIcon | null {
  if (provider === "openai" || provider === "whisper_cpp") return OpenAiMark;
  if (provider === "nvidia") return NvidiaMark;
  return null;
}

function OpenAiMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={openAiLogoPath} />
    </svg>
  );
}

function NvidiaMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d={nvidiaLogoPath} fill="#76B900" />
    </svg>
  );
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
