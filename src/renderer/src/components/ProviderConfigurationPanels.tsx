import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Save } from "lucide-react";
import { useEffect, useState, type JSX } from "react";
import { Controller, useForm, type Control, type Path } from "react-hook-form";
import { z } from "zod";
import type { AppStateSnapshot } from "../../../shared/types";
import { llmProviderConfigSchema, transcriptionProviderConfigSchema } from "../../../shared/schemas";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { useMurmurStore } from "../state/murmur-store";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { IconButton } from "./ui/IconButton";
import { Input } from "./ui/Input";
import { Panel } from "./ui/Panel";
import { Select, type SelectItem } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { Toolbar } from "./ui/Toolbar";
import { cn } from "../lib/cn";

const providerConfigurationFormSchema = z.object({
  sttProviders: z.array(transcriptionProviderConfigSchema),
  llmProviders: z.array(llmProviderConfigSchema)
});

type ProviderConfigurationFormValues = z.infer<typeof providerConfigurationFormSchema>;

const streamingModeItems: Array<SelectItem<ProviderConfigurationFormValues["sttProviders"][number]["streamingMode"]>> = [
  { value: "none", label: "Final only" },
  { value: "completed_audio_sse", label: "Completed audio SSE" },
  { value: "live_realtime", label: "Live realtime" }
];

export function ProviderConfigurationPanels({
  state,
  className
}: {
  state: AppStateSnapshot;
  className?: string;
}): JSX.Element {
  const setSttProviders = useMurmurStore((store) => store.setSttProviders);
  const setLlmProviders = useMurmurStore((store) => store.setLlmProviders);
  const validateSttProvider = useMurmurStore((store) => store.validateSttProvider);
  const validateLlmProvider = useMurmurStore((store) => store.validateLlmProvider);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const form = useForm<ProviderConfigurationFormValues>({
    resolver: zodResolver(providerConfigurationFormSchema),
    defaultValues: {
      sttProviders: state.transcriptionProviders,
      llmProviders: state.llmProviders
    }
  });
  const sttProviders = form.watch("sttProviders");
  const llmProviders = form.watch("llmProviders");
  const sttProvidersParent = useAutoAnimateRef<HTMLDivElement>();
  const llmProvidersParent = useAutoAnimateRef<HTMLDivElement>();

  useEffect(() => {
    form.reset({
      sttProviders: state.transcriptionProviders,
      llmProviders: state.llmProviders
    });
  }, [form, state.llmProviders, state.transcriptionProviders]);

  const save = form.handleSubmit(async (values) => {
    await setSttProviders(values.sttProviders);
    await setLlmProviders(values.llmProviders);
    form.reset(values);
  });

  return (
    <section id="provider-configuration" className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between gap-3 max-[640px]:flex-col max-[640px]:items-start">
        <h2 className="m-0 text-sm font-semibold text-foreground">Provider Configuration</h2>
        <Toolbar>
          <Button variant="primary" onClick={() => void save()} disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            <Save size={18} /> Save providers
          </Button>
        </Toolbar>
      </div>

      <Panel title="STT providers">
        <div ref={sttProvidersParent} className="flex flex-col gap-3">
          {sttProviders.map((provider, index) => (
            <div
              key={provider.id}
              className="grid grid-cols-[minmax(10rem,1.1fr)_4.5rem_repeat(5,minmax(8rem,1fr))_2.5rem] items-end gap-2.5 border-t border-border pt-3 first:border-t-0 first:pt-0 max-[1180px]:grid-cols-1"
            >
              <Field label="Provider">
                <div className="flex min-h-9 items-center gap-2">
                  <FormSwitch control={form.control} name={`sttProviders.${index}.enabled`} label={provider.name} compact />
                </div>
              </Field>
              <Badge tone={provider.isCloud ? "cloud" : "local"} className="mb-1 justify-self-start">
                {provider.isCloud ? "Cloud" : "Local"}
              </Badge>
              <Field label="Name" error={form.formState.errors.sttProviders?.[index]?.name?.message}>
                <Input {...form.register(`sttProviders.${index}.name`)} />
              </Field>
              <Field label="Base URL" error={form.formState.errors.sttProviders?.[index]?.baseUrl?.message}>
                <Input {...form.register(`sttProviders.${index}.baseUrl`)} />
              </Field>
              <Field label="Model">
                <Input {...form.register(`sttProviders.${index}.defaultModel`)} />
              </Field>
              <Field label="Language">
                <Input {...form.register(`sttProviders.${index}.defaultLanguage`)} placeholder="auto" />
              </Field>
              <Field label="API key">
                <Input type="password" {...form.register(`sttProviders.${index}.apiKey`)} />
              </Field>
              <Field label="Streaming">
                <FormSelect control={form.control} name={`sttProviders.${index}.streamingMode`} items={streamingModeItems} />
              </Field>
              <IconButton
                title="Validate"
                onClick={async () => {
                  const result = await validateSttProvider(form.getValues(`sttProviders.${index}`));
                  setValidation((current) => ({ ...current, [provider.id]: result.message }));
                }}
              >
                <Check size={18} />
              </IconButton>
              {validation[provider.id] && <div className="col-span-full text-xs text-muted-foreground">{validation[provider.id]}</div>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="LLM providers">
        <div ref={llmProvidersParent} className="flex flex-col gap-3">
          {llmProviders.map((provider, index) => (
            <div
              key={provider.id}
              className="grid grid-cols-[minmax(10rem,1.1fr)_4.5rem_repeat(4,minmax(8rem,1fr))_2.5rem] items-end gap-2.5 border-t border-border pt-3 first:border-t-0 first:pt-0 max-[1180px]:grid-cols-1"
            >
              <Field label="Provider">
                <div className="flex min-h-9 items-center gap-2">
                  <FormSwitch control={form.control} name={`llmProviders.${index}.enabled`} label={provider.name} compact />
                </div>
              </Field>
              <Badge tone={provider.isCloud ? "cloud" : "local"} className="mb-1 justify-self-start">
                {provider.isCloud ? "Cloud" : "Local"}
              </Badge>
              <Field label="Name" error={form.formState.errors.llmProviders?.[index]?.name?.message}>
                <Input {...form.register(`llmProviders.${index}.name`)} />
              </Field>
              <Field label="Base URL">
                <Input {...form.register(`llmProviders.${index}.baseUrl`)} />
              </Field>
              <Field label="Model">
                <Input {...form.register(`llmProviders.${index}.defaultModel`)} />
              </Field>
              <Field label="API key">
                <Input type="password" {...form.register(`llmProviders.${index}.apiKey`)} />
              </Field>
              <IconButton
                title="Validate"
                onClick={async () => {
                  const result = await validateLlmProvider(form.getValues(`llmProviders.${index}`));
                  setValidation((current) => ({ ...current, [provider.id]: result.message }));
                }}
              >
                <Check size={18} />
              </IconButton>
              {validation[provider.id] && <div className="col-span-full text-xs text-muted-foreground">{validation[provider.id]}</div>}
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function FormSelect({
  control,
  name,
  items,
  disabled
}: {
  control: Control<ProviderConfigurationFormValues>;
  name: Path<ProviderConfigurationFormValues>;
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

function FormSwitch({
  control,
  name,
  label,
  compact = false
}: {
  control: Control<ProviderConfigurationFormValues>;
  name: Path<ProviderConfigurationFormValues>;
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
