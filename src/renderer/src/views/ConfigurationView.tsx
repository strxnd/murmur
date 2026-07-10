import { Dialog } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, useWatch, type Control, type Path } from "react-hook-form";
import { z } from "zod";
import type { AppSettings, AppStateSnapshot, SttRuntimeAccelerator, SttRuntimeInstallState } from "../../../shared/types";
import { appSettingsSchema } from "../../../shared/schemas";
import { AccelerationMark, type BrandAccelerator } from "../components/AccelerationMark";
import { DownloadProgressStatus } from "../components/DownloadProgressStatus";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Select, type SelectItem } from "../components/ui/Select";
import { useAudioDevices } from "../hooks/useAudioDevices";
import {
  audioInputSelectItems,
  audioInputSelectValueToPreferredId,
  preferredAudioInputIdToSelectValue
} from "../lib/audio-inputs";
import { murmurClient } from "../lib/murmur-client";
import {
  acceleratorLabel,
  detectedAccelerators as detectAccelerators,
  isRuntimeBusy,
  uniqueRuntimeInstallStates
} from "../lib/runtimes";
import { useMurmurStore } from "../state/murmur-store";

const configurationFormSchema = z.object({
  settings: appSettingsSchema
});

type ConfigurationFormValues = z.infer<typeof configurationFormSchema>;

const promptAnimationMs = 180;
const clearLocalDataConfirmationPhrase = "CLEAR LOCAL DATA";

const editableSettingsKeys = [
  "theme",
  "textRetentionDays",
  "activationMode",
  "activationHotkey",
  "modeSelectorHotkey",
  "recordingPillPosition",
  "preferredAudioInputId",
  "typingBaselineWpm"
] as const satisfies ReadonlyArray<keyof AppSettings>;

type EditableSettingsKey = (typeof editableSettingsKeys)[number];

const themeItems: Array<SelectItem<ConfigurationFormValues["settings"]["theme"]>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

const activationModeItems: Array<SelectItem<ConfigurationFormValues["settings"]["activationMode"]>> = [
  { value: "toggle", label: "Toggle" },
  { value: "push_to_talk", label: "Push-to-talk" }
];

const recordingPillPositionItems: Array<SelectItem<ConfigurationFormValues["settings"]["recordingPillPosition"]>> = [
  { value: "bottom_center", label: "Bottom center" },
  { value: "bottom_right", label: "Bottom right" },
  { value: "bottom_left", label: "Bottom left" }
];

type ShortcutSettingPath = "settings.activationHotkey" | "settings.modeSelectorHotkey";

export function ConfigurationView({
  state,
  onUnsavedChangesChange
}: {
  state: AppStateSnapshot;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
}): JSX.Element {
  const updateSettings = useMurmurStore((store) => store.updateSettings);
  const clearLocalData = useMurmurStore((store) => store.clearLocalData);
  const devices = useAudioDevices();
  const form = useForm<ConfigurationFormValues>({
    resolver: zodResolver(configurationFormSchema),
    defaultValues: {
      settings: state.settings
    }
  });
  const settings = useWatch({ control: form.control, name: "settings" });
  const persistedValuesRef = useRef<ConfigurationFormValues>(
    cloneConfigurationValues({
      settings: state.settings
    })
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPromptMounted, setIsPromptMounted] = useState(false);
  const [clearDataDialogOpen, setClearDataDialogOpen] = useState(false);
  const [clearDataConfirmation, setClearDataConfirmation] = useState("");
  const [isClearingLocalData, setIsClearingLocalData] = useState(false);
  const [clearDataError, setClearDataError] = useState<string | null>(null);
  const currentValues = {
    settings: settings ?? state.settings
  };
  const selectedAudioInputId = currentValues.settings.preferredAudioInputId ?? "";
  const audioInputItems: Array<SelectItem<string>> = audioInputSelectItems(devices, selectedAudioInputId);
  const hasUnsavedChanges = hasConfigurationChanges(currentValues, persistedValuesRef.current);
  const canClearLocalData = clearDataConfirmation.trim() === clearLocalDataConfirmationPhrase;

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
    return () => onUnsavedChangesChange?.(false);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (hasUnsavedChanges) {
      setIsPromptMounted(true);
      return undefined;
    }

    if (!isPromptMounted) return undefined;

    const timeout = window.setTimeout(() => setIsPromptMounted(false), promptAnimationMs);
    return () => window.clearTimeout(timeout);
  }, [hasUnsavedChanges, isPromptMounted]);

  useEffect(() => {
    if (form.formState.isDirty) return;
    const values = {
      settings: state.settings
    };
    persistedValuesRef.current = cloneConfigurationValues(values);
    form.reset(values);
  }, [form, form.formState.isDirty, state.settings]);

  const saveChanges = useCallback(async (): Promise<void> => {
    setSaveError(null);

    const isValid = await form.trigger();
    if (!isValid) {
      setSaveError("Fix the highlighted fields before saving.");
      return;
    }

    const values = cloneConfigurationValues(form.getValues());
    const persistedValues = persistedValuesRef.current;
    const settingsPatch = changedSettingsPatch(values.settings, persistedValues.settings);
    const shouldSaveSettings = Object.keys(settingsPatch).length > 0;

    if (!shouldSaveSettings) {
      form.reset(cloneConfigurationValues(persistedValues));
      return;
    }

    setIsSaving(true);

    try {
      if (shouldSaveSettings) await updateSettings(settingsPatch);

      persistedValuesRef.current = cloneConfigurationValues(values);
      form.reset(cloneConfigurationValues(values));
    } catch (error) {
      setSaveError(`Could not save configuration: ${errorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }, [form, updateSettings]);

  const restoreSavedChanges = useCallback((): void => {
    setSaveError(null);
    form.reset(cloneConfigurationValues(persistedValuesRef.current));
  }, [form]);

  const handleClearDataDialogOpenChange = useCallback(
    (open: boolean): void => {
      if (isClearingLocalData) return;

      setClearDataDialogOpen(open);

      if (!open) {
        setClearDataConfirmation("");
        setClearDataError(null);
      }
    },
    [isClearingLocalData]
  );

  const confirmClearLocalData = useCallback(async (): Promise<void> => {
    if (!canClearLocalData || isClearingLocalData) return;

    setClearDataError(null);
    setIsClearingLocalData(true);

    try {
      await clearLocalData();
      setClearDataDialogOpen(false);
      setClearDataConfirmation("");
    } catch (error) {
      setClearDataError(`Could not clear local data: ${errorMessage(error)}`);
    } finally {
      setIsClearingLocalData(false);
    }
  }, [canClearLocalData, clearLocalData, isClearingLocalData]);

  const unsavedChangesPrompt = isPromptMounted
    ? createPortal(
        <div className="pointer-events-none fixed bottom-4 left-[17rem] right-4 z-40 max-[980px]:left-4">
          <div
            data-state={hasUnsavedChanges ? "open" : "closed"}
            role="region"
            aria-label="Unsaved configuration changes"
            className="configuration-unsaved-prompt pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-3 shadow-[var(--console-popover-shadow)] max-[760px]:flex-col max-[760px]:items-stretch"
          >
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-foreground">You have unsaved changes</p>
              <p className="m-0 mt-1 text-xs text-muted-foreground">Save your edits, or restore the last saved configuration.</p>
              {saveError && (
                <p role="alert" className="m-0 mt-1 text-xs text-danger">
                  {saveError}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button variant="ghost" onClick={restoreSavedChanges} disabled={isSaving}>
                <RotateCcw size={16} /> Restore saved
              </Button>
              <Button variant="primary" onClick={() => void saveChanges()} disabled={isSaving}>
                <Save size={16} /> {isSaving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <View title="Settings" description="Manage appearance, shortcuts, audio, storage, and performance.">
        <section className="grid grid-cols-2 gap-4 max-[980px]:grid-cols-1">
          <Panel title="Appearance">
            <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
              <Field label="Theme">
                <FormSelect control={form.control} name="settings.theme" items={themeItems} />
              </Field>
              <Field label="Recording pill">
                <FormSelect control={form.control} name="settings.recordingPillPosition" items={recordingPillPositionItems} />
              </Field>
            </div>
          </Panel>

          <Panel title="Keyboard shortcuts">
            <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
              <Field label="Activation mode" error={form.formState.errors.settings?.activationMode?.message}>
                <FormSelect control={form.control} name="settings.activationMode" items={activationModeItems} />
              </Field>
              <Field label="Activation shortcut" error={form.formState.errors.settings?.activationHotkey?.message}>
                <FormShortcutRecorder control={form.control} name="settings.activationHotkey" label="Activation shortcut" />
              </Field>
              <Field label="Mode selector shortcut" error={form.formState.errors.settings?.modeSelectorHotkey?.message}>
                <FormShortcutRecorder control={form.control} name="settings.modeSelectorHotkey" label="Mode selector shortcut" />
              </Field>
            </div>
          </Panel>
        </section>

        <Panel title="Application">
          <div className="grid grid-cols-4 gap-3 max-[1180px]:grid-cols-2 max-[760px]:grid-cols-1">
            <Field label="Preferred audio input">
              <FormAudioInputSelect control={form.control} items={audioInputItems} />
            </Field>
            <Field label="Text retention days" error={form.formState.errors.settings?.textRetentionDays?.message}>
              <Input type="number" min={0} {...form.register("settings.textRetentionDays", { valueAsNumber: true })} />
            </Field>
            <Field label="Typing baseline WPM" error={form.formState.errors.settings?.typingBaselineWpm?.message}>
              <Input type="number" min={1} {...form.register("settings.typingBaselineWpm", { valueAsNumber: true })} />
            </Field>
          </div>
        </Panel>

        <AccelerationPanel state={state} />

        <section id="advanced-settings" className="flex flex-col gap-4">
          <h2 className="m-0 text-sm font-semibold text-foreground">Advanced settings</h2>
          <Panel title="Clear local data">
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-muted-foreground">Clears persisted settings, modes, providers, vocabulary, and history.</p>
              <Dialog.Root open={clearDataDialogOpen} onOpenChange={handleClearDataDialogOpenChange}>
                <Dialog.Trigger render={<Button variant="danger" />}>
                  <Trash2 size={18} /> Clear local data
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
                  <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                    <Dialog.Title className="m-0 text-base font-semibold text-foreground">Clear all local data?</Dialog.Title>
                    <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                      This will reset settings, modes, providers, vocabulary, model records, and history. This cannot be undone.
                    </Dialog.Description>
                    <div className="mt-4 flex flex-col gap-2">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="clear-local-data-confirmation">
                        Type {clearLocalDataConfirmationPhrase} to confirm.
                      </label>
                      <Input
                        id="clear-local-data-confirmation"
                        value={clearDataConfirmation}
                        onChange={(event) => {
                          setClearDataConfirmation(event.target.value);
                          setClearDataError(null);
                        }}
                        disabled={isClearingLocalData}
                        autoComplete="off"
                      />
                      {clearDataError && (
                        <p role="alert" className="m-0 text-xs text-danger">
                          {clearDataError}
                        </p>
                      )}
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                      <Dialog.Close disabled={isClearingLocalData} render={<Button variant="secondary" />}>
                        Cancel
                      </Dialog.Close>
                      <Button variant="danger" disabled={!canClearLocalData || isClearingLocalData} onClick={() => void confirmClearLocalData()}>
                        <Trash2 size={18} /> {isClearingLocalData ? "Clearing..." : "Clear local data"}
                      </Button>
                    </div>
                  </Dialog.Popup>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          </Panel>
        </section>
      </View>
      {unsavedChangesPrompt}
    </>
  );
}

type AccelerationRowTone = "neutral" | "success" | "warning" | "danger";

interface AccelerationRow {
  accelerator: BrandAccelerator;
  title: string;
  status: string;
  detail: string;
  tone: AccelerationRowTone;
  runtime?: SttRuntimeInstallState;
}

const accelerationOrder: BrandAccelerator[] = ["cuda"];

function AccelerationPanel({ state }: { state: AppStateSnapshot }): JSX.Element {
  const detectedAccelerators = detectAccelerators(state);
  const runtimes = uniqueRuntimeInstallStates(state);
  const rows = accelerationOrder
    .map((accelerator) => accelerationRow(accelerator, runtimes, detectedAccelerators))
    .filter((row): row is AccelerationRow => Boolean(row));
  const summary = detectedAccelerators.length > 0 ? "Accelerator detected" : "No accelerator";

  return (
    <Panel title="Acceleration" actions={<Badge tone={detectedAccelerators.length > 0 ? "success" : "neutral"}>{summary}</Badge>}>
      {rows.length > 0 ? (
        <div className="flex flex-col">
          {rows.map((row) => (
            <AccelerationStatusRow key={row.accelerator} row={row} />
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm leading-6 text-muted-foreground">No supported acceleration hardware detected.</p>
      )}
    </Panel>
  );
}

function AccelerationStatusRow({ row }: { row: AccelerationRow }): JSX.Element {
  return (
    <article className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0 max-[760px]:grid-cols-[2.25rem_minmax(0,1fr)]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-foreground">
        <AccelerationMark className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-sm font-medium text-foreground">{row.title}</h3>
          <Badge tone={row.tone}>{row.status}</Badge>
        </div>
        <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">{row.detail}</p>
        {row.runtime && isRuntimeBusy(row.runtime) && (
          <DownloadProgressStatus
            progressKey={`runtime:${row.runtime.variantKey}`}
            progressBytes={row.runtime.progressBytes}
            totalBytes={row.runtime.totalBytes}
            label={`${row.title} install progress`}
            className="mt-3"
          />
        )}
      </div>
    </article>
  );
}

function accelerationRow(
  accelerator: BrandAccelerator,
  runtimes: SttRuntimeInstallState[],
  detectedAccelerators: SttRuntimeAccelerator[]
): AccelerationRow | null {
  const detected = detectedAccelerators.includes(accelerator);
  const matches = runtimes.filter((runtime) => runtime.accelerator === accelerator);
  const ready = matches.filter((runtime) => runtime.status === "ready");
  const busy = matches.find(isRuntimeBusy);
  const failed = matches.find((runtime) => runtime.status === "error" || runtime.status === "repairable");
  const canInstall = matches.some((runtime) => runtime.canDownload);
  const title = acceleratorLabel(accelerator);

  if (ready.length > 0) {
    return {
      accelerator,
      title,
      status: `${title} ready`,
      detail: ready.map(runtimeProofLabel).join(", "),
      tone: "success",
      runtime: undefined
    };
  }

  if (busy) {
    return {
      accelerator,
      title,
      status: "Installing",
      detail: runtimeProofLabel(busy),
      tone: "neutral",
      runtime: busy
    };
  }

  if (failed) {
    return {
      accelerator,
      title,
      status: "Needs attention",
      detail: `${runtimeProofLabel(failed)} can be retried when acceleration is offered on Dictate.`,
      tone: "danger",
      runtime: undefined
    };
  }

  if (!detected) return null;

  return {
    accelerator,
    title,
    status: "Not installed",
    detail: canInstall
      ? "A compatible accelerator was detected. Install acceleration from Dictate."
      : "A compatible accelerator was detected. Acceleration is not available yet.",
    tone: "warning",
    runtime: undefined
  };
}

function runtimeProofLabel(runtime: SttRuntimeInstallState): string {
  const version = runtime.installedVersion ?? runtime.requiredVersion;
  return `${runtime.label} ${version}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasConfigurationChanges(values: ConfigurationFormValues, persistedValues: ConfigurationFormValues): boolean {
  return editableSettingsKeys.some((key) => !sameValue(values.settings[key], persistedValues.settings[key]));
}

function changedSettingsPatch(values: AppSettings, persistedValues: AppSettings): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};

  for (const key of editableSettingsKeys) {
    if (!sameValue(values[key], persistedValues[key])) {
      (patch as Partial<Record<EditableSettingsKey, AppSettings[EditableSettingsKey]>>)[key] = values[key];
    }
  }

  return patch;
}

function cloneConfigurationValues(values: ConfigurationFormValues): ConfigurationFormValues {
  return JSON.parse(JSON.stringify(values)) as ConfigurationFormValues;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function FormAudioInputSelect({
  control,
  items
}: {
  control: Control<ConfigurationFormValues>;
  items: Array<SelectItem<string>>;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name="settings.preferredAudioInputId"
      render={({ field }) => (
        <Select
          items={items}
          value={preferredAudioInputIdToSelectValue(field.value)}
          onValueChange={(value) => {
            const preferredInputId = audioInputSelectValueToPreferredId(value);
            field.onChange(preferredInputId || undefined);
          }}
          aria-label="Preferred audio input"
        />
      )}
    />
  );
}

function FormSelect({
  control,
  name,
  items,
  disabled
}: {
  control: Control<ConfigurationFormValues>;
  name: Path<ConfigurationFormValues>;
  items: Array<SelectItem<string>>;
  disabled?: boolean;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select items={items} value={(field.value as string | undefined) ?? ""} onValueChange={field.onChange} disabled={disabled} />
      )}
    />
  );
}

function FormShortcutRecorder({
  control,
  name,
  label
}: {
  control: Control<ConfigurationFormValues>;
  name: ShortcutSettingPath;
  label: string;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ShortcutRecorder
          value={String(field.value ?? "")}
          onChange={field.onChange}
          label={label}
          onCaptureStart={murmurClient.beginHotkeyCapture}
          onCaptureEnd={murmurClient.endHotkeyCapture}
        />
      )}
    />
  );
}
