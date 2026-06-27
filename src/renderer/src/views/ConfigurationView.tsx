import { Dialog } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, useWatch, type Control, type Path } from "react-hook-form";
import { z } from "zod";
import type { AppSettings, AppStateSnapshot } from "../../../shared/types";
import { appSettingsSchema } from "../../../shared/schemas";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Select, type SelectItem } from "../components/ui/Select";
import { useAudioDevices } from "../hooks/useAudioDevices";
import { murmurClient } from "../lib/murmur-client";
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

export function ConfigurationView({ state }: { state: AppStateSnapshot }): JSX.Element {
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
  const actionableHotkeyDiagnostics = [
    ...state.capabilities.hotkeys.diagnostics,
    ...state.capabilities.hotkeys.modeSelector.diagnostics
  ].filter(isActionableHotkeyDiagnostic);
  const audioInputItems: Array<SelectItem<string>> = [
    { value: "", label: "System default" },
    ...devices.map((device) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${device.deviceId.slice(0, 6)}`
    }))
  ];
  const currentValues = {
    settings: settings ?? state.settings
  };
  const hasUnsavedChanges = hasConfigurationChanges(currentValues, persistedValuesRef.current);
  const canClearLocalData = clearDataConfirmation.trim() === clearLocalDataConfirmationPhrase;

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
      <View title="Configuration">
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

          <Panel title="Keyboard Shortcuts">
            <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
              <Field label="Activation mode" error={form.formState.errors.settings?.activationMode?.message}>
                <FormSelect control={form.control} name="settings.activationMode" items={activationModeItems} />
              </Field>
              <Field label="Activation shortcut" error={form.formState.errors.settings?.activationHotkey?.message}>
                <FormShortcutRecorder control={form.control} name="settings.activationHotkey" />
              </Field>
              <Field label="Mode selector shortcut" error={form.formState.errors.settings?.modeSelectorHotkey?.message}>
                <FormShortcutRecorder control={form.control} name="settings.modeSelectorHotkey" />
              </Field>
              {actionableHotkeyDiagnostics.length > 0 && (
                <p className="col-span-full m-0 text-xs leading-5 text-muted-foreground">
                  {actionableHotkeyDiagnostics.join(" ")}
                </p>
              )}
            </div>
          </Panel>
        </section>

        <Panel title="Application">
          <div className="grid grid-cols-4 gap-3 max-[1180px]:grid-cols-2 max-[760px]:grid-cols-1">
            <Field label="Preferred audio input">
              <FormSelect control={form.control} name="settings.preferredAudioInputId" items={audioInputItems} />
            </Field>
            <Field label="Text retention days" error={form.formState.errors.settings?.textRetentionDays?.message}>
              <Input type="number" min={0} {...form.register("settings.textRetentionDays", { valueAsNumber: true })} />
            </Field>
            <Field label="Typing baseline WPM" error={form.formState.errors.settings?.typingBaselineWpm?.message}>
              <Input type="number" min={1} {...form.register("settings.typingBaselineWpm", { valueAsNumber: true })} />
            </Field>
          </div>
        </Panel>

        <section id="advanced-settings" className="flex flex-col gap-4">
          <h2 className="m-0 text-sm font-semibold text-foreground">Advanced Settings</h2>
          <Panel title="Clear local data">
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-muted-foreground">Clears persisted settings, modes, providers, vocabulary, and history.</p>
              <Dialog.Root open={clearDataDialogOpen} onOpenChange={handleClearDataDialogOpenChange}>
                <Dialog.Trigger render={<Button variant="danger" />}>
                  <Trash2 size={18} /> Clear local data
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/70" />
                  <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-2xl outline-none">
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

function isActionableHotkeyDiagnostic(message: string): boolean {
  const normalized = message.toLowerCase();

  if (message === "Keyboard shortcut recording is active.") return true;
  if (message.startsWith("Global activation shortcut is not registered: ")) return true;
  if (message.startsWith("Global mode selector shortcut is not registered: ")) return true;
  if (/^Unable to register .+ hotkey globally: /.test(message)) return true;
  if (/^Invalid .+ hotkey ".+": /.test(message)) return true;
  if (normalized.includes("does not support activation shortcut")) return true;
  if (normalized.includes("does not expose key release events")) return true;
  if (normalized.includes("assign it in system keyboard settings")) return true;
  if (normalized.includes("assigned a different shortcut")) return true;
  if (normalized.includes("already used")) return normalized.includes("shortcut") || normalized.includes("hotkey");
  if (normalized.includes("already owned")) return normalized.includes("shortcut") || normalized.includes("hotkey");

  return false;
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
  name
}: {
  control: Control<ConfigurationFormValues>;
  name: ShortcutSettingPath;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ShortcutRecorder
          value={String(field.value ?? "")}
          onChange={field.onChange}
          onCaptureStart={murmurClient.beginHotkeyCapture}
          onCaptureEnd={murmurClient.endHotkeyCapture}
        />
      )}
    />
  );
}
