import { CircleAlert, Clock3, Gpu, Library, Mic, Square, Wrench, X } from "lucide-react";
import { useMemo, useState, type JSX } from "react";
import type { AppStateSnapshot, DictationHistoryItem } from "../../../shared/types";
import { StatCard } from "../components/StatCard";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Panel } from "../components/ui/Panel";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { gpuRuntimePromptState, isRuntimeBusy } from "../lib/runtimes";
import { recordingUnavailableReason, shouldShowSttSetupCallout } from "../lib/stt-setup";
import { useMurmurStore } from "../state/murmur-store";

export function HomeView({
  state,
  onOpenModels,
  onOpenOnboarding
}: {
  state: AppStateSnapshot;
  onOpenModels: () => void;
  onOpenOnboarding: () => void;
}): JSX.Element {
  const metrics = useMemo(() => computeHomeMetrics(state), [state]);
  const recentHistoryParent = useAutoAnimateRef<HTMLDivElement>();
  const releaseNotesParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <View title="Home" actions={<SessionActions state={state} />}>
      {shouldShowSttSetupCallout(state) && <SttSetupCallout onOpenModels={onOpenModels} onOpenOnboarding={onOpenOnboarding} />}
      <GpuRuntimeInstallCallout state={state} />
      {state.session.error && <SessionNotice status={state.session.status} message={state.session.error} />}

      <section className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
        <StatCard label="Average speed" value={metrics.averageSpeed} detail="spoken words per recorded minute" />
        <StatCard label="Words" value={metrics.words} detail="raw transcript words" />
        <StatCard label="Apps used" value={metrics.appsUsed} detail="unique captured apps and domains" />
        <StatCard label="Time saved" value={metrics.timeSaved} detail={`baseline ${state.settings.typingBaselineWpm} WPM`} />
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_24rem] gap-4 max-[1100px]:grid-cols-1">
        <Panel title="Recent history">
          <div ref={recentHistoryParent} className="flex flex-col">
            {state.history.slice(0, 5).map((item) => (
              <article key={item.id} className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 size={14} />
                  {new Date(item.createdAt).toLocaleString()}
                  <span>·</span>
                  {item.modeName || "Mode"}
                </div>
                <p className="m-0 mt-1 line-clamp-2 text-sm leading-6 text-foreground">
                  {item.processedOutput || item.rawTranscript || "No output."}
                </p>
              </article>
            ))}
            {state.history.length === 0 && <p className="m-0 text-sm text-muted-foreground">Completed dictations will appear here.</p>}
          </div>
        </Panel>
        <Panel title="What's new">
          <div ref={releaseNotesParent} className="flex flex-col gap-3">
            {state.releaseNotes.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No updates yet.</p>
            ) : (
              state.releaseNotes.map((note) => (
                <article key={note.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="text-xs text-muted-foreground">{new Date(note.date).toLocaleDateString()}</div>
                  <h3 className="m-0 mt-1 text-sm font-medium text-foreground">{note.heading}</h3>
                  {note.summary && <p className="m-0 mt-1 text-sm text-muted-foreground">{note.summary}</p>}
                </article>
              ))
            )}
          </div>
        </Panel>
      </section>
    </View>
  );
}

function SessionActions({ state }: { state: AppStateSnapshot }): JSX.Element {
  const startDictation = useMurmurStore((store) => store.startDictation);
  const stopDictation = useMurmurStore((store) => store.stopDictation);
  const isRecording = state.session.status === "recording";
  const isBusy = ["transcribing", "processing", "pasting"].includes(state.session.status);
  const unavailableReason = recordingUnavailableReason(state);

  return (
    <Toolbar>
      <Button
        variant="primary"
        onClick={() => void (isRecording ? stopDictation() : startDictation())}
        disabled={isBusy || (!isRecording && Boolean(unavailableReason))}
        title={unavailableReason ?? undefined}
      >
        {isRecording ? <Square size={18} /> : <Mic size={18} />}
        {isRecording ? "Stop" : "Record"}
      </Button>
    </Toolbar>
  );
}

function SessionNotice({ status, message }: { status: AppStateSnapshot["session"]["status"]; message: string }): JSX.Element {
  const isError = status === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className="flex items-start gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground"
    >
      <CircleAlert size={18} className={isError ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-muted-foreground"} />
      <div className="min-w-0">
        <div className="font-medium">{isError ? "Dictation needs attention" : "Dictation notice"}</div>
        <p className="m-0 mt-1 break-words text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function SttSetupCallout({
  onOpenModels,
  onOpenOnboarding
}: {
  onOpenModels: () => void;
  onOpenOnboarding: () => void;
}): JSX.Element {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-medium text-foreground">Local dictation is not set up</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">Recording is disabled until a speech-to-text provider or local voice model is ready.</p>
        </div>
        <Toolbar>
          <Button variant="secondary" onClick={onOpenModels}>
            <Library size={18} /> Models
          </Button>
          <Button variant="primary" onClick={onOpenOnboarding}>
            <Wrench size={18} /> Guided setup
          </Button>
        </Toolbar>
      </div>
    </Panel>
  );
}

function GpuRuntimeInstallCallout({ state }: { state: AppStateSnapshot }): JSX.Element | null {
  const prompt = gpuRuntimePromptState(state);
  const updateSettings = useMurmurStore((store) => store.updateSettings);
  const downloadSttRuntime = useMurmurStore((store) => store.downloadSttRuntime);
  const [isInstalling, setIsInstalling] = useState(false);

  if (!prompt) return null;

  const busy = isInstalling || prompt.candidates.some(isRuntimeBusy);
  const hasError = prompt.candidates.some((runtime) => runtime.status === "error");
  const canInstall = prompt.installable.length > 0;
  const label = busy
    ? "Installing GPU acceleration"
    : hasError
      ? "GPU acceleration was not installed"
      : canInstall
        ? "GPU acceleration available"
        : "GPU detected";
  const buttonLabel = busy ? "Installing..." : hasError ? "Retry" : canInstall ? "Install" : "Unavailable";

  const dismiss = (): void => {
    void updateSettings({ gpuRuntimeInstallPromptDismissedAt: new Date().toISOString() });
  };

  const installGpuRuntimes = async (): Promise<void> => {
    setIsInstalling(true);
    try {
      for (const runtime of prompt.installable) {
        await downloadSttRuntime(runtime.variantKey);
      }
    } catch {
      // The store surfaces install failures in the app-level action banner.
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <Panel className="border-emerald-500/45 bg-emerald-500/10 p-3">
      <div className="flex items-center justify-between gap-3 max-[640px]:items-stretch">
        <div className="flex min-h-10 min-w-0 flex-1 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-500 text-background">
            <Gpu size={19} />
          </span>
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
        </div>
        <Button
          onClick={() => void installGpuRuntimes()}
          disabled={busy || !canInstall}
          title={canInstall ? undefined : "GPU acceleration downloads are not available yet."}
          className="border-emerald-500 bg-emerald-500 text-background hover:border-emerald-600 hover:bg-emerald-600 focus-visible:ring-emerald-500/35"
        >
          {buttonLabel}
        </Button>
        <IconButton
          title="Dismiss GPU acceleration prompt"
          onClick={dismiss}
          className="border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15"
        >
          <X size={18} />
        </IconButton>
      </div>
    </Panel>
  );
}

function computeHomeMetrics(state: AppStateSnapshot): {
  averageSpeed: string;
  words: string;
  appsUsed: string;
  timeSaved: string;
} {
  const words = state.history.reduce((total, item) => total + itemWordCount(item), 0);
  const durationItems = state.history.filter((item) => item.recordingDurationMs && item.recordingDurationMs > 0);
  const spokenWords = durationItems.reduce((total, item) => total + itemWordCount(item), 0);
  const durationMs = durationItems.reduce((total, item) => total + (item.recordingDurationMs ?? 0), 0);
  const averageWpm = durationMs > 0 ? spokenWords / (durationMs / 60000) : 0;
  const appKeys = new Set(
    state.history
      .map((item) => item.appId || item.browserDomain || item.appName)
      .filter((value): value is string => Boolean(value))
  );
  const timeSavedMs = durationItems.reduce((total, item) => {
    const estimatedTypingMs = (itemWordCount(item) / state.settings.typingBaselineWpm) * 60000;
    return total + Math.max(0, estimatedTypingMs - (item.recordingDurationMs ?? 0));
  }, 0);

  return {
    averageSpeed: `${Math.round(averageWpm)} wpm`,
    words: new Intl.NumberFormat().format(words),
    appsUsed: new Intl.NumberFormat().format(appKeys.size),
    timeSaved: formatDuration(timeSavedMs)
  };
}

function itemWordCount(item: DictationHistoryItem): number {
  return item.rawWordCount ?? countWords(item.rawTranscript);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return "0s";
  const minutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${Math.max(1, minutes)}m`;
}
