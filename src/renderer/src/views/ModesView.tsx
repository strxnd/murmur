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
import { modePresets } from "../../../shared/defaults";
import { modeConfigSchema } from "../../../shared/schemas";
import type { AppStateSnapshot, ModeConfig, ModeIconKey } from "../../../shared/types";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
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
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { cn } from "../lib/cn";
import { makeClientId } from "../lib/ids";
import { matchingModePresetId, modeFromPreset } from "../lib/mode-presets";
import { useMurmurStore } from "../state/murmur-store";

const modesFormSchema = z.object({
  modes: z.array(modeConfigSchema)
});

type ModesFormValues = z.infer<typeof modesFormSchema>;

const languageItems: Array<SelectItem<string>> = [
  { value: "auto", label: "Auto" },
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
const presetItems: Array<SelectItem<string>> = modePresets.map((preset) => ({ value: preset.id, label: preset.name }));

const modeIcons: Record<ModeIconKey, LucideIcon> = {
  mic: Mic,
  "message-square": MessageSquare,
  mail: Mail,
  "notebook-pen": NotebookPen,
  "sliders-horizontal": SlidersHorizontal
};

export function ModesView({
  state,
  onUnsavedChangesChange
}: {
  state: AppStateSnapshot;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
}): JSX.Element {
  const setModes = useMurmurStore((store) => store.setModes);
  const activateMode = useMurmurStore((store) => store.activateMode);
  const [openModeId, setOpenModeId] = useState<string | null>(() => state.settings.activeModeId || state.modes[0]?.id || null);
  const [isCreatingMode, setIsCreatingMode] = useState(false);
  const form = useForm<ModesFormValues>({
    resolver: zodResolver(modesFormSchema),
    defaultValues: { modes: state.modes }
  });
  const draftForm = useForm<ModesFormValues>({
    resolver: zodResolver(modesFormSchema),
    defaultValues: { modes: [] }
  });
  const modes = form.watch("modes");
  const draftMode = draftForm.watch("modes")[0];
  const openModeIndex = openModeId ? modes.findIndex((mode) => mode.id === openModeId) : -1;
  const openMode = openModeIndex >= 0 ? modes[openModeIndex] : undefined;
  const selectedMode = isCreatingMode ? draftMode : openMode;
  const selectedForm = isCreatingMode ? draftForm : form;
  const selectedModeIndex = isCreatingMode ? 0 : openModeIndex;
  const modeListParent = useAutoAnimateRef<HTMLDivElement>();
  const hasUnsavedChanges = form.formState.isDirty || Boolean(draftMode);

  useEffect(() => {
    form.reset({ modes: state.modes });
    setOpenModeId((current) =>
      current && state.modes.some((mode) => mode.id === current)
        ? current
        : state.modes.find((mode) => mode.id === state.settings.activeModeId)?.id ?? state.modes[0]?.id ?? null
    );
  }, [form, state.modes]);

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
    return () => onUnsavedChangesChange?.(false);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  const save = form.handleSubmit(async (values) => {
    await setModes(values.modes);
    form.reset({ modes: values.modes });
  });

  const createMode = (): void => {
    const customPreset = modePresets.find((preset) => preset.id === "custom")!;
    const next = modeFromPreset(customPreset, makeClientId("mode"));
    draftForm.reset({ modes: [next] });
    setIsCreatingMode(true);
    setOpenModeId(null);
  };

  const commitDraftMode = draftForm.handleSubmit((values) => {
    const next = values.modes[0];
    if (!next) return;

    form.setValue("modes", [...form.getValues("modes"), next], { shouldDirty: true, shouldValidate: true });
    draftForm.reset({ modes: [] });
    setIsCreatingMode(false);
    setOpenModeId(next.id);
  });

  const cancelDraftMode = (): void => {
    draftForm.reset({ modes: [] });
    setIsCreatingMode(false);
    setOpenModeId(
      form.getValues("modes").find((mode) => mode.id === state.settings.activeModeId)?.id ??
        form.getValues("modes")[0]?.id ??
        null
    );
  };

  const deleteMode = (modeId: string): void => {
    if (form.getValues("modes").length <= 1) return;

    const remainingModes = form.getValues("modes").filter((candidate) => candidate.id !== modeId);
    form.setValue("modes", remainingModes, { shouldDirty: true, shouldValidate: true });
    setOpenModeId(remainingModes.find((candidate) => candidate.id === state.settings.activeModeId)?.id ?? remainingModes[0]?.id ?? null);
  };

  const makeActive = (modeId: string): void => {
    void form.handleSubmit(async (values) => {
      await setModes(values.modes);
      form.reset({ modes: values.modes });
      await activateMode(modeId);
    })();
  };

  return (
    <View
        title="Modes"
        description="Create reusable styles for emails, notes, edits, and other writing."
        actions={
          <Toolbar>
            <Button onClick={createMode} disabled={Boolean(draftMode)}>
              <Plus size={18} /> Create mode
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={form.formState.isSubmitting || !form.formState.isDirty}>
              <Save size={18} /> Save
            </Button>
          </Toolbar>
        }
    >
      <div className="modes-workspace grid min-h-[560px] grid-cols-[minmax(17rem,0.72fr)_minmax(28rem,1.3fr)] items-stretch gap-3 max-[900px]:grid-cols-1">
        <Panel
          title="Your modes"
          actions={<span className="text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">{modes.length + (draftMode ? 1 : 0)} total</span>}
          className="modes-master-panel"
        >
          <div ref={modeListParent} className="flex flex-col gap-1.5">
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={cn(
                  "mode-master-row grid min-h-[54px] w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-[11px] border border-transparent bg-transparent px-2.5 py-2 text-left outline-none transition-colors hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-foreground/25",
                  !isCreatingMode && openModeId === mode.id && "border-border bg-muted"
                )}
                onClick={() => {
                  setIsCreatingMode(false);
                  setOpenModeId(mode.id);
                }}
              >
                <ModeGlyph iconKey={mode.iconKey} active={openModeId === mode.id} />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-semibold text-foreground">{mode.name}</span>
                  <span className="truncate text-xs text-subtle">
                    {mode.language && mode.language !== "auto" ? mode.language : "Auto"} · {mode.aiEnabled ? "AI cleanup" : "STT only"}
                  </span>
                </span>
                <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {mode.id === state.settings.activeModeId && <Badge className="shrink-0">Active</Badge>}
                </span>
                <ChevronRight
                  size={16}
                  className={cn(
                    "mode-row-chevron text-muted-foreground",
                    !isCreatingMode && openModeId === mode.id && "text-foreground"
                  )}
                />
              </button>
            ))}
            {draftMode && (
              <button
                type="button"
                className={cn(
                  "mode-master-row grid min-h-[54px] w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-[11px] border border-border bg-muted px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-foreground/25",
                  !isCreatingMode && "border-transparent bg-transparent"
                )}
                onClick={() => {
                  setOpenModeId(null);
                  setIsCreatingMode(true);
                }}
              >
                <ModeGlyph iconKey={draftMode.iconKey} active={isCreatingMode} />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-semibold text-foreground">{draftMode.name || "Untitled mode"}</span>
                  <span className="truncate text-xs text-subtle">
                    {draftMode.language && draftMode.language !== "auto" ? draftMode.language : "Auto"} · {draftMode.aiEnabled ? "AI cleanup" : "STT only"}
                  </span>
                </span>
                <Badge tone="warning" className="shrink-0">Draft</Badge>
                <ChevronRight size={16} className={cn("mode-row-chevron text-muted-foreground", isCreatingMode && "text-foreground")} />
              </button>
            )}
          </div>
        </Panel>

        {selectedMode && (
          <Panel
            title={selectedMode.name || "Mode"}
            actions={<span className="text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Editable mode</span>}
            className="modes-detail-panel"
          >
            <ModeEditor
              form={selectedForm}
              index={selectedModeIndex}
              mode={selectedMode}
              activeModeId={state.settings.activeModeId}
              onCreate={isCreatingMode ? () => void commitDraftMode() : undefined}
              onCancelCreate={isCreatingMode ? cancelDraftMode : undefined}
              onDelete={isCreatingMode || modes.length <= 1 ? undefined : () => deleteMode(selectedMode.id)}
              onMakeActive={isCreatingMode ? undefined : () => makeActive(selectedMode.id)}
            />
          </Panel>
        )}
      </div>
    </View>
  );
}

function ModeEditor({
  form,
  index,
  mode,
  activeModeId,
  onCreate,
  onCancelCreate,
  onDelete,
  onMakeActive
}: {
  form: UseFormReturn<ModesFormValues>;
  index: number;
  mode: ModeConfig;
  activeModeId: string;
  onCreate?: () => void;
  onCancelCreate?: () => void;
  onDelete?: () => void;
  onMakeActive?: () => void;
}): JSX.Element {
  const editorParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div ref={editorParent} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-5">
        <p className="m-0 max-w-2xl text-sm leading-6 text-muted-foreground">{mode.description || "Configure how this mode turns speech into finished text."}</p>
        <div className="flex shrink-0 items-center gap-2">
          {onCreate ? (
            <>
              <Button size="sm" onClick={onCancelCreate} disabled={!onCancelCreate}>
                <X size={16} /> Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={onCreate}>
                <Plus size={16} /> Create
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={onMakeActive} disabled={!onMakeActive || activeModeId === mode.id}>
                <Check size={16} /> Make active
              </Button>
              {onDelete && (
                <Dialog.Root>
                  <Dialog.Trigger render={<IconButton title="Delete mode" tone="danger" />}>
                    <Trash2 size={18} />
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
                    <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                      <Dialog.Title className="m-0 text-base font-semibold text-foreground">Delete mode?</Dialog.Title>
                      <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                        This will remove {mode.name || "this mode"} from your modes. Save changes to persist the deletion.
                      </Dialog.Description>
                      <div className="mt-5 flex justify-end gap-2">
                        <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
                        <Dialog.Close onClick={onDelete} render={<Button variant="danger" />}>
                          Delete mode
                        </Dialog.Close>
                      </div>
                    </Dialog.Popup>
                  </Dialog.Portal>
                </Dialog.Root>
              )}
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 max-[900px]:grid-cols-1">
        <Field label="Preset">
          <Select
            aria-label="Mode preset"
            items={presetItems}
            value={matchingModePresetId(mode, modePresets)}
            onValueChange={(presetId) => {
              const preset = modePresets.find((candidate) => candidate.id === presetId);
              if (!preset) return;
              form.setValue(`modes.${index}`, modeFromPreset(preset, mode.id), {
                shouldDirty: true,
                shouldValidate: true
              });
            }}
          />
        </Field>
        <Field label="Name" error={form.formState.errors.modes?.[index]?.name?.message}>
          <Input
            aria-label="Mode name"
            {...form.register(`modes.${index}.name`)}
          />
        </Field>
        <Field label="Language">
          <Controller
            control={form.control}
            name={`modes.${index}.language`}
            render={({ field }) => {
              const value = normalizeLanguageValue(field.value);
              return (
                <Select
                  aria-label="Mode language"
                  items={getLanguageItems(value)}
                  value={value}
                  onValueChange={field.onChange}
                />
              );
            }}
          />
        </Field>
      </div>

      <Switch
        label="Rewrite with AI"
        checked={mode.aiEnabled}
        onCheckedChange={(checked) =>
          form.setValue(`modes.${index}.aiEnabled`, checked, { shouldDirty: true, shouldValidate: true })
        }
        className="rounded-md border border-border bg-muted/20 p-3"
      />

      <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Model instructions</h3>
        <p className="m-0 text-xs leading-5 text-muted-foreground">
          Tell the model how to rewrite your transcript, including the desired tone, structure, and level of detail.
        </p>
        <Textarea
          aria-label="Model instructions"
          className="min-h-24"
          placeholder="For example: Keep it concise and conversational. Use short paragraphs and avoid corporate language."
          {...form.register(`modes.${index}.instructionPrompt`)}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Context</h3>
        <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
          <Checkbox
            label="Use active app"
            checked={mode.context.app}
            onCheckedChange={(checked) =>
              form.setValue(`modes.${index}.context.app`, checked, { shouldDirty: true, shouldValidate: true })
            }
          />
          <Checkbox
            label="Use selected text"
            checked={mode.context.selectedText}
            onCheckedChange={(checked) =>
              form.setValue(`modes.${index}.context.selectedText`, checked, { shouldDirty: true, shouldValidate: true })
            }
          />
          <Checkbox
            label="Use clipboard"
            checked={mode.context.clipboardText}
            onCheckedChange={(checked) =>
              form.setValue(`modes.${index}.context.clipboardText`, checked, { shouldDirty: true, shouldValidate: true })
            }
          />
        </div>
      </section>

      <ExamplesEditor form={form} selectedIndex={index} />
    </div>
  );
}

function ExamplesEditor({
  form,
  selectedIndex,
  readOnly = false
}: {
  form: UseFormReturn<ModesFormValues>;
  selectedIndex: number;
  readOnly?: boolean;
}): JSX.Element {
  const examples = form.watch(`modes.${selectedIndex}.examples`) ?? [];
  const examplesParent = useAutoAnimateRef<HTMLElement>();

  return (
    <section ref={examplesParent} className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Examples</h3>
        <Button
          size="sm"
          disabled={readOnly}
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
          <Input
            aria-label={`Example ${exampleIndex + 1} input`}
            placeholder="Input"
            {...form.register(`modes.${selectedIndex}.examples.${exampleIndex}.input`)}
            readOnly={readOnly}
            className={cn(readOnly && "opacity-60")}
          />
          <Input
            aria-label={`Example ${exampleIndex + 1} output`}
            placeholder="Output"
            {...form.register(`modes.${selectedIndex}.examples.${exampleIndex}.output`)}
            readOnly={readOnly}
            className={cn(readOnly && "opacity-60")}
          />
          <IconButton
            title="Remove example"
            disabled={readOnly}
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

function ModeGlyph({ iconKey, active = false }: { iconKey: ModeIconKey; active?: boolean }): JSX.Element {
  const Icon = modeIcons[iconKey] ?? SlidersHorizontal;

  return (
    <span
      className={cn(
        "mode-glyph grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-foreground",
        active && "scale-105 border-foreground/40"
      )}
    >
      <Icon size={17} />
    </span>
  );
}

function normalizeLanguageValue(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : "auto";
}

function getLanguageItems(value: string): Array<SelectItem<string>> {
  if (languageItemValues.has(value)) return languageItems;
  return [{ value, label: `Custom (${value})` }, ...languageItems];
}
