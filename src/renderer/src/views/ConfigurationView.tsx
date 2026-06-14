import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, type JSX } from "react";
import { Controller, useForm, type Control, type Path } from "react-hook-form";
import { z } from "zod";
import type { AppStateSnapshot } from "../../../shared/types";
import { appSettingsSchema, replacementRuleSchema } from "../../../shared/schemas";
import { Metric } from "../components/Metric";
import { ProviderConfigurationPanels } from "../components/ProviderConfigurationPanels";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Select, type SelectItem } from "../components/ui/Select";
import { Switch } from "../components/ui/Switch";
import { Textarea } from "../components/ui/Textarea";
import { Toolbar } from "../components/ui/Toolbar";
import { useAudioDevices } from "../hooks/useAudioDevices";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { makeClientId } from "../lib/ids";
import { murmurClient } from "../lib/murmur-client";
import { useMurmurStore } from "../state/murmur-store";

const configurationFormSchema = z.object({
  settings: appSettingsSchema,
  replacements: z.array(replacementRuleSchema)
});

type ConfigurationFormValues = z.infer<typeof configurationFormSchema>;

const themeItems: Array<SelectItem<ConfigurationFormValues["settings"]["theme"]>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

const pasteMethodItems: Array<SelectItem<ConfigurationFormValues["settings"]["pasteMethod"]>> = [
  { value: "clipboard_restore", label: "Clipboard restore" },
  { value: "clipboard_only", label: "Clipboard only" }
];

const selectedTextCaptureItems: Array<SelectItem<ConfigurationFormValues["settings"]["selectedTextCapture"]>> = [
  { value: "clipboard_restore", label: "Clipboard restore" },
  { value: "disabled", label: "Disabled" }
];

const activationModeItems: Array<SelectItem<ConfigurationFormValues["settings"]["activationMode"]>> = [
  { value: "toggle", label: "Toggle" },
  { value: "push_to_talk", label: "Push-to-talk" }
];

type ShortcutSettingPath = "settings.activationHotkey";

export function ConfigurationView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const updateSettings = useMurmurStore((store) => store.updateSettings);
  const setReplacements = useMurmurStore((store) => store.setReplacements);
  const clearLocalData = useMurmurStore((store) => store.clearLocalData);
  const devices = useAudioDevices();
  const form = useForm<ConfigurationFormValues>({
    resolver: zodResolver(configurationFormSchema),
    defaultValues: {
      settings: state.settings,
      replacements: state.replacements
    }
  });
  const replacements = form.watch("replacements");
  const replacementsParent = useAutoAnimateRef<HTMLDivElement>();
  const audioInputItems: Array<SelectItem<string>> = [
    { value: "", label: "System default" },
    ...devices.map((device) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${device.deviceId.slice(0, 6)}`
    }))
  ];

  useEffect(() => {
    if (form.formState.isDirty) return;
    form.reset({
      settings: state.settings,
      replacements: state.replacements
    });
  }, [form, form.formState.isDirty, state.replacements, state.settings]);

  const save = form.handleSubmit(async (values) => {
    await updateSettings(values.settings);
    await setReplacements(values.replacements);
    form.reset(values);
  });

  return (
    <View
      title="Configuration"
      actions={
        <Toolbar>
          <Button variant="primary" onClick={() => void save()} disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            <Save size={18} /> Save
          </Button>
        </Toolbar>
      }
    >
      <section className="grid grid-cols-2 gap-4 max-[980px]:grid-cols-1">
        <Panel title="Appearance">
          <Field label="Theme">
            <FormSelect control={form.control} name="settings.theme" items={themeItems} />
          </Field>
          <p className="m-0 mt-3 text-xs text-muted-foreground">The interface remains monochrome in this pass.</p>
        </Panel>

        <Panel title="Keyboard Shortcuts">
          <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
            <Field label="Activation mode" error={form.formState.errors.settings?.activationMode?.message}>
              <FormSelect control={form.control} name="settings.activationMode" items={activationModeItems} />
            </Field>
            <Field label="Activation shortcut" error={form.formState.errors.settings?.activationHotkey?.message}>
              <FormShortcutRecorder
                control={form.control}
                name="settings.activationHotkey"
                onCommit={async (activationHotkey) => {
                  await updateSettings({ activationHotkey });
                  form.resetField("settings.activationHotkey", { defaultValue: activationHotkey });
                }}
              />
            </Field>
            {state.capabilities.hotkeys.diagnostics.length > 0 && (
              <p className="col-span-full m-0 text-xs leading-5 text-muted-foreground">
                {state.capabilities.hotkeys.diagnostics.join(" ")}
              </p>
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Application">
        <div className="grid grid-cols-4 gap-3 max-[1180px]:grid-cols-2 max-[760px]:grid-cols-1">
          <FormSwitch control={form.control} name="settings.launchAtLogin" label="Launch at login" />
          <FormSwitch control={form.control} name="settings.localOnly" label="Local-only mode" />
          <FormSwitch control={form.control} name="settings.retainAudio" label="Retain audio" />
          <Field label="Paste method">
            <FormSelect control={form.control} name="settings.pasteMethod" items={pasteMethodItems} />
          </Field>
          <Field label="Selected text capture">
            <FormSelect control={form.control} name="settings.selectedTextCapture" items={selectedTextCaptureItems} />
          </Field>
          <Field label="Preferred audio input">
            <FormSelect control={form.control} name="settings.preferredAudioInputId" items={audioInputItems} />
          </Field>
          <Field label="Text retention days">
            <Input type="number" min={0} {...form.register("settings.textRetentionDays", { valueAsNumber: true })} />
          </Field>
          <Field label="Audio retention days">
            <Input type="number" min={0} {...form.register("settings.audioRetentionDays", { valueAsNumber: true })} />
          </Field>
          <Field label="Typing baseline WPM">
            <Input type="number" min={1} {...form.register("settings.typingBaselineWpm", { valueAsNumber: true })} />
          </Field>
        </div>
      </Panel>

      <section id="advanced-settings" className="flex flex-col gap-4">
        <h2 className="m-0 text-sm font-semibold text-foreground">Advanced Settings</h2>
        <ProviderConfigurationPanels state={state} />
        <Panel
          title="Text replacements"
          actions={
            <Button
              size="sm"
              onClick={() =>
                form.setValue(
                  "replacements",
                  [
                    {
                      id: makeClientId("replace"),
                      source: "",
                      target: "",
                      category: "",
                      caseSensitive: false,
                      regex: false,
                      runBeforeLlm: true,
                      runAfterLlm: true,
                      enabled: true,
                      notes: ""
                    },
                    ...form.getValues("replacements")
                  ],
                  { shouldDirty: true, shouldValidate: true }
                )
              }
            >
              <Plus size={16} /> Add
            </Button>
          }
        >
          <div ref={replacementsParent} className="flex flex-col gap-3">
            {replacements.length === 0 && <p className="m-0 text-sm text-muted-foreground">No text replacements.</p>}
            {replacements.map((rule, index) => (
              <div key={rule.id} className="grid grid-cols-[repeat(3,minmax(8rem,1fr))_repeat(5,5.5rem)_2.5rem] items-start gap-2.5 border-t border-border pt-3 first:border-t-0 first:pt-0 max-[1180px]:grid-cols-1">
                <Field label="Source">
                  <Input {...form.register(`replacements.${index}.source`)} />
                </Field>
                <Field label="Target">
                  <Input {...form.register(`replacements.${index}.target`)} />
                </Field>
                <Field label="Category">
                  <Input {...form.register(`replacements.${index}.category`)} />
                </Field>
                <div className="pt-6 max-[1180px]:pt-0">
                  <FormCheckbox control={form.control} name={`replacements.${index}.enabled`} label="Enabled" />
                </div>
                <div className="pt-6 max-[1180px]:pt-0">
                  <FormCheckbox control={form.control} name={`replacements.${index}.caseSensitive`} label="Case" />
                </div>
                <div className="pt-6 max-[1180px]:pt-0">
                  <FormCheckbox control={form.control} name={`replacements.${index}.regex`} label="Regex" />
                </div>
                <div className="pt-6 max-[1180px]:pt-0">
                  <FormCheckbox control={form.control} name={`replacements.${index}.runBeforeLlm`} label="Pre" />
                </div>
                <div className="pt-6 max-[1180px]:pt-0">
                  <FormCheckbox control={form.control} name={`replacements.${index}.runAfterLlm`} label="Post" />
                </div>
                <div className="pt-6 max-[1180px]:pt-0">
                  <IconButton
                    title="Delete replacement"
                    onClick={() =>
                      form.setValue(
                        "replacements",
                        form.getValues("replacements").filter((candidate) => candidate.id !== rule.id),
                        { shouldDirty: true, shouldValidate: true }
                      )
                    }
                  >
                    <Trash2 size={18} />
                  </IconButton>
                </div>
                <Field label="Notes" className="col-span-full">
                  <Textarea className="min-h-16" {...form.register(`replacements.${index}.notes`)} />
                </Field>
              </div>
            ))}
          </div>
        </Panel>

        <section className="grid grid-cols-2 gap-4 max-[980px]:grid-cols-1">
          <Panel title="Storage diagnostics">
            <Metric label="Backend" value={state.capabilities.storage.backend} />
            <Metric label="Diagnostics" value={state.capabilities.storage.diagnostics.join(" ")} />
          </Panel>
          <Panel title="Clear local data">
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-muted-foreground">Clears persisted settings, modes, providers, vocabulary, replacements, and history.</p>
              <Button variant="danger" onClick={() => void clearLocalData()}>
                <Trash2 size={18} /> Clear local data
              </Button>
            </div>
          </Panel>
        </section>
      </section>
    </View>
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
  onCommit
}: {
  control: Control<ConfigurationFormValues>;
  name: ShortcutSettingPath;
  onCommit?: (value: string) => Promise<void> | void;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ShortcutRecorder
          value={String(field.value ?? "")}
          onChange={(value) => {
            field.onChange(value);
            void onCommit?.(value);
          }}
          onCaptureStart={murmurClient.beginHotkeyCapture}
          onCaptureEnd={murmurClient.endHotkeyCapture}
        />
      )}
    />
  );
}

function FormSwitch({
  control,
  name,
  label,
  compact = false
}: {
  control: Control<ConfigurationFormValues>;
  name: Path<ConfigurationFormValues>;
  label: string;
  compact?: boolean;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Switch
          label={label}
          checked={Boolean(field.value)}
          onCheckedChange={field.onChange}
          className={compact ? "w-full" : "rounded-md border border-border bg-muted/20 p-3"}
        />
      )}
    />
  );
}

function FormCheckbox({
  control,
  name,
  label
}: {
  control: Control<ConfigurationFormValues>;
  name: Path<ConfigurationFormValues>;
  label: string;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => <Checkbox label={label} checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
    />
  );
}
