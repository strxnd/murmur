import { Dialog } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ChevronRight,
  Mail,
  MessageSquare,
  Mic,
  NotebookPen,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState, type JSX } from "react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { modePresetList, modePresets } from "../../../shared/mode-presets";
import { modeConfigSchema } from "../../../shared/schemas";
import type { AppStateSnapshot, ModeConfig, ModePresetId } from "../../../shared/types";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Select, type SelectItem } from "../components/ui/Select";
import { Switch } from "../components/ui/Switch";
import { Textarea } from "../components/ui/Textarea";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { cn } from "../lib/cn";
import { makeClientId } from "../lib/ids";
import { useMurmurStore } from "../state/murmur-store";

const modesFormSchema = z.object({
  modes: z.array(modeConfigSchema)
});

type ModesFormValues = z.infer<typeof modesFormSchema>;

const presetItems: Array<SelectItem<ModePresetId>> = modePresetList.map((preset) => ({
  value: preset.id,
  label: preset.label
}));

const languageItems: Array<SelectItem<string>> = [
  { value: "auto", label: "Auto detect" },
  { value: "af", label: "Afrikaans" },
  { value: "am", label: "Amharic" },
  { value: "ar", label: "Arabic" },
  { value: "as", label: "Assamese" },
  { value: "az", label: "Azerbaijani" },
  { value: "ba", label: "Bashkir" },
  { value: "be", label: "Belarusian" },
  { value: "bg", label: "Bulgarian" },
  { value: "bn", label: "Bengali" },
  { value: "bo", label: "Tibetan" },
  { value: "br", label: "Breton" },
  { value: "bs", label: "Bosnian" },
  { value: "ca", label: "Catalan" },
  { value: "cs", label: "Czech" },
  { value: "cy", label: "Welsh" },
  { value: "da", label: "Danish" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "et", label: "Estonian" },
  { value: "eu", label: "Basque" },
  { value: "fa", label: "Persian" },
  { value: "fi", label: "Finnish" },
  { value: "fo", label: "Faroese" },
  { value: "fr", label: "French" },
  { value: "gl", label: "Galician" },
  { value: "gu", label: "Gujarati" },
  { value: "ha", label: "Hausa" },
  { value: "haw", label: "Hawaiian" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hr", label: "Croatian" },
  { value: "ht", label: "Haitian Creole" },
  { value: "hu", label: "Hungarian" },
  { value: "hy", label: "Armenian" },
  { value: "id", label: "Indonesian" },
  { value: "is", label: "Icelandic" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "jw", label: "Javanese" },
  { value: "ka", label: "Georgian" },
  { value: "kk", label: "Kazakh" },
  { value: "km", label: "Khmer" },
  { value: "kn", label: "Kannada" },
  { value: "ko", label: "Korean" },
  { value: "la", label: "Latin" },
  { value: "lb", label: "Luxembourgish" },
  { value: "ln", label: "Lingala" },
  { value: "lo", label: "Lao" },
  { value: "lt", label: "Lithuanian" },
  { value: "lv", label: "Latvian" },
  { value: "mg", label: "Malagasy" },
  { value: "mi", label: "Maori" },
  { value: "mk", label: "Macedonian" },
  { value: "ml", label: "Malayalam" },
  { value: "mn", label: "Mongolian" },
  { value: "mr", label: "Marathi" },
  { value: "ms", label: "Malay" },
  { value: "mt", label: "Maltese" },
  { value: "my", label: "Myanmar" },
  { value: "ne", label: "Nepali" },
  { value: "nl", label: "Dutch" },
  { value: "nn", label: "Norwegian Nynorsk" },
  { value: "no", label: "Norwegian" },
  { value: "oc", label: "Occitan" },
  { value: "pa", label: "Punjabi" },
  { value: "pl", label: "Polish" },
  { value: "ps", label: "Pashto" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sa", label: "Sanskrit" },
  { value: "sd", label: "Sindhi" },
  { value: "si", label: "Sinhala" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "sn", label: "Shona" },
  { value: "so", label: "Somali" },
  { value: "sq", label: "Albanian" },
  { value: "sr", label: "Serbian" },
  { value: "su", label: "Sundanese" },
  { value: "sv", label: "Swedish" },
  { value: "sw", label: "Swahili" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "tg", label: "Tajik" },
  { value: "th", label: "Thai" },
  { value: "tk", label: "Turkmen" },
  { value: "tl", label: "Tagalog" },
  { value: "tr", label: "Turkish" },
  { value: "tt", label: "Tatar" },
  { value: "uk", label: "Ukrainian" },
  { value: "ur", label: "Urdu" },
  { value: "uz", label: "Uzbek" },
  { value: "vi", label: "Vietnamese" },
  { value: "yi", label: "Yiddish" },
  { value: "yo", label: "Yoruba" },
  { value: "yue", label: "Cantonese" },
  { value: "zh", label: "Chinese" }
];

const languageItemValues = new Set(languageItems.map((item) => item.value));

const presetIcons: Record<ModePresetId, LucideIcon> = {
  voice_to_text: Mic,
  message: MessageSquare,
  mail: Mail,
  note: NotebookPen,
  custom: SlidersHorizontal
};

export function ModesView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const setModes = useMurmurStore((store) => store.setModes);
  const activateMode = useMurmurStore((store) => store.activateMode);
  const [openModeId, setOpenModeId] = useState<string | null>(null);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const form = useForm<ModesFormValues>({
    resolver: zodResolver(modesFormSchema),
    defaultValues: { modes: state.modes }
  });
  const modes = form.watch("modes");
  const openModeIndex = openModeId ? modes.findIndex((mode) => mode.id === openModeId) : -1;
  const openMode = openModeIndex >= 0 ? modes[openModeIndex] : undefined;
  const modeListParent = useAutoAnimateRef<HTMLDivElement>();

  useEffect(() => {
    form.reset({ modes: state.modes });
    setOpenModeId((current) => (current && state.modes.some((mode) => mode.id === current) ? current : null));
  }, [form, state.modes]);

  const save = form.handleSubmit(async (values) => {
    const normalizedModes = ensureDefaultFirst(values.modes);
    await setModes(normalizedModes);
    form.reset({ modes: normalizedModes });
  });

  const createMode = (presetId: ModePresetId): void => {
    const next = createModeFromPreset(presetId);
    form.setValue("modes", [...form.getValues("modes"), next], { shouldDirty: true, shouldValidate: true });
    setPresetPickerOpen(false);
    setOpenModeId(next.id);
  };

  const openCreatePopup = (): void => {
    setOpenModeId(null);
    setPresetPickerOpen(true);
  };

  const closeModePopup = (): void => {
    setOpenModeId(null);
    setPresetPickerOpen(false);
  };

  const applyPreset = (index: number, presetId: ModePresetId): void => {
    form.setValue(`modes.${index}.presetId`, presetId, { shouldDirty: true, shouldValidate: true });
    if (presetId === "custom") return;

    const preset = modePresets[presetId];
    form.setValue(`modes.${index}.instructionPrompt`, preset.instructionPrompt, { shouldDirty: true, shouldValidate: true });
    form.setValue(`modes.${index}.context`, { ...preset.context }, { shouldDirty: true, shouldValidate: true });
  };

  const deleteMode = (modeId: string): void => {
    const mode = form.getValues("modes").find((candidate) => candidate.id === modeId);
    if (!mode || mode.kind === "default") return;

    form.setValue(
      "modes",
      form.getValues("modes").filter((candidate) => candidate.id !== modeId),
      { shouldDirty: true, shouldValidate: true }
    );
    closeModePopup();
  };

  const makeActive = (modeId: string): void => {
    void form.handleSubmit(async (values) => {
      const normalizedModes = ensureDefaultFirst(values.modes);
      await setModes(normalizedModes);
      form.reset({ modes: normalizedModes });
      await activateMode(modeId);
    })();
  };

  return (
    <>
      <View
        title="Modes"
        actions={
          <Toolbar>
            <Button onClick={openCreatePopup}>
              <Plus size={18} /> Create mode
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={form.formState.isSubmitting || !form.formState.isDirty}>
              <Save size={18} /> Save
            </Button>
          </Toolbar>
        }
      >
        <section>
          <div ref={modeListParent} className="flex flex-col gap-2">
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={cn(
                  "mode-row grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left outline-none hover:bg-muted/70 focus-visible:bg-muted",
                  openModeId === mode.id && "bg-muted"
                )}
                onClick={() => {
                  setPresetPickerOpen(false);
                  setOpenModeId(mode.id);
                }}
              >
                <PresetGlyph presetId={mode.presetId} active={openModeId === mode.id} />
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{mode.name}</span>
                  {mode.id === state.settings.activeModeId && <Badge className="shrink-0">Active</Badge>}
                </span>
                <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                  <Badge className="text-subtle">{mode.language && mode.language !== "auto" ? mode.language : "Auto language"}</Badge>
                  <Badge className="text-subtle">{mode.aiEnabled ? "AI cleanup" : "STT only"}</Badge>
                </span>
                <ChevronRight
                  size={16}
                  className={cn("mode-row-chevron text-muted-foreground", openModeId === mode.id && "rotate-90 text-foreground")}
                />
              </button>
            ))}
          </div>
        </section>
      </View>

      <Dialog.Root
        open={presetPickerOpen || Boolean(openMode)}
        onOpenChange={(open) => {
          if (!open) closeModePopup();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="mode-dialog-backdrop fixed inset-0 z-40 bg-black/70" />
          <Dialog.Popup
            className="mode-dialog-popup fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-md border border-border bg-surface-raised p-4 text-sm text-foreground shadow-2xl shadow-black/40 outline-none"
            style={{ width: "min(36rem, calc(100vw - 2rem))" }}
          >
            {presetPickerOpen ? (
              <PresetPicker onSelect={createMode} onClose={closeModePopup} />
            ) : (
              openMode && (
                <ModeEditor
                  form={form}
                  index={openModeIndex}
                  mode={openMode}
                  activeModeId={state.settings.activeModeId}
                  onApplyPreset={applyPreset}
                  onClose={closeModePopup}
                  onDelete={() => deleteMode(openMode.id)}
                  onMakeActive={() => makeActive(openMode.id)}
                />
              )
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function PresetPicker({ onSelect, onClose }: { onSelect: (presetId: ModePresetId) => void; onClose: () => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Dialog.Title className="m-0 truncate text-base font-semibold text-foreground">Create mode</Dialog.Title>
          <Dialog.Description className="m-0 mt-1 text-xs text-muted-foreground">Choose a preset to start from.</Dialog.Description>
        </div>
        <IconButton title="Close" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="grid grid-cols-1 gap-2">
        {modePresetList.map((preset) => {
          const Icon = presetIcons[preset.id];
          return (
            <button
              key={preset.id}
              type="button"
              className="mode-preset-option grid min-h-12 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted"
              onClick={() => onSelect(preset.id)}
            >
              <span className="mode-preset-option-icon grid h-9 w-9 place-items-center rounded-md border border-border bg-surface-raised">
                <Icon size={17} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{preset.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {preset.aiEnabled ? "AI cleanup with preset context" : "Raw speech-to-text"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModeEditor({
  form,
  index,
  mode,
  activeModeId,
  onApplyPreset,
  onClose,
  onDelete,
  onMakeActive
}: {
  form: UseFormReturn<ModesFormValues>;
  index: number;
  mode: ModeConfig;
  activeModeId: string;
  onApplyPreset: (index: number, presetId: ModePresetId) => void;
  onClose: () => void;
  onDelete: () => void;
  onMakeActive: () => void;
}): JSX.Element {
  const isCustomPreset = mode.presetId === "custom";
  const editorParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div ref={editorParent} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PresetGlyph presetId={mode.presetId} active />
          <div className="min-w-0">
            <h2 className="m-0 truncate text-base font-semibold text-foreground">{mode.name || "Mode"}</h2>
            <p className="m-0 truncate text-xs text-muted-foreground">{modePresets[mode.presetId]?.label ?? modePresets.custom.label}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onMakeActive} disabled={activeModeId === mode.id}>
            <Check size={16} /> Make active
          </Button>
          <IconButton title="Delete mode" tone="danger" onClick={onDelete} disabled={mode.kind === "default"}>
            <Trash2 size={18} />
          </IconButton>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
        <Field label="Name" error={form.formState.errors.modes?.[index]?.name?.message}>
          <Input {...form.register(`modes.${index}.name`)} />
        </Field>
        <Field label="Preset">
          <Controller
            control={form.control}
            name={`modes.${index}.presetId`}
            render={({ field }) => (
              <Select
                items={presetItems}
                value={(field.value ?? "custom") as ModePresetId}
                onValueChange={(value) => onApplyPreset(index, value)}
              />
            )}
          />
        </Field>
        <Field label="Language">
          <Controller
            control={form.control}
            name={`modes.${index}.language`}
            render={({ field }) => {
              const value = normalizeLanguageValue(field.value);
              return <Select items={getLanguageItems(value)} value={value} onValueChange={field.onChange} />;
            }}
          />
        </Field>
      </div>

      <Controller
        control={form.control}
        name={`modes.${index}.aiEnabled`}
        render={({ field }) => (
          <Switch
            label="AI enabled"
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            className="rounded-md border border-border bg-muted/20 p-3"
          />
        )}
      />

      {isCustomPreset && (
        <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/20 p-3 max-[760px]:grid-cols-1">
          <Controller
            control={form.control}
            name={`modes.${index}.context.app`}
            render={({ field }) => <Checkbox label="Application" checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
          />
          <Controller
            control={form.control}
            name={`modes.${index}.context.selectedText`}
            render={({ field }) => <Checkbox label="Selected text" checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
          />
          <Controller
            control={form.control}
            name={`modes.${index}.context.clipboardText`}
            render={({ field }) => <Checkbox label="Copied text" checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
          />
        </div>
      )}

      {isCustomPreset && (
        <Field label="Custom instructions">
          <Textarea className="min-h-36" {...form.register(`modes.${index}.instructionPrompt`)} />
        </Field>
      )}

      <ExamplesEditor form={form} selectedIndex={index} />
    </div>
  );
}

function ExamplesEditor({ form, selectedIndex }: { form: UseFormReturn<ModesFormValues>; selectedIndex: number }): JSX.Element {
  const examples = form.watch(`modes.${selectedIndex}.examples`) ?? [];
  const examplesParent = useAutoAnimateRef<HTMLElement>();

  return (
    <section ref={examplesParent} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Examples</h3>
        <Button
          size="sm"
          onClick={() =>
            form.setValue(`modes.${selectedIndex}.examples`, [...examples, { input: "", output: "" }], {
              shouldDirty: true,
              shouldValidate: true
            })
          }
        >
          <Plus size={16} /> Add
        </Button>
      </div>
      {examples.length === 0 && <p className="m-0 text-sm text-muted-foreground">No examples.</p>}
      {examples.map((_example, exampleIndex) => (
        <div key={exampleIndex} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2 max-[760px]:grid-cols-1">
          <Input placeholder="Input" {...form.register(`modes.${selectedIndex}.examples.${exampleIndex}.input`)} />
          <Input placeholder="Output" {...form.register(`modes.${selectedIndex}.examples.${exampleIndex}.output`)} />
          <IconButton
            title="Remove example"
            onClick={() =>
              form.setValue(
                `modes.${selectedIndex}.examples`,
                examples.filter((_, index) => index !== exampleIndex),
                { shouldDirty: true, shouldValidate: true }
              )
            }
          >
            <X size={18} />
          </IconButton>
        </div>
      ))}
    </section>
  );
}

function PresetGlyph({ presetId, active = false }: { presetId: ModePresetId; active?: boolean }): JSX.Element {
  const Icon = presetIcons[presetId] ?? SlidersHorizontal;

  return (
    <span
      className={cn(
        "mode-preset-glyph grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-foreground",
        active && "scale-105 border-foreground/40"
      )}
    >
      <Icon size={17} />
    </span>
  );
}

function createModeFromPreset(presetId: ModePresetId): ModeConfig {
  const preset = modePresets[presetId];

  return {
    id: makeClientId("mode"),
    kind: "custom",
    presetId,
    name: preset.label,
    aiEnabled: preset.aiEnabled,
    instructionPrompt: preset.instructionPrompt,
    examples: [],
    language: "auto",
    context: { ...preset.context }
  };
}

function normalizeLanguageValue(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : "auto";
}

function getLanguageItems(value: string): Array<SelectItem<string>> {
  if (languageItemValues.has(value)) return languageItems;
  return [{ value, label: `Custom (${value})` }, ...languageItems];
}

function ensureDefaultFirst(modes: ModeConfig[]): ModeConfig[] {
  const defaultMode = modes.find((mode) => mode.kind === "default" || mode.id === "default");
  const customModes = modes.filter((mode) => mode.id !== "default").map((mode) => ({ ...mode, kind: "custom" as const }));
  return defaultMode ? [{ ...defaultMode, id: "default", kind: "default" }, ...customModes] : customModes;
}
