import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronRight,
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
import { ModelGlyph } from "../components/ModelGlyph";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { Select, type SelectItem } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";
import {
  audioInputSelectItems,
  audioInputSelectValueToPreferredId,
  preferredAudioInputIdToSelectValue
} from "../lib/audio-inputs";
import { cn } from "../lib/cn";
import { murmurClient } from "../lib/murmur-client";
import {
  MicrophoneProbeGuard,
  onboardingDictationControls,
  type OnboardingDictationStatus
} from "../lib/onboarding-lifecycle";
import { runtimeStatusLabel, userRuntimeStatusMessage } from "../lib/runtimes";
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
type DictationTestStatus = OnboardingDictationStatus;

const stepMeta: Record<OnboardingStepId, { title: string; label: string; description: string; icon: LucideIcon }> = {
  microphone: {
    title: "Make sure Murmur can hear you.",
    label: "Microphone",
    description: "Choose the input you use, then let Murmur confirm it is available.",
    icon: Mic
  },
  stt: {
    title: "Choose how speech becomes text.",
    label: "Speech model",
    description: "Pick a local model to transcribe on this device, then download it once.",
    icon: Download
  },
  transcription: {
    title: "Test the full dictation path.",
    label: "Quick dictation",
    description: "Confirm your shortcut, speak one sentence, and check the resulting text.",
    icon: Keyboard
  },
  ready: {
    title: "Murmur is ready when you are.",
    label: "Ready",
    description: "The microphone, speech model, shortcut, and transcript test are all connected.",
    icon: CheckCircle2
  }
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
  const microphoneProbeGuardRef = useRef(new MicrophoneProbeGuard(state.settings.preferredAudioInputId ?? ""));
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
    const preferredAudioInputId = state.settings.preferredAudioInputId ?? "";
    microphoneProbeGuardRef.current.select(preferredAudioInputId);
    setSelectedInputId(preferredAudioInputId);
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
    if (!open) microphoneProbeGuardRef.current.invalidate();
  }, [open]);

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
    if (micStatus === "checking") return;
    const preferredInputId = audioInputSelectValueToPreferredId(value);
    if (preferredInputId === selectedInputId) return;
    microphoneProbeGuardRef.current.select(preferredInputId);
    setSelectedInputId(preferredInputId);
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

    const probe = microphoneProbeGuardRef.current.begin();
    setMicStatus("checking");
    setMicMessage("");

    try {
      const audio: MediaTrackConstraints | boolean = probe.inputId ? { deviceId: { exact: probe.inputId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      stream.getTracks().forEach((track) => track.stop());
      if (!microphoneProbeGuardRef.current.isCurrent(probe)) return;
      await refreshAudioDevices();
      if (!microphoneProbeGuardRef.current.isCurrent(probe)) return;
      if ((state.settings.preferredAudioInputId ?? "") !== probe.inputId) {
        await updateSettings({ preferredAudioInputId: probe.inputId || undefined });
      }
      if (!microphoneProbeGuardRef.current.isCurrent(probe)) return;
      setMicStatus("passed");
      setMicMessage("");
    } catch (error) {
      if (!microphoneProbeGuardRef.current.isCurrent(probe)) return;
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
      setDictationMessage("");
    } catch (error) {
      dictationPendingRef.current = false;
      setDictationStatus("error");
      setDictationMessage(errorMessage(error));
      await restorePreviousMode();
    }
  };

  const stopTestDictation = async (): Promise<void> => {
    setDictationStatus("waiting");
    setDictationMessage("");
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
    setDictationMessage("");
    dictationTextareaRef.current?.focus();
  }, [currentStep, open, state.history.length, state.session.id, state.session.status]);

  useEffect(() => {
    if (!dictationPendingRef.current) return;

    if (state.session.status === "transcribing" || state.session.status === "processing" || state.session.status === "pasting") {
      setDictationStatus("waiting");
      setDictationMessage("");
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
      setDictationMessage(completedText.trim().length > 0 ? "" : "No text was produced.");
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
  const CurrentStepIcon = stepMeta[currentStep].icon;
  const currentStepTitle = currentStep === "ready" && !readyStepComplete ? "Review the remaining checks." : stepMeta[currentStep].title;
  const currentStepDescription =
    currentStep === "ready" && !readyStepComplete
      ? "Return to any unchecked item, then come back here to finish setup."
      : stepMeta[currentStep].description;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="onboarding-dialog-backdrop" />
        <Dialog.Content className="onboarding-dialog-popup onboarding-shell p-0">
          <header className="onboarding-topbar">
            <div className="onboarding-brand">
              <span className="onboarding-brand-mark" aria-hidden="true">
                <AudioLines size={18} />
              </span>
              <Dialog.Title className="onboarding-brand-title">Murmur setup</Dialog.Title>
              <Dialog.Description className="sr-only">{currentStepDescription}</Dialog.Description>
            </div>
            <div className="onboarding-topbar-actions">
              <Button variant="ghost" size="sm" onClick={() => void skipOnboarding()} disabled={dictationCloseBlocked}>
                <X size={15} /> Set up later
              </Button>
            </div>
          </header>

          <div className="onboarding-layout">
            <aside className="onboarding-rail">
              <nav className="onboarding-step-list" aria-label="Setup progress">
                {stepIds.map((stepId, index) => {
                  const disabled = !canNavigateToStep(index);
                  const stateForStep = stepState(stepId, {
                    micStatus,
                    sttReady,
                    hotkeyReady: hotkeyCanProceed,
                    hotkeyRegistered: state.capabilities.hotkeys.registered,
                    dictationStatus,
                    ready: readyStepComplete
                  });
                  const stateLabel = stepStateLabel(stateForStep);
                  return (
                    <button
                      key={stepId}
                      type="button"
                      aria-current={index === currentStepIndex ? "step" : undefined}
                      disabled={disabled}
                      title={disabled ? "Stop or cancel the dictation test before switching setup steps." : undefined}
                      onClick={() => goToStep(index)}
                      className={cn(
                        "onboarding-step-button",
                        index === currentStepIndex && "onboarding-step-button--active"
                      )}
                    >
                      <span className="onboarding-step-number">{index + 1}</span>
                      <span className="onboarding-step-copy">
                        <strong>{stepMeta[stepId].label}</strong>
                        {stateLabel && <small>{stateLabel}</small>}
                      </span>
                      <StepStateIcon state={stateForStep} />
                    </button>
                  );
                })}
              </nav>
            </aside>

            <section className="onboarding-workspace">
              <main className="onboarding-content">
                <article
                  className="onboarding-stage"
                  data-step={currentStep}
                  data-status={currentStepState}
                  data-active-signal={
                    (currentStep === "microphone" && micStatus === "checking") ||
                    (currentStep === "transcription" && ["starting", "recording", "waiting"].includes(dictationStatus)) ||
                    undefined
                  }
                >
                  <header className="onboarding-stage-header">
                    <div className="onboarding-stage-meta">
                      <span>Step {currentStepIndex + 1} · {stepMeta[currentStep].label}</span>
                      <StatusBadge status={currentStepState} />
                    </div>
                    <div className="onboarding-stage-intro">
                      <span className="onboarding-stage-mark" aria-hidden="true">
                        <CurrentStepIcon size={24} />
                      </span>
                      <div>
                        <h2>{currentStepTitle}</h2>
                        <p>{currentStepDescription}</p>
                      </div>
                    </div>
                    <div className="onboarding-stage-wave" aria-hidden="true">
                      {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
                    </div>
                  </header>
                  <div className="onboarding-stage-controls">
                    {currentStep === "microphone" && (
                      <MicrophoneStep
                        devices={audioInputItems}
                        selectedInputValue={selectedAudioInputValue}
                        status={micStatus}
                        message={micMessage}
                        selectionDisabled={micStatus === "checking"}
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
                        download={download}
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
                  </div>
                </article>
              </main>

              <footer className="onboarding-footer">
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => goToStep(currentStepIndex - 1)}
                    disabled={currentStepIndex === 0 || !canNavigateToStep(currentStepIndex - 1)}
                  >
                    <ArrowLeft size={16} /> Back
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void goNext()}
                    disabled={!currentStepCanProceed || !canNavigateToStep(currentStepIndex + 1)}
                  >
                    {currentStep === "ready" ? (
                      <>
                        <Check size={16} /> Finish setup
                      </>
                    ) : (
                      <>
                        Continue <ArrowRight size={16} />
                      </>
                    )}
                  </Button>
                </div>
              </footer>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MicrophoneStep({
  devices,
  selectedInputValue,
  status,
  message,
  selectionDisabled,
  onSelectedInputChange,
  onProbe
}: {
  devices: Array<SelectItem<string>>;
  selectedInputValue: string;
  status: ProbeStatus;
  message: string;
  selectionDisabled: boolean;
  onSelectedInputChange: (value: string) => void;
  onProbe: () => void;
}): JSX.Element {
  const microphoneAllowed = status === "passed";
  const checking = status === "checking";

  return (
    <div className="onboarding-microphone-step">
      <div className="onboarding-control-heading">
        <span aria-hidden="true"><Mic size={18} /></span>
        <div>
          <h3>Input source</h3>
          <p>Select the microphone you normally use for calls and recordings.</p>
        </div>
      </div>
      <div className="onboarding-primary-control">
        <Field label="Audio input">
          <Select
            items={devices}
            value={selectedInputValue}
            onValueChange={onSelectedInputChange}
            disabled={selectionDisabled}
            aria-label="Audio input"
            positionerClassName="z-[90]"
          />
        </Field>
        <div className="onboarding-action-row">
          <Button variant={microphoneAllowed ? "secondary" : "primary"} onClick={onProbe} disabled={checking}>
            {checking ? (
              <Loader2 className="animate-spin" size={18} />
            ) : microphoneAllowed ? (
              <CheckCircle2 size={18} />
            ) : (
              <Mic size={18} />
            )}
            {checking ? "Checking..." : microphoneAllowed ? "Check again" : "Allow and check microphone"}
          </Button>
          <StatusBadge status={status} />
        </div>
      </div>
      <p className="onboarding-microphone-note">This check opens the selected input briefly, then stops it immediately.</p>
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
  download,
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
  download?: ModelDownloadState;
  setupError: string | null;
  isSettingUp: boolean;
  onSelectModel: (modelId: string) => void;
  onSetup: () => void;
}): JSX.Element {
  const downloadStatus = download?.status ?? "not_downloaded";
  const setupLabel = downloadStatus === "downloaded" ? "Activate" : "Download and activate";
  return (
    <div className="onboarding-model-step">
      <div className="onboarding-control-heading">
        <span aria-hidden="true"><Download size={18} /></span>
        <div>
          <h3>Local speech model</h3>
          <p>Smaller models install faster; larger models can improve recognition.</p>
        </div>
      </div>
      <div className="onboarding-model-list">
        {models.map((item) => {
          const itemDownload = downloads.find((candidate) => candidate.modelId === item.id);
          const itemRuntimeId = runtimeIdForVoiceModel(item);
          const itemRuntime = itemRuntimeId
            ? Object.values(runtimes).find((candidate) => candidate.id === itemRuntimeId && candidate.accelerator === "cpu")
            : undefined;
          const selected = item.id === selectedModelId;
          const active = activeModelId === item.id;

          const itemDownloadStatus = itemDownload?.status ?? "not_downloaded";

          return (
            <article key={item.id} className="onboarding-model-entry">
              <button
                type="button"
                aria-expanded={selected}
                onClick={() => onSelectModel(item.id)}
                className={cn("onboarding-model-row model-row", selected && "onboarding-model-row--selected")}
              >
                <ModelGlyph item={item} />
                <span className="onboarding-model-name">
                  <span>{item.name}</span>
                  {active && <Badge tone="success">Active</Badge>}
                </span>
                <span className="onboarding-model-row-meta">
                  <Badge>{providerLabelForVoiceModel(item)}</Badge>
                  <Badge tone={itemDownloadStatus === "error" ? "warning" : itemDownloadStatus === "downloaded" ? "success" : "neutral"}>
                    {downloadStatusLabel(itemDownloadStatus)}
                  </Badge>
                  {item.sizeBytes && <Badge>{formatBytes(item.sizeBytes)}</Badge>}
                </span>
                <ChevronRight className={cn("model-row-chevron", selected && "rotate-90")} size={16} />
              </button>
              {selected && (
                <div className="onboarding-model-detail">
                  {item.description && <p className="onboarding-model-description">{item.description}</p>}
                  {itemRuntime && itemRuntime.status !== "ready" && (
                    <div className="onboarding-runtime-status">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{itemRuntime.label}</Badge>
                        <Badge tone="warning">{runtimeStatusLabel(itemRuntime)}</Badge>
                      </div>
                      <p className="m-0 text-sm leading-6 text-muted-foreground">{userRuntimeStatusMessage(itemRuntime)}</p>
                      {(itemRuntime.status === "downloading" || itemRuntime.status === "installing") && (
                        <DownloadProgressStatus
                          progressKey={`runtime:${itemRuntime.variantKey}`}
                          progressBytes={itemRuntime.progressBytes}
                          totalBytes={itemRuntime.totalBytes}
                          label={`${itemRuntime.label} install progress`}
                        />
                      )}
                    </div>
                  )}
                  {itemDownload?.status === "downloading" && (
                    <DownloadProgressStatus
                      progressKey={`model:${item.id}`}
                      progressBytes={itemDownload.progressBytes}
                      totalBytes={itemDownload.totalBytes}
                      label={`${item.name} download progress`}
                    />
                  )}
                  <div className="onboarding-action-row">
                    <Button variant="primary" onClick={onSetup} disabled={ready || isSettingUp}>
                      {isSettingUp ? <Loader2 className="animate-spin" size={18} /> : ready ? <Check size={18} /> : <Download size={18} />}
                      {ready ? "Active" : isSettingUp ? "Setting up..." : setupLabel}
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {models.length === 0 && <StatusMessage status="error">No downloadable local speech models were found in the model catalog.</StatusMessage>}
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
  const controls = onboardingDictationControls(sessionStatus, dictationStatus);
  const { recording, busy } = controls;

  return (
    <div className="onboarding-test-step">
      <section className="onboarding-subpanel">
        <div className="onboarding-subpanel-heading">
          <span aria-hidden="true"><Keyboard size={17} /></span>
          <div>
            <h3>Recording shortcut</h3>
            <p>Use this from any app to start or stop dictation.</p>
          </div>
          <StatusBadge status={registered ? "passed" : "warning"} />
        </div>
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
        {(changed || saving) && (
          <div className="onboarding-action-row">
            <Button variant="secondary" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
              {saving ? "Saving..." : "Save shortcut"}
            </Button>
          </div>
        )}
        {error && <StatusMessage status="error">{error}</StatusMessage>}
        {!registered && <StatusMessage status="warning">Choose a different shortcut or assign it in system settings.</StatusMessage>}
      </section>

      <section className="onboarding-subpanel" data-recording={recording || undefined}>
        <div className="onboarding-subpanel-heading">
          <span aria-hidden="true"><Mic size={17} /></span>
          <div>
            <h3>Live transcript test</h3>
            <p>Speak one sentence and confirm that text appears below.</p>
          </div>
          <StatusBadge status={dictationStatus === "passed" ? "passed" : dictationStatus === "error" ? "error" : busy || recording ? "checking" : "idle"} />
        </div>
        <Field label="Transcription output">
          <Textarea
            ref={textareaRef}
            value={dictationValue}
            onChange={(event) => onDictationChange(event.currentTarget.value)}
            placeholder="Your test dictation will appear here."
            className="min-h-28"
          />
        </Field>
        <div className="onboarding-action-row">
          {controls.showStop && (
            <Button variant="primary" onClick={onStop}>
              <Check size={18} /> Stop test
            </Button>
          )}
          {controls.showCancel && (
            <Button variant="secondary" onClick={onCancel}>
              <X size={18} /> Cancel
            </Button>
          )}
          {controls.canStart && (
            <Button variant="primary" onClick={onStart} disabled={changed || saving}>
              <Mic size={18} /> Start dictation test
            </Button>
          )}
        </div>
        {dictationMessage && (
          <StatusMessage status={dictationStatus === "error" ? "error" : dictationStatus === "passed" ? "passed" : "idle"}>
            {dictationMessage}
          </StatusMessage>
        )}
      </section>
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
  const allReady = microphoneReady && speechReady && hotkeyReady && transcriptionReady;

  return (
    <div className="onboarding-ready-step">
      <div className="onboarding-ready-callout" data-ready={allReady || undefined}>
        <span aria-hidden="true">{allReady ? <AudioLines size={22} /> : <AlertTriangle size={20} />}</span>
        <div>
          <p>{allReady ? "Dictate from any app" : "Complete the unchecked items"}</p>
          <span>
            {allReady ? (
              <>Press <kbd>{hotkey}</kbd> whenever you want Murmur to listen.</>
            ) : (
              "Use the setup rail to return to a check that still needs attention."
            )}
          </span>
        </div>
      </div>
      <div className="onboarding-ready-grid">
        <ReadyItem ready={microphoneReady} label={microphoneReady ? "Microphone confirmed" : "Microphone still needs a check"} />
        <ReadyItem ready={speechReady} label={speechReadyLabel} />
        <ReadyItem
          ready={hotkeyReady}
          warning={!hotkeyRegistered}
          label={hotkeyReady ? `Shortcut saved: ${hotkey}` : "Shortcut still needs to be saved"}
        />
        <ReadyItem
          ready={transcriptionReady}
          label={transcriptionReady ? "Dictation test produced text" : "Dictation test still needs to run"}
        />
      </div>
      {transcript.trim().length > 0 && (
        <div className="onboarding-ready-transcript">
          <p>Test transcript</p>
          <blockquote>{transcript}</blockquote>
        </div>
      )}
    </div>
  );
}

function ReadyItem({ ready, warning = false, label }: { ready: boolean; warning?: boolean; label: string }): JSX.Element {
  const status: "passed" | "warning" | "idle" = ready ? (warning ? "warning" : "passed") : "idle";
  return (
    <div className="onboarding-ready-item" data-status={status}>
      {status === "passed" ? (
        <CheckCircle2 size={15} />
      ) : status === "warning" ? (
        <AlertTriangle size={15} />
      ) : (
        <span aria-hidden="true" />
      )}
      <p>{label}</p>
    </div>
  );
}

function StepStateIcon({ state }: { state: "idle" | "passed" | "warning" | "error" }): JSX.Element {
  if (state === "passed") return <CheckCircle2 size={15} className="onboarding-step-state" />;
  if (state === "warning" || state === "error") return <AlertTriangle size={15} className="onboarding-step-state" />;
  return <span className="onboarding-step-state onboarding-step-state--idle" />;
}

function StatusBadge({ status }: { status: ProbeStatus }): JSX.Element | null {
  if (status === "checking") return <Badge className="onboarding-status-badge">Checking</Badge>;
  if (status === "warning") return <Badge className="onboarding-status-badge" tone="warning">Warning</Badge>;
  if (status === "error") return <Badge className="onboarding-status-badge" tone="danger">Needs attention</Badge>;
  return null;
}

function StatusMessage({ status, children }: { status: ProbeStatus; children: string }): JSX.Element {
  return (
    <p
      role={status === "error" || status === "warning" ? "alert" : undefined}
      className="onboarding-status-message"
      data-status={status}
    >
      {children}
    </p>
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

function stepStateLabel(state: "idle" | "passed" | "warning" | "error"): string | null {
  if (state === "warning") return "Check settings";
  if (state === "error") return "Needs attention";
  return null;
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
