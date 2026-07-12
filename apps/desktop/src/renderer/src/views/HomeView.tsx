import { ArrowRight, AudioLines, CircleAlert, Clock3, Library, Mic, Square, Wrench, X } from "lucide-react";
import { useMemo, useState, type JSX } from "react";
import type { AppStateSnapshot, DictationHistoryItem } from "../../../shared/types";
import { AccelerationMark } from "../components/AccelerationMark";
import { DownloadProgressStatus } from "../components/DownloadProgressStatus";
import { StatCard } from "../components/StatCard";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Panel } from "../components/ui/Panel";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { dictationRunwayAction, performDictationRunwayAction } from "../lib/dictation-runway";
import { accelerationRuntimePromptState, isRuntimeBusy } from "../lib/runtimes";
import { recordingUnavailableReason } from "../lib/stt-setup";
import { useMurmurStore } from "../state/murmur-store";

export function HomeView({
  state,
  onOpenModels,
  onOpenHistory,
  onOpenOnboarding
}: {
  state: AppStateSnapshot;
  onOpenModels: () => void;
  onOpenHistory: () => void;
  onOpenOnboarding: () => void;
}): JSX.Element {
  const metrics = useMemo(() => computeHomeMetrics(state), [state]);
  const recentHistoryParent = useAutoAnimateRef<HTMLDivElement>();
  const releaseNotesParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <View title="Home" description="Start a dictation or pick up recent text.">
      <DictationRunway
        state={state}
        onOpenModels={onOpenModels}
        onOpenOnboarding={onOpenOnboarding}
      />
      {state.session.error && <SessionNotice status={state.session.status} message={state.session.error} />}
      <GpuRuntimeInstallCallout state={state} />

      <section className="home-metrics-grid" aria-label="Dictation activity">
        <StatCard label="Speaking pace" value={metrics.averageSpeed} detail="Across completed dictations" />
        <StatCard label="Words captured" value={metrics.words} detail="Before Murmur refines them" />
        <StatCard label="Apps used" value={metrics.appsUsed} detail="Distinct apps in your history" />
        <StatCard label="Time saved" value={metrics.timeSaved} detail={`Against ${state.settings.typingBaselineWpm} WPM typing`} />
      </section>

      <section className="home-lower-grid">
        <Panel
          title="Recent dictations"
          actions={
            <Button variant="ghost" size="sm" onClick={onOpenHistory}>
              View all <ArrowRight size={14} />
            </Button>
          }
        >
          <div ref={recentHistoryParent} className="home-history-list">
            {state.history.slice(0, 5).map((item) => (
              <article key={item.id} className="home-history-item">
                <div className="home-history-meta">
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
            {state.history.length === 0 && (
              <div className="home-empty-history">
                <AudioLines size={20} aria-hidden="true" />
                <div>
                  <p>Your finished text will appear here.</p>
                  <span>Start a dictation above or use {state.settings.activationHotkey} from any app.</span>
                </div>
              </div>
            )}
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

function DictationRunway({
  state,
  onOpenModels,
  onOpenOnboarding
}: {
  state: AppStateSnapshot;
  onOpenModels: () => void;
  onOpenOnboarding: () => void;
}): JSX.Element {
  const startDictation = useMurmurStore((store) => store.startDictation);
  const stopDictation = useMurmurStore((store) => store.stopDictation);
  const [isActing, setIsActing] = useState(false);
  const unavailableReason = recordingUnavailableReason(state);
  const isRecording = state.session.status === "recording";
  const action = dictationRunwayAction({ status: state.session.status, unavailableReason, isActing });
  const isBusy = action === "disabled";
  const copy = runwayCopy(state, unavailableReason);

  const runPrimaryAction = async (): Promise<void> => {
    if (action === "setup") return onOpenOnboarding();
    if (action === "disabled") return;
    setIsActing(true);
    try {
      await performDictationRunwayAction(action, {
        openSetup: onOpenOnboarding,
        startDictation,
        stopDictation
      });
    } catch {
      // The store presents failures in the app-level action banner.
    } finally {
      setIsActing(false);
    }
  };

  const PrimaryIcon = unavailableReason ? Wrench : isRecording ? Square : Mic;
  const primaryLabel = isActing
    ? isRecording
      ? "Stopping..."
      : "Starting..."
    : unavailableReason
      ? "Finish setup"
      : isRecording
        ? "Stop dictation"
        : isBusy
          ? "Working..."
          : "Start dictation";

  return (
    <section className="dictation-runway" data-status={state.session.status}>
      <div className="dictation-runway-main">
        <div className="dictation-runway-copy">
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="dictation-runway-wave" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <div className="dictation-runway-actions">
          <Button
            variant="primary"
            className="dictation-runway-primary"
            onClick={() => void runPrimaryAction()}
            disabled={isBusy || isActing}
          >
            <PrimaryIcon size={17} fill={isRecording ? "currentColor" : "none"} />
            {primaryLabel}
          </Button>
          {unavailableReason ? (
            <Button variant="ghost" onClick={onOpenModels}>
              <Library size={16} /> Browse models
            </Button>
          ) : (
            <span className="dictation-runway-hotkey">
              Or press <kbd>{state.settings.activationHotkey}</kbd> in any app
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function runwayCopy(
  state: AppStateSnapshot,
  unavailableReason: string | null
): { title: string; description: string } {
  if (unavailableReason) {
    return {
      title: "Finish setup to start dictating.",
      description: "Choose a speech model or connect a transcription provider before your first dictation."
    };
  }

  switch (state.session.status) {
    case "recording":
      return {
        title: "Speak naturally. Murmur is listening.",
        description: `Press ${state.settings.activationHotkey} or stop here when you are finished.`
      };
    case "transcribing":
      return { title: "Turning your voice into text.", description: "Keep working—this usually takes a moment." };
    case "processing":
      return {
        title: "Shaping the transcript for your active app.",
        description: state.session.transcriptPreview || "Murmur is applying your current mode."
      };
    case "pasting":
      return { title: "Sending the finished text back.", description: "Your dictation is ready to land in the active app." };
    case "error":
      return {
        title: "The last dictation did not finish.",
        description: "Review the message below, then try again."
      };
    default:
      return {
        title: "Start a dictation from here—or any app.",
        description: "Murmur refines your speech and pastes the result where you were working."
      };
  }
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

function GpuRuntimeInstallCallout({ state }: { state: AppStateSnapshot }): JSX.Element | null {
  const prompt = accelerationRuntimePromptState(state);
  const updateSettings = useMurmurStore((store) => store.updateSettings);
  const downloadSttRuntime = useMurmurStore((store) => store.downloadSttRuntime);
  const [isInstalling, setIsInstalling] = useState(false);

  if (!prompt) return null;

  const activeRuntime = prompt.candidates.find(isRuntimeBusy);
  const busy = isInstalling || Boolean(activeRuntime);
  const hasError = prompt.candidates.some((runtime) => runtime.status === "error");
  const canInstall = prompt.installable.length > 0;
  const label = busy
    ? "Installing acceleration"
    : hasError
      ? "Acceleration was not installed"
      : canInstall
        ? "Acceleration available"
        : "Accelerator detected";
  const buttonLabel = busy ? "Installing..." : hasError ? "Retry" : canInstall ? "Install" : "Unavailable";

  const dismiss = (): void => {
    void updateSettings({ accelerationRuntimeInstallPromptDismissedAt: new Date().toISOString() });
  };

  const installAccelerationRuntimes = async (): Promise<void> => {
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
    <Panel className="border-emerald-500/45 bg-emerald-500/10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 max-[640px]:items-stretch">
          <div className="flex min-h-10 min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-500 text-background">
              <AccelerationMark />
            </span>
            <span className="truncate text-sm font-medium text-foreground">{label}</span>
          </div>
          <Button
            onClick={() => void installAccelerationRuntimes()}
            disabled={busy || !canInstall}
            title={canInstall ? undefined : "Acceleration downloads are not available yet."}
            className="border-emerald-500 bg-emerald-500 text-background hover:border-emerald-600 hover:bg-emerald-600 focus-visible:ring-emerald-500/35"
          >
            {buttonLabel}
          </Button>
          <IconButton
            title="Dismiss acceleration prompt"
            onClick={dismiss}
            className="border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15"
          >
            <X size={18} />
          </IconButton>
        </div>
        {activeRuntime && (
          <DownloadProgressStatus
            progressKey={`runtime:${activeRuntime.variantKey}`}
            progressBytes={activeRuntime.progressBytes}
            totalBytes={activeRuntime.totalBytes}
            label={`${activeRuntime.label} install progress`}
          />
        )}
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
      .map((item) => item.appId || item.appName)
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
