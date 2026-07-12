import { Dialog } from "@base-ui/react/dialog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  Keyboard,
  Loader2,
  Mic,
  X,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react";
import type { AppStateSnapshot, ModelCatalogItem, ModelDownloadState, SttRuntimeInstallState } from "../../../shared/types";
import { DownloadProgressStatus } from "../components/DownloadProgressStatus";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Panel } from "../components/ui/Panel";
import { Select, type SelectItem } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";
import {
  audioInputSelectItems,
  audioInputSelectValueToPreferredId,
  preferredAudioInputIdToSelectValue
} from "../lib/audio-inputs";
import { cn } from "../lib/cn";
import { downloadProgressSummary } from "../lib/download-progress";
import { murmurClient } from "../lib/murmur-client";
import { runtimeInstallForModel, runtimeStatusLabel, userRuntimeStatusMessage } from "../lib/runtimes";
import {
  downloadForModel,
  formatBytes,
  localVoiceModelActiveAndReady,
  onboardingLocalVoiceModels,
  onboardingStepIdsForState,
  onboardingSttReady,
  onboardingVoiceModel,
  runtimeIdForVoiceModel,
  type OnboardingStepId
} from "../lib/onboarding";
import { useMurmurStore } from "../state/murmur-store";

type ProbeStatus = "idle" | "checking" | "passed" | "warning" | "error";
type DictationTestStatus = "idle" | "starting" | "recording" | "waiting" | "passed" | "error";

const stepMeta: Record<OnboardingStepId, { title: string; label: string; icon: LucideIcon }> = {
  microphone: { title: "Check your microphone", label: "Microphone", icon: Mic },
  stt: { title: "Choose a speech model", label: "Speech model", icon: Download },
  transcription: { title: "Try a quick dictation", label: "Quick dictation", icon: Keyboard },
  ready: { title: "You're ready to dictate", label: "Ready", icon: CheckCircle2 }
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
  const activateMode = useMurmurStore((store) => store.activateMode);
  const startDictation = useMurmurStore((store) => store.startDictation);
  const stopDictation = useMurmurStore((store) => store.stopDictation);
  const cancelDictation = useMurmurStore((store) => store.cancelDictation);
  const [stepIndex, setStepIndex] = useState(0);
  const stepIds = useMemo(() => onboardingStepIdsForState(state), [state]);
  const currentStepIndex = Math.max(0, Math.min(stepIndex, stepIds.length - 1));
  const currentStep = stepIds[currentStepIndex] ?? "ready";
  const initialVoiceModelId = onboardingVoiceModel(state)?.id ?? "";
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState(state.settings.preferredAudioInputId ?? "");
  const [micStatus, setMicStatus] = useState<ProbeStatus>("idle");
  const [micMessage, setMicMessage] = useState("");
  const [selectedVoiceModelId, setSelectedVoiceModelId] = useState(initialVoiceModelId);
  const [isSettingUpStt, setIsSettingUpStt] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState(state.settings.activationHotkey);
  const [isSavingHotkey, setIsSavingHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
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
    setSelectedVoiceModelId(onboardingVoiceModel(state)?.id ?? "");
    setHotkey(state.settings.activationHotkey);
    setMicStatus("idle");
    setMicMessage("");
    setSttError(null);
    setHotkeyError(null);
    setDictationStatus("idle");
    setDictationMessage("");
    setDictationValue("");
    dictationPendingRef.current = false;
    previousModeIdRef.current = null;
    historyLengthBeforeDictationRef.current = state.history.length;
    void refreshAudioDevices();
  }, [open, refreshAudioDevices, state, state.history.length, state.settings.activationHotkey, state.settings.preferredAudioInputId]);

  useEffect(() => {
    setStepIndex((index) => Math.max(0, Math.min(index, stepIds.length - 1)));
  }, [stepIds.length]);

  const voiceModels = useMemo(() => onboardingLocalVoiceModels(state), [state]);
  const voiceModel = useMemo(
    () => voiceModels.find((item) => item.id === selectedVoiceModelId) ?? onboardingVoiceModel(state),
    [selectedVoiceModelId, state, voiceModels]
  );

  useEffect(() => {
    if (!open || !voiceModels.length || voiceModels.some((item) => item.id === selectedVoiceModelId)) return;
    setSelectedVoiceModelId(onboardingVoiceModel(state)?.id ?? voiceModels[0]?.id ?? "");
  }, [open, selectedVoiceModelId, state, voiceModels]);

  const download = voiceModel ? downloadForModel(state, voiceModel.id) : undefined;
  const runtime = voiceModel ? runtimeInstallForModel(state, voiceModel) : undefined;
  const selectedSttReady = voiceModel ? localVoiceModelActiveAndReady(state, voiceModel) : false;
  const sttReady = onboardingSttReady(state);
  const hotkeyChanged = hotkey !== state.settings.activationHotkey;
  const hotkeyCanProceed = !hotkeyChanged && !isSavingHotkey;
  const readyStepComplete = micStatus === "passed" && sttReady && hotkeyCanProceed && dictationStatus === "passed";
  const currentStepCanProceed =
    currentStep === "microphone"
      ? micStatus === "passed"
      : currentStep === "stt"
        ? sttReady
        : currentStep === "transcription"
          ? hotkeyCanProceed && dictationStatus === "passed"
          : readyStepComplete;
  const dictationCloseBlocked =
    dictationPendingRef.current || dictationStatus === "starting" || dictationStatus === "recording" || dictationStatus === "waiting" || isActiveSessionStatus(state.session.status);

  const audioInputItems: Array<SelectItem<string>> = audioInputSelectItems(audioDevices, selectedInputId);
  const selectedAudioInputValue = preferredAudioInputIdToSelectValue(selectedInputId);
  const canNavigateToStep = (index: number): boolean => {
    if (!dictationCloseBlocked || index === currentStepIndex) return true;
    return stepIds[index] === "transcription";
  };

  const goToStep = (index: number): void => {
    const nextIndex = Math.max(0, Math.min(stepIds.length - 1, index));
    if (!canNavigateToStep(nextIndex)) {
      setDictationMessage("Stop or cancel the dictation test before switching setup steps.");
      return;
    }
    setStepIndex(nextIndex);
  };

  const selectAudioInput = (value: string): void => {
    const preferredInputId = audioInputSelectValueToPreferredId(value);
    setSelectedInputId(preferredInputId);
    if (preferredInputId === selectedInputId || micStatus === "checking") return;
    setMicStatus("idle");
    setMicMessage("");
  };

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
    if (currentStep === "ready" && readyStepComplete) {
      await finishOnboarding();
      return;
    }
    goToStep(currentStepIndex + 1);
  };

  const probeMicrophone = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("error");
      setMicMessage("Microphone access is unavailable.");
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

  const selectVoiceModel = (modelId: string): void => {
    if (modelId === selectedVoiceModelId) return;
    setSelectedVoiceModelId(modelId);
    setSttError(null);
    setDictationStatus("idle");
    setDictationMessage("");
    setDictationValue("");
  };

  const restorePreviousMode = useCallback(async (): Promise<void> => {
    const previousModeId = previousModeIdRef.current;
    previousModeIdRef.current = null;
    if (previousModeId) await activateMode(previousModeId);
  }, [activateMode]);

  const prepareTranscriptionMode = useCallback(async (): Promise<void> => {
    if (state.settings.activeModeId === "voice_to_text") return;
    if (previousModeIdRef.current === null) previousModeIdRef.current = state.settings.activeModeId;
    await activateMode("voice_to_text");
  }, [activateMode, state.settings.activeModeId]);

  useEffect(() => {
    if (!open || currentStep !== "transcription" || !hotkeyCanProceed || !sttReady) return;
    void prepareTranscriptionMode().catch((error) => {
      setDictationStatus("error");
      setDictationMessage(errorMessage(error));
    });
  }, [currentStep, hotkeyCanProceed, open, prepareTranscriptionMode, sttReady]);

  useEffect(() => {
    const active = open && currentStep === "transcription";
    void murmurClient.setOnboardingDictationScope(active).catch(() => undefined);
    return () => {
      if (active) void murmurClient.setOnboardingDictationScope(false).catch(() => undefined);
    };
  }, [currentStep, open]);

  useEffect(() => {
    if (open && currentStep === "transcription") return;
    if (dictationPendingRef.current) return;
    void restorePreviousMode();
  }, [currentStep, open, restorePreviousMode]);

  const startTestDictation = async (): Promise<void> => {
    setDictationStatus("starting");
    setDictationMessage("");
    setDictationValue("");
    historyLengthBeforeDictationRef.current = state.history.length;
    dictationPendingRef.current = true;
    await nextFrame();
    dictationTextareaRef.current?.focus();

    try {
      await murmurClient.setOnboardingDictationScope(true);
      await prepareTranscriptionMode();
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
    if (!open || currentStep !== "transcription") return;
    if (state.session.status !== "recording") return;
    if (!dictationPendingRef.current) {
      dictationPendingRef.current = true;
      historyLengthBeforeDictationRef.current = state.history.length;
      setDictationValue("");
    }
    setDictationStatus("recording");
    setDictationMessage("Recording.");
    dictationTextareaRef.current?.focus();
  }, [currentStep, open, state.history.length, state.session.id, state.session.status]);

  useEffect(() => {
    if (!dictationPendingRef.current) return;

    if (state.session.status === "transcribing" || state.session.status === "processing" || state.session.status === "pasting") {
      setDictationStatus("waiting");
      setDictationMessage("Transcribing.");
      return;
    }

    const newHistoryItem =
      state.history.length > historyLengthBeforeDictationRef.current ? state.history[0] : undefined;
    const historyText = newHistoryItem?.processedOutput || newHistoryItem?.rawTranscript || "";
    const completedText = newHistoryItem ? historyText : state.session.status === "complete" ? state.session.transcriptPreview || "" : "";

    if (newHistoryItem || state.session.status === "complete") {
      dictationPendingRef.current = false;
      setDictationValue(completedText);
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

  const currentStepState = stepState(currentStep, {
    micStatus,
    sttReady,
    hotkeyReady: hotkeyCanProceed,
    hotkeyRegistered: state.capabilities.hotkeys.registered,
    dictationStatus,
    ready: readyStepComplete
  });
  const speechReadyLabel =
    selectedSttReady && voiceModel
      ? `Speech model active: ${voiceModel.name}`
      : sttReady
        ? "Speech recognition provider ready"
        : "Speech recognition not ready";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="onboarding-dialog-backdrop fixed inset-0 z-[70] bg-black/50" />
        <Dialog.Popup className="onboarding-dialog-popup fixed left-1/2 top-1/2 z-[80] grid h-[min(650px,calc(100dvh-3rem))] w-[min(920px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 grid-cols-[14rem_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-border bg-surface-raised text-foreground shadow-[var(--studio-float-shadow)] outline-none max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col border-r border-border bg-surface/90 max-[760px]:border-b max-[760px]:border-r-0">
            <div className="flex min-h-[68px] items-center gap-3 border-b border-border px-4">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-foreground font-display text-xl text-background">
                M
              </div>
              <div className="min-w-0">
                <div className="truncate font-display text-2xl leading-none text-foreground">Murmur</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  Setup
                </div>
              </div>
            </div>

            <nav className="flex flex-1 flex-col gap-1.5 p-3 max-[760px]:flex-row max-[760px]:overflow-x-auto">
              {stepIds.map((stepId, index) => {
                const Icon = stepMeta[stepId].icon;
                const disabled = !canNavigateToStep(index);
                return (
                  <button
                    key={stepId}
                    type="button"
                    aria-current={index === currentStepIndex ? "step" : undefined}
                    disabled={disabled}
                    title={disabled ? "Stop or cancel the dictation test before switching setup steps." : undefined}
                    onClick={() => goToStep(index)}
                    className={cn(
                      "flex min-h-10 min-w-0 items-center gap-2 rounded-[11px] px-3 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 max-[760px]:shrink-0",
                      index === currentStepIndex && "bg-foreground font-medium text-background hover:bg-foreground hover:text-background"
                    )}
                  >
                    <Icon size={16} />
                    <span className="truncate">{stepMeta[stepId].label}</span>
                    <StepStateIcon
                      state={stepState(stepId, {
                        micStatus,
                        sttReady,
                        hotkeyReady: hotkeyCanProceed,
                        hotkeyRegistered: state.capabilities.hotkeys.registered,
                        dictationStatus,
                        ready: readyStepComplete
                      })}
                    />
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-surface-raised">
            <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-4 border-b border-border bg-surface-raised px-6 py-4 max-[640px]:px-4">
              <div className="min-w-0">
                <Dialog.Title className="m-0 font-display text-3xl font-medium leading-none tracking-[-0.035em] text-foreground max-[640px]:text-2xl">
                  Set up Murmur
                </Dialog.Title>
                <Dialog.Description className="m-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Check the basics once so dictation works when you need it.
                </Dialog.Description>
              </div>
              <IconButton title="Skip setup" onClick={() => void skipOnboarding()} disabled={dictationCloseBlocked}>
                <X size={18} />
              </IconButton>
            </header>

            <main className="min-h-0 overflow-y-auto p-5 max-[640px]:p-4">
              <Panel
                title={stepMeta[currentStep].title}
                actions={<StatusBadge status={currentStepState} />}
                className="mx-auto max-w-4xl"
              >
                {currentStep === "microphone" && (
                  <MicrophoneStep
                    devices={audioInputItems}
                    selectedInputValue={selectedAudioInputValue}
                    status={micStatus}
                    message={micMessage}
                    onSelectedInputChange={selectAudioInput}
                    onProbe={() => void probeMicrophone()}
                  />
                )}
                {currentStep === "stt" && (
                  <SttStep
                    models={voiceModels}
                    selectedModelId={voiceModel?.id ?? selectedVoiceModelId}
                    activeModelId={state.modelLibrary.activeModelIds.voice}
                    downloads={state.modelLibrary.downloads}
                    runtimes={state.sttSetup.runtimes}
                    ready={selectedSttReady}
                    selectedModel={voiceModel}
                    download={download}
                    runtime={runtime}
                    setupError={sttError}
                    isSettingUp={isSettingUpStt}
                    onSelectModel={selectVoiceModel}
                    onSetup={() => void setupLocalStt()}
                  />
                )}
                {currentStep === "transcription" && (
                  <HotkeyTestStep
                    value={hotkey}
                    changed={hotkeyChanged}
                    saving={isSavingHotkey}
                    error={hotkeyError}
                    registered={state.capabilities.hotkeys.registered}
                    triggerDescription={state.capabilities.hotkeys.triggerDescription}
                    dictationStatus={dictationStatus}
                    dictationMessage={dictationMessage}
                    dictationValue={dictationValue}
                    sessionStatus={state.session.status}
                    textareaRef={dictationTextareaRef}
                    onChange={setHotkey}
                    onSave={() => void saveHotkey()}
                    onDictationChange={setDictationValue}
                    onStart={() => void startTestDictation()}
                    onStop={() => void stopTestDictation()}
                    onCancel={() => void cancelDictation()}
                  />
                )}
                {currentStep === "ready" && (
                  <ReadyStep
                    microphoneReady={micStatus === "passed"}
                    speechReady={sttReady}
                    speechReadyLabel={speechReadyLabel}
                    hotkey={state.settings.activationHotkey}
                    hotkeyReady={hotkeyCanProceed}
                    hotkeyRegistered={state.capabilities.hotkeys.registered}
                    transcriptionReady={dictationStatus === "passed"}
                    transcript={dictationValue}
                  />
                )}
              </Panel>
            </main>

            <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface-raised px-6 py-3 max-[640px]:px-4 max-[560px]:flex-col max-[560px]:items-stretch">
              <Button variant="ghost" onClick={() => void skipOnboarding()} disabled={dictationCloseBlocked}>
                <X size={16} /> Skip
              </Button>
              <div className="flex items-center justify-end gap-2 max-[560px]:justify-stretch">
                <Button
                  variant="secondary"
                  onClick={() => goToStep(currentStepIndex - 1)}
                  disabled={currentStepIndex === 0 || !canNavigateToStep(currentStepIndex - 1)}
                  className="max-[560px]:flex-1"
                >
                  <ArrowLeft size={16} /> Back
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void goNext()}
                  disabled={!currentStepCanProceed || !canNavigateToStep(currentStepIndex + 1)}
                  className="max-[560px]:flex-1"
                >
                  {currentStep === "ready" ? (
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
          </section>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MicrophoneStep({
  devices,
  selectedInputValue,
  status,
  message,
  onSelectedInputChange,
  onProbe
}: {
  devices: Array<SelectItem<string>>;
  selectedInputValue: string;
  status: ProbeStatus;
  message: string;
  onSelectedInputChange: (value: string) => void;
  onProbe: () => void;
}): JSX.Element {
  const microphoneAllowed = status === "passed";
  const checking = status === "checking";

  return (
    <div className="flex flex-col gap-4">
      <Field label="Audio input">
        <Select
          items={devices}
          value={selectedInputValue}
          onValueChange={onSelectedInputChange}
          aria-label="Audio input"
          positionerClassName="z-[90]"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={microphoneAllowed ? "secondary" : "primary"} onClick={onProbe} disabled={checking || microphoneAllowed}>
          {checking ? (
            <Loader2 className="animate-spin" size={18} />
          ) : microphoneAllowed ? (
            <CheckCircle2 size={18} />
          ) : (
            <Mic size={18} />
          )}
          {checking ? "Checking..." : microphoneAllowed ? "Microphone allowed" : "Allow microphone"}
        </Button>
        <StatusBadge status={status} />
      </div>
      {message && <StatusMessage status={status}>{message}</StatusMessage>}
    </div>
  );
}

function SttStep({
  models,
  selectedModelId,
  activeModelId,
  downloads,
  runtimes,
  ready,
  selectedModel,
  download,
  runtime,
  setupError,
  isSettingUp,
  onSelectModel,
  onSetup
}: {
  models: ModelCatalogItem[];
  selectedModelId: string;
  activeModelId?: string;
  downloads: AppStateSnapshot["modelLibrary"]["downloads"];
  runtimes: AppStateSnapshot["sttSetup"]["runtimes"];
  ready: boolean;
  selectedModel: ModelCatalogItem | null;
  download?: ModelDownloadState;
  runtime?: SttRuntimeInstallState;
  setupError: string | null;
  isSettingUp: boolean;
  onSelectModel: (modelId: string) => void;
  onSetup: () => void;
}): JSX.Element {
  const runtimeBusy = runtime?.status === "downloading" || runtime?.status === "installing";
  const downloadStatus = download?.status ?? "not_downloaded";
  const selectedModelName = selectedModel?.name ?? "No local speech model selected";
  const setupLabel = downloadStatus === "downloaded" ? "Activate" : "Download and activate";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        {models.map((item) => {
          const itemDownload = downloads.find((candidate) => candidate.modelId === item.id);
          const itemRuntimeId = runtimeIdForVoiceModel(item);
          const itemRuntime = itemRuntimeId
            ? Object.values(runtimes).find((candidate) => candidate.id === itemRuntimeId && candidate.accelerator === "cpu")
            : undefined;
          const selected = item.id === selectedModelId;
          const active = activeModelId === item.id;

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectModel(item.id)}
              className={cn(
                "min-w-0 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/25",
                selected ? "border-foreground bg-muted/60" : "border-border bg-muted/20 hover:bg-muted/40"
              )}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium text-foreground">{item.name}</p>
                  {item.description && <p className="m-0 mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {active && <Badge tone="success">Active</Badge>}
                  <Badge>{providerLabelForVoiceModel(item)}</Badge>
                  {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
                  <Badge tone={itemDownload?.status === "downloaded" ? "success" : "neutral"}>
                    {downloadStatusLabel(itemDownload?.status ?? "not_downloaded")}
                  </Badge>
                  {itemRuntime && <Badge tone={itemRuntime.status === "ready" ? "success" : "warning"}>{runtimeStatusLabel(itemRuntime)}</Badge>}
                </div>
              </div>
              {itemDownload?.status === "downloading" && (
                <DownloadProgressStatus
                  progressKey={`model:${item.id}`}
                  progressBytes={itemDownload.progressBytes}
                  totalBytes={itemDownload.totalBytes}
                  label={`${item.name} download progress`}
                  className="mt-3"
                />
              )}
            </button>
          );
        })}
      </div>
      {models.length === 0 && <StatusMessage status="error">No downloadable local speech models were found in the model catalog.</StatusMessage>}
      <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm max-[760px]:grid-cols-1">
        <Metric label="Model" value={selectedModelName} />
        <Metric label="Download" value={downloadStatus === "downloading" ? downloadProgressSummary(download) : downloadStatusLabel(downloadStatus)} />
        <Metric label="Size" value={selectedModel?.sizeBytes ? formatBytes(selectedModel.sizeBytes) : "Managed"} />
      </div>
      {runtime && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{runtime.label}</Badge>
            <Badge tone={runtime.status === "ready" ? "success" : "warning"}>{runtimeStatusLabel(runtime)}</Badge>
          </div>
          <p className="m-0 text-sm leading-6 text-muted-foreground">{userRuntimeStatusMessage(runtime)}</p>
          {runtimeBusy && (
            <DownloadProgressStatus
              progressKey={`runtime:${runtime.variantKey}`}
              progressBytes={runtime.progressBytes}
              totalBytes={runtime.totalBytes}
              label={`${runtime.label} install progress`}
            />
          )}
        </div>
      )}
      {downloadStatus === "downloading" && download && (
        <DownloadProgressStatus
          progressKey={`model:${download.modelId}`}
          progressBytes={download.progressBytes}
          totalBytes={download.totalBytes}
          label={`${selectedModelName} download progress`}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onSetup} disabled={!selectedModel || ready || isSettingUp}>
          {isSettingUp ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
          {ready ? "Ready" : isSettingUp ? "Setting up..." : setupLabel}
        </Button>
        <StatusBadge status={ready ? "passed" : setupError ? "error" : "idle"} />
      </div>
      {setupError && <StatusMessage status="error">{setupError}</StatusMessage>}
    </div>
  );
}

function HotkeyTestStep({
  value,
  changed,
  saving,
  error,
  registered,
  triggerDescription,
  dictationStatus,
  dictationMessage,
  dictationValue,
  sessionStatus,
  textareaRef,
  onChange,
  onSave,
  onDictationChange,
  onStart,
  onStop,
  onCancel
}: {
  value: string;
  changed: boolean;
  saving: boolean;
  error: string | null;
  registered: boolean;
  triggerDescription?: string;
  dictationStatus: DictationTestStatus;
  dictationMessage: string;
  dictationValue: string;
  sessionStatus: AppStateSnapshot["session"]["status"];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSave: () => void;
  onDictationChange: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}): JSX.Element {
  const recording = sessionStatus === "recording" || dictationStatus === "recording";
  const busy = dictationStatus === "starting" || dictationStatus === "waiting" || ["transcribing", "processing", "pasting"].includes(sessionStatus);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Activation shortcut">
        <ShortcutRecorder
          value={value}
          onChange={onChange}
          label="Activation shortcut"
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
        <Metric label="Shortcut" value={registered ? "Ready" : "Needs attention"} />
        {triggerDescription && <Metric label="System shortcut" value={triggerDescription} />}
      </div>
      {error && <StatusMessage status="error">{error}</StatusMessage>}
      {!registered && <StatusMessage status="warning">Choose a different shortcut or assign it in system settings.</StatusMessage>}
      <Field label="Transcript test">
        <Textarea
          ref={textareaRef}
          value={dictationValue}
          onChange={(event) => onDictationChange(event.currentTarget.value)}
          placeholder="Transcription output"
          className="min-h-32"
        />
      </Field>
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
          <Button variant="primary" onClick={onStart} disabled={changed || saving || busy}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Mic size={18} />}
            {busy ? "Working..." : "Start test"}
          </Button>
        )}
        <StatusBadge status={dictationStatus === "passed" ? "passed" : dictationStatus === "error" ? "error" : busy || recording ? "checking" : "idle"} />
      </div>
      {dictationMessage && (
        <StatusMessage status={dictationStatus === "error" ? "error" : dictationStatus === "passed" ? "passed" : "idle"}>
          {dictationMessage}
        </StatusMessage>
      )}
    </div>
  );
}

function ReadyStep({
  microphoneReady,
  speechReady,
  speechReadyLabel,
  hotkey,
  hotkeyReady,
  hotkeyRegistered,
  transcriptionReady,
  transcript
}: {
  microphoneReady: boolean;
  speechReady: boolean;
  speechReadyLabel: string;
  hotkey: string;
  hotkeyReady: boolean;
  hotkeyRegistered: boolean;
  transcriptionReady: boolean;
  transcript: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <ReadyItem ready={microphoneReady} label="Microphone ready" />
        <ReadyItem ready={speechReady} label={speechReadyLabel} />
        <ReadyItem ready={hotkeyReady} warning={!hotkeyRegistered} label={`Hotkey saved: ${hotkey}`} />
        <ReadyItem ready={transcriptionReady} label="Transcription test produced text" />
      </div>
      {transcript.trim().length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="m-0 text-xs font-medium text-muted-foreground">Transcript</p>
          <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{transcript}</p>
        </div>
      )}
    </div>
  );
}

function ReadyItem({ ready, warning = false, label }: { ready: boolean; warning?: boolean; label: string }): JSX.Element {
  const status: "passed" | "warning" | "idle" = ready ? (warning ? "warning" : "passed") : "idle";
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
      {status === "passed" ? (
        <CheckCircle2 size={14} className="shrink-0" />
      ) : status === "warning" ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-30" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
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
    hotkeyRegistered: boolean;
    dictationStatus: DictationTestStatus;
    ready: boolean;
  }
): "idle" | "passed" | "warning" | "error" {
  if (stepId === "microphone") return state.micStatus === "passed" ? "passed" : state.micStatus === "error" ? "error" : "idle";
  if (stepId === "stt") return state.sttReady ? "passed" : "idle";
  if (stepId === "transcription") {
    if (state.dictationStatus === "error") return "error";
    if (state.dictationStatus === "passed" && state.hotkeyReady) return state.hotkeyRegistered ? "passed" : "warning";
    if (state.hotkeyReady && !state.hotkeyRegistered) return "warning";
    return "idle";
  }
  return state.ready ? "passed" : "idle";
}

function downloadStatusLabel(status: string): string {
  if (status === "downloaded") return "Downloaded";
  if (status === "downloading") return "Downloading";
  if (status === "error") return "Error";
  return "Not downloaded";
}

function providerLabelForVoiceModel(item: ModelCatalogItem): string {
  if (item.defaultProviderConfig?.sttProviderType === "whisper_cpp") return "whisper.cpp";
  if (item.defaultProviderConfig?.sttProviderType === "sherpa_onnx") return "Sherpa ONNX";
  return item.provider;
}

function isActiveSessionStatus(status: AppStateSnapshot["session"]["status"]): boolean {
  return status === "recording" || status === "transcribing" || status === "processing" || status === "pasting";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
