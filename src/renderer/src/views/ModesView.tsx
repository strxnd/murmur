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
import { modeConfigSchema } from "../../../shared/schemas";
import type { AppStateSnapshot, ModeConfig, ModeIconKey } from "../../../shared/types";
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

const modeIcons: Record<ModeIconKey, LucideIcon> = {
  mic: Mic,
  "message-square": MessageSquare,
  mail: Mail,
  "notebook-pen": NotebookPen,
  "sliders-horizontal": SlidersHorizontal
};

export function ModesView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const setModes = useMurmurStore((store) => store.setModes);
  const activateMode = useMurmurStore((store) => store.activateMode);
  const [openModeId, setOpenModeId] = useState<string | null>(null);
  const [isCreatingMode, setIsCreatingMode] = useState(false);
  const [isModeDialogOpen, setIsModeDialogOpen] = useState(false);
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
  const dialogMode = isCreatingMode ? draftMode : openMode;
  const dialogForm = isCreatingMode ? draftForm : form;
  const dialogModeIndex = isCreatingMode ? 0 : openModeIndex;
  const modeDialogOpen = isModeDialogOpen && Boolean(dialogMode);
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

  const createMode = (): void => {
    const next = createBlankMode();
    draftForm.reset({ modes: [next] });
    setIsCreatingMode(true);
    setOpenModeId(null);
    setIsModeDialogOpen(true);
  };

  const commitDraftMode = draftForm.handleSubmit((values) => {
    const next = values.modes[0];
    if (!next) return;

    form.setValue("modes", [...form.getValues("modes"), next], { shouldDirty: true, shouldValidate: true });
    draftForm.reset({ modes: [] });
    setIsCreatingMode(false);
    closeModePopup();
  });

  const closeModePopup = (): void => {
    setIsModeDialogOpen(false);
  };

  const deleteMode = (modeId: string): void => {
    const mode = form.getValues("modes").find((candidate) => candidate.id === modeId);
    if (!mode || mode.kind !== "custom") return;

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
        title="Shape your output"
        description="Create reusable dictation styles for emails, notes, edits, and other writing tasks."
        actions={
          <Toolbar>
            <Button onClick={createMode}>
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
                  !isCreatingMode && openModeId === mode.id && "bg-muted"
                )}
                onClick={() => {
                  setIsCreatingMode(false);
                  draftForm.reset({ modes: [] });
                  setOpenModeId(mode.id);
                  setIsModeDialogOpen(true);
                }}
              >
                <ModeGlyph iconKey={mode.iconKey} active={openModeId === mode.id} />
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{mode.name}</span>
                  {mode.kind === "built_in" && <Badge className="shrink-0 text-subtle">Built-in</Badge>}
                  {mode.id === state.settings.activeModeId && <Badge className="shrink-0">Active</Badge>}
                </span>
                <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                  <Badge className="text-subtle">{mode.language && mode.language !== "auto" ? mode.language : "Auto language"}</Badge>
                  <Badge className="text-subtle">{mode.aiEnabled ? "AI cleanup" : "STT only"}</Badge>
                </span>
                <ChevronRight
                  size={16}
                  className={cn(
                    "mode-row-chevron text-muted-foreground",
                    !isCreatingMode && openModeId === mode.id && "rotate-90 text-foreground"
                  )}
                />
              </button>
            ))}
          </div>
        </section>
      </View>

      <Dialog.Root
        open={modeDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsModeDialogOpen(true);
          } else {
            closeModePopup();
          }
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            setOpenModeId(null);
            if (isCreatingMode) {
              draftForm.reset({ modes: [] });
              setIsCreatingMode(false);
            }
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="mode-dialog-backdrop fixed inset-0 z-40 bg-black/50" />
          <Dialog.Popup
            className="mode-dialog-popup fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-md border border-border bg-surface-raised p-4 text-sm text-foreground shadow-[var(--console-dialog-shadow)] outline-none"
            style={{ width: "min(36rem, calc(100vw - 2rem))" }}
          >
            {dialogMode && (
              <ModeEditor
                form={dialogForm}
                index={dialogModeIndex}
                mode={dialogMode}
                activeModeId={state.settings.activeModeId}
                onCreate={isCreatingMode ? () => void commitDraftMode() : undefined}
                onClose={closeModePopup}
                onDelete={isCreatingMode ? undefined : () => deleteMode(dialogMode.id)}
                onMakeActive={isCreatingMode ? undefined : () => makeActive(dialogMode.id)}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ModeEditor({
  form,
  index,
  mode,
  activeModeId,
  onCreate,
  onClose,
  onDelete,
  onMakeActive
}: {
  form: UseFormReturn<ModesFormValues>;
  index: number;
  mode: ModeConfig;
  activeModeId: string;
  onCreate?: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onMakeActive?: () => void;
}): JSX.Element {
  const editorParent = useAutoAnimateRef<HTMLDivElement>();
  const isBuiltInMode = mode.kind === "built_in";

  return (
    <div ref={editorParent} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ModeGlyph iconKey={mode.iconKey} active />
          <div className="min-w-0">
            <Dialog.Title className="m-0 truncate text-base font-semibold text-foreground">{mode.name || "Mode"}</Dialog.Title>
            <p className="m-0 truncate text-xs text-muted-foreground">{modeKindLabel(mode.kind)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCreate ? (
            <Button size="sm" variant="primary" onClick={onCreate}>
              <Plus size={16} /> Create
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={onMakeActive} disabled={!onMakeActive || activeModeId === mode.id}>
                <Check size={16} /> Make active
              </Button>
              <Dialog.Root>
                <Dialog.Trigger
                  disabled={mode.kind !== "custom" || !onDelete}
                  render={<IconButton title="Delete mode" tone="danger" disabled={mode.kind !== "custom" || !onDelete} />}
                >
                  <Trash2 size={18} />
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
                  <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                    <Dialog.Title className="m-0 text-base font-semibold text-foreground">Delete mode?</Dialog.Title>
                    <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                      This will remove {mode.name || "this mode"} from custom modes. Save changes to persist the deletion.
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
            </>
          )}
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
        <Field label="Name" error={form.formState.errors.modes?.[index]?.name?.message}>
          <Input
            aria-label="Mode name"
            {...form.register(`modes.${index}.name`)}
            readOnly={isBuiltInMode}
            className={cn(isBuiltInMode && "opacity-60")}
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
                  disabled={isBuiltInMode}
                />
              );
            }}
          />
        </Field>
      </div>

      <Controller
        control={form.control}
        name={`modes.${index}.aiEnabled`}
        render={({ field }) => (
          <Switch
            label="Rewrite with AI"
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            disabled={isBuiltInMode}
            className="rounded-md border border-border bg-muted/20 p-3"
          />
        )}
      />

      <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Writing style</h3>
        {isBuiltInMode ? (
          <p className="m-0 text-sm leading-6 text-muted-foreground">{mode.description}</p>
        ) : (
          <Textarea
            aria-label="Writing style"
            className="min-h-24"
            placeholder="Concise, natural, and ready to paste."
            {...form.register(`modes.${index}.writingStyle`)}
          />
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
        <h3 className="m-0 text-sm font-semibold text-foreground">Context</h3>
        <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
          <Controller
            control={form.control}
            name={`modes.${index}.context.app`}
            render={({ field }) => (
              <Checkbox label="Use active app" checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={isBuiltInMode} />
            )}
          />
          <Controller
            control={form.control}
            name={`modes.${index}.context.selectedText`}
            render={({ field }) => (
              <Checkbox label="Use selected text" checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={isBuiltInMode} />
            )}
          />
          <Controller
            control={form.control}
            name={`modes.${index}.context.clipboardText`}
            render={({ field }) => (
              <Checkbox label="Use clipboard" checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={isBuiltInMode} />
            )}
          />
        </div>
      </section>

      {!isBuiltInMode && (
        <details className="group rounded-md border border-border bg-muted/20 p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/30">
            Advanced instructions
            <ChevronRight size={16} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <Field label="Raw prompt" className="mt-3">
            <Textarea
              aria-label="Advanced instructions"
              className="min-h-36"
              placeholder="Add exact prompt instructions for how this mode should process dictation."
              {...form.register(`modes.${index}.instructionPrompt`)}
            />
          </Field>
        </details>
      )}

      <ExamplesEditor form={form} selectedIndex={index} readOnly={isBuiltInMode} />
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

function createBlankMode(): ModeConfig {
  return {
    id: makeClientId("mode"),
    kind: "custom",
    iconKey: "sliders-horizontal",
    name: "New mode",
    description: "",
    aiEnabled: true,
    writingStyle: "",
    instructionPrompt: "",
    examples: [],
    language: "auto",
    context: { app: true, selectedText: true, clipboardText: true }
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

function modeKindLabel(kind: ModeConfig["kind"]): string {
  if (kind === "built_in") return "Built-in mode";
  return "Custom mode";
}

function ensureDefaultFirst(modes: ModeConfig[]): ModeConfig[] {
  const defaultMode = modes.find((mode) => mode.id === "default");
  const otherModes = modes.filter((mode) => mode.id !== "default");
  return defaultMode ? [{ ...defaultMode, id: "default", kind: "built_in" }, ...otherModes] : otherModes;
}
