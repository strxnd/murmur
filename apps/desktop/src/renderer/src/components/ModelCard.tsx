import { Check, Download, Heart, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type { ModelCatalogItem, ModelDownloadState } from "../../../shared/types";
import { canActivateModel } from "../../../shared/model-activation";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { downloadProgressSummary, formatBytes } from "../lib/download-progress";
import { DownloadProgressStatus } from "./DownloadProgressStatus";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Toolbar } from "./ui/Toolbar";

interface ModelCardProps {
  item: ModelCatalogItem;
  download?: ModelDownloadState;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onActivate: () => void;
}

export function ModelCard({
  item,
  download,
  onToggleFavorite,
  onDownload,
  onDelete,
  onActivate
}: ModelCardProps): JSX.Element {
  const status = download?.status ?? "not_downloaded";
  const progress = status === "downloading" ? downloadProgressSummary(download) : statusLabel(status);
  const canDownload = item.downloadStrategy !== "none" && status !== "downloading" && status !== "downloaded";
  const canDelete = item.downloadStrategy !== "none" && status === "downloaded";
  const canActivate = canActivateModel(item) && (!item.discovery || item.discovery.reachable) && (item.downloadStrategy === "none" || status === "downloaded");
  const cardParent = useAutoAnimateRef<HTMLElement>();

  return (
    <article ref={cardParent} className="flex min-h-64 flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 break-words text-base font-medium text-foreground">{item.name}</h3>
          <p className="m-0 mt-1 text-xs text-muted-foreground">{providerLabel(item.provider)}</p>
        </div>
        <IconButton title={download?.favorite ? "Remove favorite" : "Add favorite"} onClick={onToggleFavorite}>
          <Heart size={18} fill={download?.favorite ? "currentColor" : "none"} />
        </IconButton>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge>{item.kind === "voice" ? "Voice" : "Language"}</Badge>
        <Badge tone={item.isCloud ? "cloud" : "local"}>{item.isCloud ? "Cloud" : "Offline"}</Badge>
        <Badge>{progress}</Badge>
        {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
      </div>

      {item.description && <p className="m-0 flex-1 text-sm leading-6 text-muted-foreground">{item.description}</p>}

      {download?.error && <p className="m-0 rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">Download failed. Try again.</p>}

      {status === "downloading" && download && (
        <DownloadProgressStatus
          progressKey={`model:${item.id}`}
          progressBytes={download.progressBytes}
          totalBytes={download.totalBytes}
          label={`Downloading ${item.name}`}
        />
      )}

      <Toolbar className="mt-auto">
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
          <Button variant="primary" onClick={onActivate}>
            <Check size={18} /> Activate
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
      </Toolbar>
    </article>
  );
}

function providerLabel(provider: ModelCatalogItem["provider"]): string {
  const labels: Record<ModelCatalogItem["provider"], string> = {
    whisper_cpp: "whisper.cpp",
    nvidia: "NVIDIA",
    ollama: "Ollama",
    lmstudio: "LM Studio",
    openai: "OpenAI",
    openai_compatible: "OpenAI-compatible",
    anthropic: "Anthropic",
    google: "Google",
    codex: "Codex"
  };
  return labels[provider];
}

function statusLabel(status: ModelDownloadState["status"] | "not_downloaded"): string {
  if (status === "downloaded") return "Downloaded";
  if (status === "downloading") return "Downloading";
  if (status === "error") return "Error";
  return "Not downloaded";
}
