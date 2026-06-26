import { Dialog } from "@base-ui/react/dialog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Download,
  Keyboard,
  Loader2,
  Mic,
  MessageSquareText,
  X,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react";
import type { AppStateSnapshot, SttRuntimeInstallState } from "../../../shared/types";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Select, type SelectItem } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";
import { cn } from "../lib/cn";
import { murmurClient } from "../lib/murmur-client";
import {
  downloadForModel,
  formatBytes,
  onboardingStepIds,
  onboardingSttReady,
  onboardingVoiceModel,
  progressValue,
  runtimeIdForVoiceModel,
  type OnboardingStepId
} from "../lib/onboarding";
import { useMurmurStore } from "../state/murmur-store";

type ProbeStatus = "idle" | "checking" | "passed" | "warning" | "error";
type DictationTestStatus = "idle" | "starting" | "recording" | "waiting" | "passed" | "error";

const stepMeta: Record<OnboardingStepId, { title: string; label: string; icon: LucideIcon }> = {
  microphone: { title: "Microphone Permission", label: "Microphone", icon: Mic },
  stt: { title: "Speech Model", label: "Model", icon: Download },
  hotkey: { title: "Activation Hotkey", label: "Hotkey", icon: Keyboard },
  paste: { title: "Paste Capability", label: "Paste", icon: ClipboardPaste },
  dictation: { title: "Test Dictation", label: "Test", icon: MessageSquareText }
};

export function OnboardingWizard({
  state,
  open,
  onOpenChange
}: {
  state: AppStateSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const updateSettings = useMurmurStore((store) => store.updateSettings);
  const setupBundledStt = useMurmurStore((store) => store.setupBundledStt);
  const testPaste = useMurmurStore((store) => store.testPaste);
  const activateMode = useMurmurStore((store) => store.activateMode);
  const startDictation = useMurmurStore((store) => store.startDictation);
  const stopDictation = useMurmurStore((store) => store.stopDictation);
  const cancelDictation = useMurmurStore((store) => store.cancelDictation);
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = onboardingStepIds[stepIndex];
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState(state.settings.preferredAudioInputId ?? "");
  const [micStatus, setMicStatus] = useState<ProbeStatus>("idle");
  const [micMessage, setMicMessage] = useState("");
  const [isSettingUpStt, setIsSettingUpStt] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState(state.settings.activationHotkey);
  const [isSavingHotkey, setIsSavingHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [pasteStatus, setPasteStatus] = useState<ProbeStatus>("idle");
  const [pasteMessage, setPasteMessage] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [dictationStatus, setDictationStatus] = useState<DictationTestStatus>("idle");
  const [dictationMessage, setDictationMessage] = useState("");
  const [dictationValue, setDictationValue] = useState("");
  const dictationTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dictationPendingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const previousModeIdRef = useRef<string | null>(null);
  const historyLengthBeforeDictationRef = useRef(0);

  const refreshAudioDevices = useCallback(async (): Promise<void> => {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      setAudioDevices((devices ?? []).filter((device) => device.kind === "audioinput"));
    } catch {
      setAudioDevices([]);
    }
  }, []);

  useEffect(() => {
    const opening = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!opening) return;

    setStepIndex(0);
    setSelectedInputId(state.settings.preferredAudioInputId ?? "");
    setHotkey(state.settings.activationHotkey);
    setMicStatus("idle");
    setMicMessage("");
    setSttError(null);
    setHotkeyError(null);
    setPasteStatus("idle");
    setPasteMessage("");
    setPasteValue("");
    setDictationStatus("idle");
    setDictationMessage("");
    setDictationValue("");
    dictationPendingRef.current = false;
    previousModeIdRef.current = null;
    historyLengthBeforeDictationRef.current = state.history.length;
    void refreshAudioDevices();
  }, [open, refreshAudioDevices, state.history.length, state.settings.activationHotkey, state.settings.preferredAudioInputId]);

  const voiceModel = useMemo(() => onboardingVoiceModel(state), [state]);
  const download = voiceModel ? downloadForModel(state, voiceModel.id) : undefined;
  const runtimeId = voiceModel ? runtimeIdForVoiceModel(voiceModel) : null;
  const runtime = runtimeId ? state.sttSetup.runtimes[runtimeId] : undefined;
  const sttReady = onboardingSttReady(state);
  const hotkeyChanged = hotkey !== state.settings.activationHotkey;
  const hotkeyCanProceed = !hotkeyChanged && !isSavingHotkey;
  const currentStepCanProceed =
    currentStep === "microphone"
      ? micStatus === "passed"
      : currentStep === "stt"
        ? sttReady
        : currentStep === "hotkey"
          ? hotkeyCanProceed
          : currentStep === "paste"
            ? pasteStatus === "passed" || pasteStatus === "warning"
            : dictationStatus === "passed";
  const dictationCloseBlocked =
    dictationPendingRef.current || dictationStatus === "starting" || dictationStatus === "recording" || dictationStatus === "waiting" || isActiveSessionStatus(state.session.status);

  const audioInputItems: Array<SelectItem<string>> = [
    { value: "", label: "System default" },
    ...audioDevices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${index + 1}`
    }))
  ];

  const finishOnboarding = async (): Promise<void> => {
    await updateSettings({
      onboardingCompletedAt: new Date().toISOString(),
      onboardingSkippedAt: undefined
    });
    onOpenChange(false);
  };

  const skipOnboarding = async (): Promise<void> => {
    if (dictationCloseBlocked) {
      setDictationMessage("Wait for the dictation test to finish or cancel it before leaving setup.");
      return;
    }
    await updateSettings({ onboardingSkippedAt: new Date().toISOString() });
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (dictationCloseBlocked) {
      setDictationMessage("Wait for the dictation test to finish or cancel it before leaving setup.");
      return;
    }

    onOpenChange(false);
  };

  const goNext = async (): Promise<void> => {
    if (currentStep === "dictation" && dictationStatus === "passed") {
      await finishOnboarding();
      return;
    }
    setStepIndex((index) => Math.min(onboardingStepIds.length - 1, index + 1));
  };

  const probeMicrophone = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("error");
      setMicMessage("Microphone capture is unavailable in this renderer.");
      return;
    }

    setMicStatus("checking");
    setMicMessage("");

    try {
      const audio: MediaTrackConstraints | boolean = selectedInputId ? { deviceId: { exact: selectedInputId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      stream.getTracks().forEach((track) => track.stop());
      await refreshAudioDevices();
      if ((state.settings.preferredAudioInputId ?? "") !== selectedInputId) {
        await updateSettings({ preferredAudioInputId: selectedInputId || undefined });
      }
      setMicStatus("passed");
      setMicMessage("Microphone is available.");
    } catch (error) {
      setMicStatus("error");
      setMicMessage(errorMessage(error));
    }
  };

  const setupLocalStt = async (): Promise<void> => {
    if (!voiceModel) {
      setSttError("No local voice model was found in the catalog.");
      return;
    }

    setSttError(null);
    setIsSettingUpStt(true);
    try {
      await setupBundledStt(voiceModel.id);
    } catch (error) {
      setSttError(errorMessage(error));
    } finally {
      setIsSettingUpStt(false);
    }
  };

  const saveHotkey = async (): Promise<void> => {
    if (!hotkeyChanged) return;
    setHotkeyError(null);
    setIsSavingHotkey(true);
    try {
      await updateSettings({ activationHotkey: hotkey });
    } catch (error) {
      setHotkeyError(errorMessage(error));
    } finally {
      setIsSavingHotkey(false);
    }
  };

  const runPasteTest = async (): Promise<void> => {
    const probe = `Murmur paste test ${Date.now()}`;
    setPasteStatus("checking");
    setPasteMessage("");
    setPasteValue("");
    await nextFrame();
    pasteTextareaRef.current?.focus();
    pasteTextareaRef.current?.select();

    try {
      const result = await testPaste(probe);
      const inserted = await waitForTextareaValue(pasteTextareaRef, probe, 900);
      if (result.pasted && inserted) {
        setPasteStatus("passed");
        setPasteMessage("Paste automation inserted the probe text.");
      } else {
        setPasteStatus("warning");
        setPasteMessage(result.message || "Output was copied to the clipboard.");
      }
    } catch (error) {
      setPasteStatus("warning");
      setPasteMessage(errorMessage(error));
    }
  };

  const restorePreviousMode = useCallback(async (): Promise<void> => {
    const previousModeId = previousModeIdRef.current;
    previousModeIdRef.current = null;
    if (previousModeId) await activateMode(previousModeId);
  }, [activateMode]);

  const startTestDictation = async (): Promise<void> => {
    setDictationStatus("starting");
    setDictationMessage("");
    setDictationValue("");
    historyLengthBeforeDictationRef.current = state.history.length;
    previousModeIdRef.current = state.settings.activeModeId;
    dictationPendingRef.current = true;
    await nextFrame();
    dictationTextareaRef.current?.focus();

    try {
      if (state.settings.activeModeId !== "voice_to_text") {
        await activateMode("voice_to_text");
      }
      await startDictation();
      setDictationStatus("recording");
      setDictationMessage("Recording.");
    } catch (error) {
      dictationPendingRef.current = false;
      setDictationStatus("error");
      setDictationMessage(errorMessage(error));
      await restorePreviousMode();
    }
  };

  const stopTestDictation = async (): Promise<void> => {
    setDictationStatus("waiting");
    setDictationMessage("Transcribing.");
    await stopDictation();
  };

  useEffect(() => {
    if (!dictationPendingRef.current) return;

    const newHistoryItem =
      state.history.length > historyLengthBeforeDictationRef.current ? state.history[0] : undefined;
    const historyText = newHistoryItem?.processedOutput || newHistoryItem?.rawTranscript || "";
    const completedText = newHistoryItem ? historyText : state.session.status === "complete" ? state.session.transcriptPreview || "" : "";

    if (newHistoryItem || state.session.status === "complete") {
      dictationPendingRef.current = false;
      setDictationStatus(completedText.trim().length > 0 ? "passed" : "error");
      setDictationMessage(completedText.trim().length > 0 ? "Dictation produced text." : "No text was produced.");
      void restorePreviousMode();
      return;
    }

    if (state.session.status === "error" || state.session.status === "cancelled") {
      dictationPendingRef.current = false;
      setDictationStatus("error");
      setDictationMessage(state.session.error || "Dictation did not complete.");
      void restorePreviousMode();
    }
  }, [restorePreviousMode, state.history, state.session.error, state.session.status, state.session.transcriptPreview]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/70" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] flex max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),58rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-2xl outline-none">
          <header className="flex items-start justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-base font-semibold text-foreground">First-Time Setup</Dialog.Title>
              <Dialog.Description className="m-0 mt-1 text-sm leading-6 text-muted-foreground">
                Complete the required checks for local dictation.
              </Dialog.Description>
            </div>
            <IconButton title="Skip setup" onClick={() => void skipOnboarding()} disabled={dictationCloseBlocked}>
              <X size={18} />
            </IconButton>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] max-[760px]:grid-cols-1">
            <nav className="border-r border-border p-3 max-[760px]:border-b max-[760px]:border-r-0">
              <div className="flex flex-col gap-1 max-[760px]:flex-row max-[760px]:overflow-x-auto">
                {onboardingStepIds.map((stepId, index) => {
                  const Icon = stepMeta[stepId].icon;
                  return (
                    <button
                      key={stepId}
                      type="button"
                      onClick={() => setStepIndex(index)}
                      className={cn(
                        "flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-foreground/25 max-[760px]:shrink-0",
                        index === stepIndex ? "bg-foreground font-medium text-background" : "text-muted-foreground"
                      )}
                    >
                      <Icon size={16} />
                      <span className="truncate">{stepMeta[stepId].label}</span>
                      <StepStateIcon state={stepState(stepId, { micStatus, sttReady, hotkeyReady: state.capabilities.hotkeys.registered, pasteStatus, dictationStatus })} />
                    </button>
                  );
                })}
              </div>
            </nav>

            <main className="min-h-0 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-semibold text-foreground">{stepMeta[currentStep].title}</h2>
              <div className="mt-4">
                {currentStep === "microphone" && (
                  <MicrophoneStep
                    devices={audioInputItems}
                    selectedInputId={selectedInputId}
                    status={micStatus}
                    message={micMessage}
                    onSelectedInputChange={setSelectedInputId}
                    onProbe={() => void probeMicrophone()}
                  />
                )}
                {currentStep === "stt" && (
                  <SttStep
                    ready={sttReady}
                    modelName={voiceModel?.name ?? "Whisper Tiny English"}
                    modelSize={voiceModel?.sizeBytes}
                    downloadStatus={download?.status ?? "not_downloaded"}
                    downloadProgress={download ? progressValue(download.progressBytes, download.totalBytes) : null}
                    runtime={runtime}
                    setupError={sttError}
                    isSettingUp={isSettingUpStt}
                    onSetup={() => void setupLocalStt()}
                  />
                )}
                {currentStep === "hotkey" && (
                  <HotkeyStep
                    value={hotkey}
                    changed={hotkeyChanged}
                    saving={isSavingHotkey}
                    error={hotkeyError}
                    registered={state.capabilities.hotkeys.registered}
                    backend={state.capabilities.hotkeys.backend}
                    triggerDescription={state.capabilities.hotkeys.triggerDescription}
                    diagnostics={state.capabilities.hotkeys.diagnostics}
                    onChange={setHotkey}
                    onSave={() => void saveHotkey()}
                  />
                )}
                {currentStep === "paste" && (
                  <PasteStep
                    status={pasteStatus}
                    message={pasteMessage}
                    value={pasteValue}
                    textareaRef={pasteTextareaRef}
                    capability={state.capabilities.paste}
                    onChange={setPasteValue}
                    onTest={() => void runPasteTest()}
                  />
                )}
                {currentStep === "dictation" && (
                  <DictationStep
                    status={dictationStatus}
                    message={dictationMessage}
                    value={dictationValue}
                    sessionStatus={state.session.status}
                    textareaRef={dictationTextareaRef}
                    onChange={setDictationValue}
                    onStart={() => void startTestDictation()}
                    onStop={() => void stopTestDictation()}
                    onCancel={() => void cancelDictation()}
                  />
                )}
              </div>
            </main>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border p-4 max-[560px]:flex-col max-[560px]:items-stretch">
            <Button variant="ghost" onClick={() => void skipOnboarding()} disabled={dictationCloseBlocked}>
              <X size={16} /> Skip
            </Button>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setStepIndex((index) => Math.max(0, index - 1))} disabled={stepIndex === 0}>
                <ArrowLeft size={16} /> Back
              </Button>
              <Button variant="primary" onClick={() => void goNext()} disabled={!currentStepCanProceed}>
                {currentStep === "dictation" ? (
                  <>
                    <Check size={16} /> Finish
                  </>
                ) : (
                  <>
                    Next <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MicrophoneStep({
  devices,
  selectedInputId,
  status,
  message,
  onSelectedInputChange,
  onProbe
}: {
  devices: Array<SelectItem<string>>;
  selectedInputId: string;
  status: ProbeStatus;
  message: string;
  onSelectedInputChange: (value: string) => void;
  onProbe: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Audio input">
        <Select items={devices} value={selectedInputId} onValueChange={onSelectedInputChange} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onProbe} disabled={status === "checking"}>
          {status === "checking" ? <Loader2 className="animate-spin" size={18} /> : <Mic size={18} />}
          {status === "checking" ? "Checking..." : "Allow microphone"}
        </Button>
        <StatusBadge status={status} />
      </div>
      {message && <StatusMessage status={status}>{message}</StatusMessage>}
    </div>
  );
}

function SttStep({
  ready,
  modelName,
  modelSize,
  downloadStatus,
  downloadProgress,
  runtime,
  setupError,
  isSettingUp,
  onSetup
}: {
  ready: boolean;
  modelName: string;
  modelSize?: number;
  downloadStatus: string;
  downloadProgress: number | null;
  runtime?: SttRuntimeInstallState;
  setupError: string | null;
  isSettingUp: boolean;
  onSetup: () => void;
}): JSX.Element {
  const runtimeBusy = runtime?.status === "downloading" || runtime?.status === "installing";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm max-[760px]:grid-cols-1">
        <Metric label="Model" value={modelName} />
        <Metric label="Download" value={downloadStatusLabel(downloadStatus)} />
        <Metric label="Size" value={modelSize ? formatBytes(modelSize) : "Managed"} />
      </div>
      {runtime && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{runtime.label}</Badge>
            <Badge tone={runtime.status === "ready" ? "success" : "warning"}>{runtime.status}</Badge>
          </div>
          <p className="m-0 text-sm leading-6 text-muted-foreground">{runtime.message}</p>
          {runtimeBusy && <ProgressBar value={progressValue(runtime.progressBytes, runtime.totalBytes)} label={`${runtime.label} runtime progress`} />}
        </div>
      )}
      {downloadStatus === "downloading" && <ProgressBar value={downloadProgress} label={`${modelName} download progress`} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onSetup} disabled={ready || isSettingUp}>
          {isSettingUp ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
          {ready ? "Ready" : isSettingUp ? "Setting up..." : "Download and activate"}
        </Button>
        <StatusBadge status={ready ? "passed" : setupError ? "error" : "idle"} />
      </div>
      {setupError && <StatusMessage status="error">{setupError}</StatusMessage>}
    </div>
  );
}

function HotkeyStep({
  value,
  changed,
  saving,
  error,
  registered,
  backend,
  triggerDescription,
  diagnostics,
  onChange,
  onSave
}: {
  value: string;
  changed: boolean;
  saving: boolean;
  error: string | null;
  registered: boolean;
  backend: AppStateSnapshot["capabilities"]["hotkeys"]["backend"];
  triggerDescription?: string;
  diagnostics: string[];
  onChange: (value: string) => void;
  onSave: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Activation shortcut">
        <ShortcutRecorder
          value={value}
          onChange={onChange}
          onCaptureStart={murmurClient.beginHotkeyCapture}
          onCaptureEnd={murmurClient.endHotkeyCapture}
          disabled={saving}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onSave} disabled={!changed || saving}>
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
          {saving ? "Saving..." : changed ? "Save shortcut" : "Saved"}
        </Button>
        <StatusBadge status={registered ? "passed" : "warning"} />
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm max-[640px]:grid-cols-1">
        <Metric label="Backend" value={backendLabel(backend)} />
        <Metric label="Registered" value={registered ? "Yes" : "No"} />
        {triggerDescription && <Metric label="System shortcut" value={triggerDescription} />}
      </div>
      {error && <StatusMessage status="error">{error}</StatusMessage>}
      {!registered && diagnostics.length > 0 && <StatusMessage status="warning">{diagnostics.join(" ")}</StatusMessage>}
    </div>
  );
}

function PasteStep({
  status,
  message,
  value,
  textareaRef,
  capability,
  onChange,
  onTest
}: {
  status: ProbeStatus;
  message: string;
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  capability: AppStateSnapshot["capabilities"]["paste"];
  onChange: (value: string) => void;
  onTest: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Paste test target"
        className="min-h-24"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onTest} disabled={status === "checking"}>
          {status === "checking" ? <Loader2 className="animate-spin" size={18} /> : <ClipboardPaste size={18} />}
          {status === "checking" ? "Testing..." : "Test paste"}
        </Button>
        <StatusBadge status={status} />
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm max-[640px]:grid-cols-1">
        <Metric label="Backend" value={backendLabel(capability.backend)} />
        <Metric label="Automation" value={capability.automationAvailable ? "Available" : "Clipboard fallback"} />
      </div>
      {message && <StatusMessage status={status}>{message}</StatusMessage>}
    </div>
  );
}

function DictationStep({
  status,
  message,
  value,
  sessionStatus,
  textareaRef,
  onChange,
  onStart,
  onStop,
  onCancel
}: {
  status: DictationTestStatus;
  message: string;
  value: string;
  sessionStatus: AppStateSnapshot["session"]["status"];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}): JSX.Element {
  const recording = sessionStatus === "recording" || status === "recording";
  const busy = status === "starting" || status === "waiting" || ["transcribing", "processing", "pasting"].includes(sessionStatus);

  return (
    <div className="flex flex-col gap-4">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Dictation output target"
        className="min-h-32"
      />
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <>
            <Button variant="primary" onClick={onStop}>
              <Check size={18} /> Stop test
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              <X size={18} /> Cancel
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onStart} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Mic size={18} />}
            {busy ? "Working..." : "Start test"}
          </Button>
        )}
        <StatusBadge status={status === "passed" ? "passed" : status === "error" ? "error" : busy || recording ? "checking" : "idle"} />
      </div>
      {message && <StatusMessage status={status === "error" ? "error" : status === "passed" ? "passed" : "idle"}>{message}</StatusMessage>}
    </div>
  );
}

function StepStateIcon({ state }: { state: "idle" | "passed" | "warning" | "error" }): JSX.Element {
  if (state === "passed") return <CheckCircle2 size={14} className="ml-auto shrink-0" />;
  if (state === "warning" || state === "error") return <AlertTriangle size={14} className="ml-auto shrink-0" />;
  return <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-current opacity-30" />;
}

function StatusBadge({ status }: { status: ProbeStatus }): JSX.Element {
  if (status === "checking") return <Badge>Checking</Badge>;
  if (status === "passed") return <Badge tone="success">Ready</Badge>;
  if (status === "warning") return <Badge tone="warning">Warning</Badge>;
  if (status === "error") return <Badge tone="danger">Needs attention</Badge>;
  return <Badge>Not checked</Badge>;
}

function StatusMessage({ status, children }: { status: ProbeStatus; children: string }): JSX.Element {
  return (
    <p
      role={status === "error" || status === "warning" ? "alert" : undefined}
      className={cn(
        "m-0 rounded-md border border-border bg-muted/40 p-3 text-sm leading-6",
        status === "error" ? "text-danger" : "text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="m-0 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="m-0 mt-1 truncate text-foreground">{value}</p>
    </div>
  );
}

function stepState(
  stepId: OnboardingStepId,
  state: {
    micStatus: ProbeStatus;
    sttReady: boolean;
    hotkeyReady: boolean;
    pasteStatus: ProbeStatus;
    dictationStatus: DictationTestStatus;
  }
): "idle" | "passed" | "warning" | "error" {
  if (stepId === "microphone") return state.micStatus === "passed" ? "passed" : state.micStatus === "error" ? "error" : "idle";
  if (stepId === "stt") return state.sttReady ? "passed" : "idle";
  if (stepId === "hotkey") return state.hotkeyReady ? "passed" : "warning";
  if (stepId === "paste") return state.pasteStatus === "passed" ? "passed" : state.pasteStatus === "warning" ? "warning" : "idle";
  return state.dictationStatus === "passed" ? "passed" : state.dictationStatus === "error" ? "error" : "idle";
}

function downloadStatusLabel(status: string): string {
  if (status === "downloaded") return "Downloaded";
  if (status === "downloading") return "Downloading";
  if (status === "error") return "Error";
  return "Not downloaded";
}

function backendLabel(backend: string): string {
  const labels: Record<string, string> = {
    xdg_desktop_portal: "XDG Desktop Portal",
    gnome_custom_shortcut: "GNOME custom shortcuts",
    kde_kglobalaccel: "KDE KGlobalAccel",
    hyprland_bind: "Hyprland binds",
    electron_global_shortcut: "Electron globalShortcut",
    linux_native_helper: "Linux helper",
    wtype: "wtype",
    xdotool: "xdotool",
    ydotool: "ydotool",
    xdg_remote_desktop_keyboard: "XDG RemoteDesktop",
    clipboard_only: "Clipboard only"
  };
  return labels[backend] ?? backend;
}

function isActiveSessionStatus(status: AppStateSnapshot["session"]["status"]): boolean {
  return status === "recording" || status === "transcribing" || status === "processing" || status === "pasting";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function waitForTextareaValue(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  expected: string,
  timeoutMs: number
): Promise<boolean> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (textareaRef.current?.value.includes(expected)) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  return Boolean(textareaRef.current?.value.includes(expected));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
