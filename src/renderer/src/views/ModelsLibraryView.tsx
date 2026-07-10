import { Dialog } from "@base-ui/react/dialog";
import {
  BrainCircuit,
  Check,
  ChevronRight,
  Download,
  HardDrive,
  Heart,
  KeyRound,
  Mic,
  Search,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import type {
  AppStateSnapshot,
  ModelCatalogItem,
  ModelDownloadState,
  ModelProvider,
  SttRuntimeInstallState
} from "../../../shared/types";
import { canActivateModel, isModelProviderUsable, providerLabel } from "../../../shared/model-activation";
import {
  buildProviderSetupDraft,
  currentProviderSetupApiKey,
  resolveProviderSetupTarget,
  type ProviderSetupTarget
} from "../../../shared/model-provider-setup";
import { DownloadProgressStatus } from "../components/DownloadProgressStatus";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Select } from "../components/ui/Select";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { cn } from "../lib/cn";
import { downloadProgressSummary, formatBytes } from "../lib/download-progress";
import { runtimeInstallForModel, runtimeStatusLabel, userRuntimeStatusMessage } from "../lib/runtimes";
import { useMurmurStore } from "../state/murmur-store";

type ModelFilter = "all" | "voice" | "language" | "offline" | "favorites" | "downloaded";

const providers: Array<{ value: "all" | ModelProvider; label: string }> = [
  { value: "all", label: "All providers" },
  { value: "whisper_cpp", label: "whisper.cpp" },
  { value: "nvidia", label: "NVIDIA" },
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "openai", label: "OpenAI" },
  { value: "openai_compatible", label: "OpenAI-compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" }
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
  const cancelModelDownload = useMurmurStore((store) => store.cancelModelDownload);
  const activateModel = useMurmurStore((store) => store.activateModel);
  const deleteDownloadedModel = useMurmurStore((store) => store.deleteDownloadedModel);
  const toggleFavoriteModel = useMurmurStore((store) => store.toggleFavoriteModel);
  const downloadSttRuntime = useMurmurStore((store) => store.downloadSttRuntime);
  const repairSttRuntime = useMurmurStore((store) => store.repairSttRuntime);
  const cancelSttRuntimeDownload = useMurmurStore((store) => store.cancelSttRuntimeDownload);
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
      if (filter === "downloaded" && !isModelDownloadedOrAvailable(item, download)) return false;
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
    <View title="Models" description="Download and choose the speech and language models Murmur uses.">
      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)_14rem] gap-3 max-[760px]:grid-cols-1">
          <label className="relative block">
            <Search className="absolute left-2.5 top-2.5 text-muted-foreground" size={18} />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, provider, or tag"
              aria-label="Search models"
            />
          </label>
          <Select
            aria-label="Model provider"
            items={providers}
            value={provider}
            onValueChange={(value) => setProvider(value as "all" | ModelProvider)}
          />
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
              const runtime = runtimeInstallForModel(state, item);
              const isOpen = openModelId === item.id;
              const detailId = modelDetailId(item.id);
              return (
                <article key={item.id} className="flex flex-col">
                  <button
                    type="button"
                    className={cn(
                      "model-row grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left outline-none hover:bg-muted/70 focus-visible:bg-muted",
                      isOpen && "rounded-b-none bg-muted"
                    )}
                    aria-expanded={isOpen}
                    aria-controls={detailId}
                    onClick={() => setOpenModelId((current) => (current === item.id ? null : item.id))}
                  >
                    <ModelGlyph item={item} active={isOpen || active} />
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
                      <SourceBadge item={item} />
                      <StatusBadge item={item} download={download} />
                      {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
                      <RuntimeBadge item={item} runtime={runtime} />
                    </span>
                    <ChevronRight
                      size={16}
                      className={cn("model-row-chevron text-muted-foreground", isOpen && "rotate-90 text-foreground")}
                    />
                  </button>
                  {isOpen && (
                    <div
                      id={detailId}
                      className="model-detail-panel rounded-b-md border border-t-0 border-border bg-surface-raised p-4 text-sm text-foreground shadow-[var(--console-popover-shadow)]"
                    >
                      <ModelDetails
                        state={state}
                        item={item}
                        download={download}
                        active={active}
                        onToggleFavorite={() => void toggleFavoriteModel(item.id)}
                        onDownload={() => void downloadModel(item.id)}
                        onCancelDownload={() => void cancelModelDownload(item.id)}
                        onDelete={() => void deleteDownloadedModel(item.id)}
                        onActivate={() => void activateModel(item.id)}
                        onInstallRuntime={() => runtime && void downloadSttRuntime(runtime.variantKey)}
                        onRepairRuntime={() => runtime && void repairSttRuntime(runtime.variantKey)}
                        onCancelRuntimeDownload={() => runtime && void cancelSttRuntimeDownload(runtime.variantKey)}
                        onClose={() => setOpenModelId(null)}
                        runtime={runtime}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

    </View>
  );
}

function ModelDetails({
  state,
  item,
  download,
  active,
  onToggleFavorite,
  onDownload,
  onCancelDownload,
  onDelete,
  onActivate,
  onInstallRuntime,
  onRepairRuntime,
  onCancelRuntimeDownload,
  onClose,
  runtime
}: {
  state: AppStateSnapshot;
  item: ModelCatalogItem;
  download?: ModelDownloadState;
  active: boolean;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onDelete: () => void;
  onActivate: () => void;
  onInstallRuntime: () => void;
  onRepairRuntime: () => void;
  onCancelRuntimeDownload: () => void;
  onClose: () => void;
  runtime?: SttRuntimeInstallState;
}): JSX.Element {
  const status = download?.status ?? "not_downloaded";
  const progress =
    item.downloadStrategy === "none"
      ? providerModelLabel(item)
      : status === "downloading"
        ? downloadProgressSummary(download)
        : statusLabel(status);
  const canDownload = item.downloadStrategy !== "none" && status !== "downloading" && status !== "downloaded";
  const canCancelDownload = item.downloadStrategy !== "none" && status === "downloading";
  const canDelete = item.downloadStrategy !== "none" && status === "downloaded";
  const runtimeReady = !runtime || runtime.status === "ready";
  const runtimeBusy = runtime?.status === "downloading" || runtime?.status === "installing";
  const canCancelRuntimeDownload = runtime?.status === "downloading";
  const canActivate =
    canActivateModel(item) &&
    isModelProviderUsable(item, state) &&
    isModelCurrentlyAvailable(item) &&
    (item.downloadStrategy === "none" || status === "downloaded");
  const setupTarget = resolveProviderSetupTarget(item);
  const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  const detailParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div ref={detailParent} className="flex flex-col gap-4">
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
        <SourceBadge item={item} />
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

      {download?.error && <p className="m-0 rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">Download failed. Try again.</p>}
      {runtime && <p className="m-0 rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">{userRuntimeStatusMessage(runtime)}</p>}
      {item.discovery && !item.discovery.reachable && (
        <p className="m-0 rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">Local provider is not reachable.</p>
      )}

      {status === "downloading" && download && (
        <DownloadProgressStatus
          progressKey={`model:${item.id}`}
          progressBytes={download.progressBytes}
          totalBytes={download.totalBytes}
          label={`Downloading ${item.name}`}
        />
      )}
      {runtimeBusy && runtime && (
        <DownloadProgressStatus
          progressKey={`runtime:${runtime.variantKey}`}
          progressBytes={runtime.progressBytes}
          totalBytes={runtime.totalBytes}
          label={`${runtime.label} install progress`}
        />
      )}

      <Toolbar>
        {runtime && runtime.status !== "ready" && runtime.canDownload && (
          <Button onClick={onInstallRuntime} disabled={runtimeBusy}>
            <Download size={18} /> Install acceleration
          </Button>
        )}
        {runtime?.canRepair && (
          <Button onClick={onRepairRuntime} disabled={runtimeBusy}>
            <Wrench size={18} /> Repair acceleration
          </Button>
        )}
        {canCancelRuntimeDownload && (
          <Button variant="secondary" onClick={onCancelRuntimeDownload}>
            <X size={18} /> Cancel acceleration
          </Button>
        )}
        {item.downloadStrategy !== "none" && (
          <>
            {canCancelDownload ? (
              <Button variant="secondary" onClick={onCancelDownload}>
                <X size={18} /> Cancel
              </Button>
            ) : (
              <Button onClick={onDownload} disabled={!canDownload}>
                <Download size={18} /> {status === "error" ? "Retry" : "Download"}
              </Button>
            )}
            <Dialog.Root>
              <Dialog.Trigger disabled={!canDelete} render={<Button />}>
                <Trash2 size={18} /> Delete
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
                <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                  <Dialog.Title className="m-0 text-base font-semibold text-foreground">Delete downloaded model?</Dialog.Title>
                  <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                    This will remove the local download for {item.name}. The model can be downloaded again later.
                  </Dialog.Description>
                  <div className="mt-5 flex justify-end gap-2">
                    <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
                    <Dialog.Close onClick={() => void onDelete()} render={<Button variant="danger" />}>
                      Delete model
                    </Dialog.Close>
                  </div>
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
          </>
        )}
        {canActivate && (
          <Button variant={active ? "secondary" : "primary"} onClick={onActivate} disabled={active || !runtimeReady}>
            <Check size={18} /> {active ? "Active" : "Activate"}
          </Button>
        )}
        {item.discovery && !item.discovery.reachable && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">Model unavailable</span>
        )}
        {item.downloadStrategy === "none" && !canActivate && !item.discovery && setupTarget && (
          <Dialog.Root open={providerSetupOpen} onOpenChange={setProviderSetupOpen}>
            <Dialog.Trigger render={<Button variant="primary" />}>
              <KeyRound size={18} /> Set up provider
            </Dialog.Trigger>
            <ProviderSetupDialog
              state={state}
              item={item}
              target={setupTarget}
              open={providerSetupOpen}
              onActivated={() => {
                setProviderSetupOpen(false);
                onClose();
              }}
            />
          </Dialog.Root>
        )}
        {item.downloadStrategy === "none" && !canActivate && !item.discovery && !setupTarget && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">Provider setup required</span>
        )}
        {status === "downloaded" && !canActivate && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
            <Check size={18} /> Downloaded
          </span>
        )}
        {status === "downloaded" && canActivate && runtime && !runtimeReady && (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground">{runtimeStatusLabel(runtime)}</span>
        )}
      </Toolbar>
    </div>
  );
}

function ProviderSetupDialog({
  state,
  item,
  target,
  open,
  onActivated
}: {
  state: AppStateSnapshot;
  item: ModelCatalogItem;
  target: ProviderSetupTarget;
  open: boolean;
  onActivated: () => void;
}): JSX.Element {
  const validateSttProvider = useMurmurStore((store) => store.validateSttProvider);
  const validateLlmProvider = useMurmurStore((store) => store.validateLlmProvider);
  const setSttProviders = useMurmurStore((store) => store.setSttProviders);
  const setLlmProviders = useMurmurStore((store) => store.setLlmProviders);
  const activateModel = useMurmurStore((store) => store.activateModel);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = apiKey.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    if (!open) return;
    setApiKey(currentProviderSetupApiKey(item, state.transcriptionProviders, state.llmProviders));
    setError(null);
  }, [item, open, state.llmProviders, state.transcriptionProviders]);

  const validateSaveAndActivate = async (): Promise<void> => {
    setError(null);

    const draft = buildProviderSetupDraft({
      item,
      apiKey,
      transcriptionProviders: state.transcriptionProviders,
      llmProviders: state.llmProviders
    });

    if (!draft) {
      setError("This model does not support quick provider setup.");
      return;
    }

    setIsSubmitting(true);
    try {
      const validation =
        draft.validation.kind === "stt"
          ? await validateSttProvider(draft.validation.provider)
          : await validateLlmProvider(draft.validation.provider);

      if (!validation.ok) {
        setError(validation.message || "Provider validation failed.");
        return;
      }

      if (draft.target.sharedCredentialGroup === "openai") {
        await setSttProviders(draft.transcriptionProviders);
        await setLlmProviders(draft.llmProviders);
      } else if (draft.validation.kind === "stt") {
        await setSttProviders(draft.transcriptionProviders);
      } else {
        await setLlmProviders(draft.llmProviders);
      }

      await activateModel(item.id);
      onActivated();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
      <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void validateSaveAndActivate();
          }}
        >
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-base font-semibold text-foreground">Set up {target.providerName}</Dialog.Title>
              <Dialog.Description className="m-0 mt-1 text-sm leading-6 text-muted-foreground">
                Validate credentials for {item.name}, then save and activate the model.
              </Dialog.Description>
            </div>
            <Dialog.Close render={<IconButton title="Close" disabled={isSubmitting} />}>
              <X size={18} />
            </Dialog.Close>
          </header>

          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm max-[520px]:grid-cols-1">
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-muted-foreground">Provider</p>
              <p className="m-0 mt-1 truncate text-foreground">{target.providerName}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-muted-foreground">Selected model</p>
              <p className="m-0 mt-1 truncate text-foreground">{target.modelName}</p>
            </div>
          </div>

          <Field
            label={`${target.providerName} API key`}
            description={target.sharedCredentialGroup === "openai" ? "This key will be saved for both OpenAI voice and language models." : undefined}
          >
            <Input
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter API key"
              disabled={isSubmitting}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </Field>

          {error && (
            <p role="alert" className="m-0 rounded-md border border-border bg-muted/50 p-3 text-xs leading-5 text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Dialog.Close render={<Button variant="secondary" disabled={isSubmitting} />}>Cancel</Dialog.Close>
            <Button variant="primary" type="submit" disabled={!canSubmit}>
              <Check size={18} /> {isSubmitting ? "Validating..." : "Validate and activate"}
            </Button>
          </div>
        </form>
      </Dialog.Popup>
    </Dialog.Portal>
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
      aria-pressed={active}
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
      style={modelGlyphStyle(item.provider)}
    >
      {ProviderIcon ? <ProviderIcon className="h-[19px] w-[19px]" /> : <FallbackIcon size={17} />}
      {item.isOffline && <HardDrive size={10} className="absolute bottom-1 right-1 text-muted-foreground" />}
    </span>
  );
}

function StatusBadge({ item, download }: { item: ModelCatalogItem; download?: ModelDownloadState }): JSX.Element {
  if (item.discovery) {
    return <Badge tone={item.discovery.reachable ? "success" : "warning"}>{item.discovery.reachable ? "Available" : "Unavailable"}</Badge>;
  }

  if (item.downloadStrategy === "none") {
    return <Badge tone={item.isCloud ? "cloud" : "local"}>{providerModelLabel(item)}</Badge>;
  }

  const status = download?.status ?? "not_downloaded";
  const tone = status === "error" ? "warning" : status === "downloaded" ? "success" : "neutral";

  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function SourceBadge({ item }: { item: ModelCatalogItem }): JSX.Element {
  return <Badge tone={item.isCloud ? "cloud" : "local"}>{item.isCloud ? "Remote/API" : "Local"}</Badge>;
}

function RuntimeBadge({ item, runtime }: { item: ModelCatalogItem; runtime?: SttRuntimeInstallState }): JSX.Element | null {
  if (runtime) {
    return <Badge tone={runtime.status === "ready" ? "success" : "warning"}>{runtimeStatusLabel(runtime)}</Badge>;
  }
  if (item.downloadStrategy === "none") return null;
  if (item.isCloud) return <Badge tone="cloud">Cloud</Badge>;
  if (item.isOffline) return <Badge tone="local">Offline</Badge>;
  return <Badge>Local engine</Badge>;
}

function providerModelLabel(item: ModelCatalogItem): string {
  if (item.discovery) return item.discovery.reachable ? "Available local model" : "Unavailable local model";
  return item.isCloud ? "API-based model" : "Local";
}

function modelGlyphStyle(provider: ModelProvider): CSSProperties {
  const styles: Partial<Record<ModelProvider, CSSProperties>> = {
    whisper_cpp: {
      "--model-glyph-bg": "#ffffff",
      "--model-glyph-border": "#e0e0e0",
      "--model-glyph-icon": "#111111"
    } as CSSProperties,
    nvidia: {
      "--model-glyph-bg": "#76b900",
      "--model-glyph-border": "#76b900",
      "--model-glyph-icon": "#ffffff"
    } as CSSProperties,
    ollama: {
      "--model-glyph-bg": "#f7f7f2",
      "--model-glyph-border": "#d8d8cf",
      "--model-glyph-icon": "#111111"
    } as CSSProperties,
    lmstudio: {
      "--model-glyph-bg": "#101828",
      "--model-glyph-border": "#26364f",
      "--model-glyph-icon": "#ffffff"
    } as CSSProperties,
    openai: {
      "--model-glyph-bg": "#ffffff",
      "--model-glyph-border": "#e0e0e0",
      "--model-glyph-icon": "#111111"
    } as CSSProperties,
    openai_compatible: {
      "--model-glyph-bg": "#ffffff",
      "--model-glyph-border": "#e0e0e0",
      "--model-glyph-icon": "#111111"
    } as CSSProperties,
    anthropic: {
      "--model-glyph-bg": "#d97757",
      "--model-glyph-border": "#d97757",
      "--model-glyph-icon": "#ffffff"
    } as CSSProperties,
    google: {
      "--model-glyph-bg": "#ffffff",
      "--model-glyph-border": "#e0e0e0",
      "--model-glyph-icon": "#1f1f1f"
    } as CSSProperties
  };

  return styles[provider] ?? {};
}

function kindLabel(kind: ModelCatalogItem["kind"]): string {
  return kind === "voice" ? "Voice" : "Language";
}

function isActiveModel(state: AppStateSnapshot, item: ModelCatalogItem, download?: ModelDownloadState): boolean {
  if (state.modelLibrary.activeModelIds[item.kind] !== item.id) return false;
  if (!isModelProviderUsable(item, state)) return false;
  if (!isModelCurrentlyAvailable(item)) return false;
  return item.downloadStrategy === "none" || download?.status === "downloaded";
}

function isModelCurrentlyAvailable(item: ModelCatalogItem): boolean {
  return !item.discovery || item.discovery.reachable;
}

function isModelDownloadedOrAvailable(item: ModelCatalogItem, download?: ModelDownloadState): boolean {
  return download?.status === "downloaded" || Boolean(item.discovery?.reachable);
}

function modelDetailId(modelId: string): string {
  return `model-detail-${modelId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
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
  if (provider === "openai" || provider === "openai_compatible" || provider === "whisper_cpp") return OpenAiMark;
  if (provider === "nvidia") return NvidiaMark;
  if (provider === "anthropic") return AnthropicMark;
  if (provider === "google") return GoogleMark;
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
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={nvidiaLogoPath} />
    </svg>
  );
}

function AnthropicMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M14.63 4.5 21 19.5h-3.33l-1.3-3.22H9.7L8.39 19.5H5.2L11.58 4.5h3.05Zm.61 8.98-2.2-5.45-2.2 5.45h4.4Z" />
      <path d="M5.84 4.5 12.2 19.5H9.02L2.65 4.5h3.19Z" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.61 6.61 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function statusLabel(status: ModelDownloadState["status"] | "not_downloaded"): string {
  if (status === "downloaded") return "Downloaded";
  if (status === "downloading") return "Downloading";
  if (status === "error") return "Error";
  return "Not downloaded";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
