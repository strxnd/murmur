import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, type JSX } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import type { AppStateSnapshot } from "../../../shared/types";
import { vocabularyEntrySchema } from "../../../shared/schemas";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Textarea } from "../components/ui/Textarea";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { makeClientId } from "../lib/ids";
import { useMurmurStore } from "../state/murmur-store";

const vocabularyFormSchema = z.object({
  vocabulary: z.array(vocabularyEntrySchema)
});

type VocabularyFormValues = z.infer<typeof vocabularyFormSchema>;

export function VocabularyView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const setVocabulary = useMurmurStore((store) => store.setVocabulary);
  const form = useForm<VocabularyFormValues>({
    resolver: zodResolver(vocabularyFormSchema),
    defaultValues: {
      vocabulary: state.vocabulary
    }
  });
  const vocabulary = form.watch("vocabulary");
  const vocabularyParent = useAutoAnimateRef<HTMLDivElement>();

  useEffect(() => {
    form.reset({ vocabulary: state.vocabulary });
  }, [form, state.vocabulary]);

  const save = form.handleSubmit(async (values) => {
    await setVocabulary(values.vocabulary);
    form.reset(values);
  });

  const addTerm = (): void => {
    form.setValue(
      "vocabulary",
      [{ id: makeClientId("term"), term: "", pronunciation: "", category: "", notes: "", enabled: true }, ...form.getValues("vocabulary")],
      { shouldDirty: true, shouldValidate: true }
    );
  };

  return (
    <View
      title="Vocabulary"
      actions={
        <Toolbar>
          <Button onClick={addTerm}>
            <Plus size={18} /> Add term
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            <Save size={18} /> Save
          </Button>
        </Toolbar>
      }
    >
      <Panel>
        <p className="m-0 text-sm text-muted-foreground">
          Add custom words and phrases that should be recognized by speech-to-text.
        </p>
      </Panel>

      <Panel title="Dictionary">
        <div ref={vocabularyParent} className="flex flex-col gap-3">
          {vocabulary.length === 0 && <p className="m-0 text-sm text-muted-foreground">No vocabulary terms yet.</p>}
          {vocabulary.map((entry, index) => (
            <div key={entry.id} className="grid grid-cols-[minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,0.8fr)_5rem_2.5rem] items-start gap-2.5 border-t border-border pt-3 first:border-t-0 first:pt-0 max-[1100px]:grid-cols-1">
              <Field label="Term" error={form.formState.errors.vocabulary?.[index]?.term?.message}>
                <Input {...form.register(`vocabulary.${index}.term`)} />
              </Field>
              <Field label="Pronunciation">
                <Input {...form.register(`vocabulary.${index}.pronunciation`)} />
              </Field>
              <Field label="Category">
                <Input {...form.register(`vocabulary.${index}.category`)} />
              </Field>
              <div className="pt-6 max-[1100px]:pt-0">
                <Controller
                  control={form.control}
                  name={`vocabulary.${index}.enabled`}
                  render={({ field }) => <Checkbox label="Enabled" checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
                />
              </div>
              <div className="pt-6 max-[1100px]:pt-0">
                <IconButton
                  title="Delete term"
                  onClick={() =>
                    form.setValue(
                      "vocabulary",
                      form.getValues("vocabulary").filter((candidate) => candidate.id !== entry.id),
                      { shouldDirty: true, shouldValidate: true }
                    )
                  }
                >
                  <Trash2 size={18} />
                </IconButton>
              </div>
              <Field label="Notes" className="col-span-full">
                <Textarea className="min-h-20" {...form.register(`vocabulary.${index}.notes`)} />
              </Field>
            </div>
          ))}
        </div>
      </Panel>
    </View>
  );
}
