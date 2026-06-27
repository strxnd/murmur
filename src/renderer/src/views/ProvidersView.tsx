import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, KeyRound, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, useWatch, type Path, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { llmProviderConfigSchema, transcriptionProviderConfigSchema } from "../../../shared/schemas";
import type {
  AppStateSnapshot,
  LlmProviderConfig,
  ProviderValidationResult,
  SttStreamingMode,
  TranscriptionProviderConfig
} from "../../../shared/types";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { Select, type SelectItem } from "../components/ui/Select";
import { Switch } from "../components/ui/Switch";
import { makeClientId } from "../lib/ids";
import {
  applyCloudCredentialApiKey,
  applyLlmProviderType,
  applyTranscriptionProviderType,
  cloudCredentialApiKey,
  cloudCredentialConfigured,
  cloudCredentialProviders,
  cloudCredentialValidationProviders,
  cloneProvidersFormValues,
  createCustomLlmProvider,
  createCustomTranscriptionProvider,
  customLlmProviderTypes,
  customTranscriptionProviderTypes,
  hasProvidersFormChanges,
  isCloudCredentialLlmProvider,
  isCloudCredentialTranscriptionProvider,
  isDefaultLlmProvider,
  isDefaultTranscriptionProvider,
  llmProviderTypeLabel,
  normalizeProvidersFormValues,
  providersFormValuesFromState,
  transcriptionProviderTypeLabel,
  type CloudCredentialProviderId
} from "../lib/provider-form";
import { useMurmurStore } from "../state/murmur-store";

const providersFormSchema = z.object({
  transcriptionProviders: z.array(transcriptionProviderConfigSchema),
  llmProviders: z.array(llmProviderConfigSchema)
});

type ProvidersFormValues = z.infer<typeof providersFormSchema>;
type ProviderKind = "stt" | "llm";
type ValidationStatus = "validating" | "success" | "error";

interface ValidationState {
  status: ValidationStatus;
  message: string;
  capabilities?: ProviderValidationResult["capabilities"];
}

const promptAnimationMs = 180;

const sttTypeItems: Array<SelectItem<(typeof customTranscriptionProviderTypes)[number]>> = customTranscriptionProviderTypes.map((type) => ({
  value: type,
  label: transcriptionProviderTypeLabel(type)
}));

const llmTypeItems: Array<SelectItem<(typeof customLlmProviderTypes)[number]>> = customLlmProviderTypes.map((type) => ({
  value: type,
  label: llmProviderTypeLabel(type)
}));

const streamingModeItems: Array<SelectItem<SttStreamingMode>> = [
  { value: "none", label: "None" },
  { value: "completed_audio_sse", label: "Completed audio SSE" },
  { value: "live_realtime", label: "Live realtime" }
];

export function ProvidersView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const setSttProviders = useMurmurStore((store) => store.setSttProviders);
  const setLlmProviders = useMurmurStore((store) => store.setLlmProviders);
  const validateSttProvider = useMurmurStore((store) => store.validateSttProvider);
  const validateLlmProvider = useMurmurStore((store) => store.validateLlmProvider);
  const form = useForm<ProvidersFormValues>({
    resolver: zodResolver(providersFormSchema),
    defaultValues: providersFormValuesFromState({
      transcriptionProviders: state.transcriptionProviders,
      llmProviders: state.llmProviders
    })
  });
  const transcriptionProviders =
    useWatch({ control: form.control, name: "transcriptionProviders" }) ?? state.transcriptionProviders;
  const llmProviders = useWatch({ control: form.control, name: "llmProviders" }) ?? state.llmProviders;
  const persistedValuesRef = useRef<ProvidersFormValues>(
    providersFormValuesFromState({
      transcriptionProviders: state.transcriptionProviders,
      llmProviders: state.llmProviders
    })
  );
  const [validationByProvider, setValidationByProvider] = useState<Record<string, ValidationState>>({});
  const [cloudValidationByProvider, setCloudValidationByProvider] = useState<Partial<Record<CloudCredentialProviderId, ValidationState>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPromptMounted, setIsPromptMounted] = useState(false);
  const currentValues: ProvidersFormValues = {
    transcriptionProviders,
    llmProviders
  };
  const hasUnsavedChanges = hasProvidersFormChanges(currentValues, persistedValuesRef.current);

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
    const values = providersFormValuesFromState({
      transcriptionProviders: state.transcriptionProviders,
      llmProviders: state.llmProviders
    });
    persistedValuesRef.current = cloneProvidersFormValues(values);
    form.reset(values);
  }, [form, form.formState.isDirty, state.llmProviders, state.transcriptionProviders]);

  const saveChanges = useCallback(async (): Promise<void> => {
    setSaveError(null);

    const isValid = await form.trigger();
    if (!isValid) {
      setSaveError("Fix the highlighted provider fields before saving.");
      return;
    }

    const values = normalizeProvidersFormValues(form.getValues());
    const persistedValues = normalizeProvidersFormValues(persistedValuesRef.current);
    const shouldSaveStt = !sameValue(values.transcriptionProviders, persistedValues.transcriptionProviders);
    const shouldSaveLlm = !sameValue(values.llmProviders, persistedValues.llmProviders);

    if (!shouldSaveStt && !shouldSaveLlm) {
      form.reset(cloneProvidersFormValues(persistedValuesRef.current));
      return;
    }

    setIsSaving(true);

    try {
      if (shouldSaveStt) await setSttProviders(values.transcriptionProviders);
      if (shouldSaveLlm) await setLlmProviders(values.llmProviders);

      persistedValuesRef.current = cloneProvidersFormValues(values);
      form.reset(cloneProvidersFormValues(values));
    } catch (error) {
      setSaveError(`Could not save providers: ${errorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }, [form, setLlmProviders, setSttProviders]);

  const restoreSavedChanges = useCallback((): void => {
    setSaveError(null);
    setValidationByProvider({});
    setCloudValidationByProvider({});
    form.reset(cloneProvidersFormValues(persistedValuesRef.current));
  }, [form]);

  const addSttProvider = (): void => {
    form.setValue(
      "transcriptionProviders",
      [...form.getValues("transcriptionProviders"), createCustomTranscriptionProvider(makeClientId("stt_provider"))],
      { shouldDirty: true, shouldValidate: true }
    );
  };

  const addLlmProvider = (): void => {
    form.setValue("llmProviders", [...form.getValues("llmProviders"), createCustomLlmProvider(makeClientId("llm_provider"))], {
      shouldDirty: true,
      shouldValidate: true
    });
  };

  const deleteSttProvider = (providerId: string): void => {
    form.setValue(
      "transcriptionProviders",
      form.getValues("transcriptionProviders").filter((provider) => provider.id !== providerId),
      { shouldDirty: true, shouldValidate: true }
    );
    clearValidation(providerKey("stt", providerId), setValidationByProvider);
  };

  const deleteLlmProvider = (providerId: string): void => {
    form.setValue(
      "llmProviders",
      form.getValues("llmProviders").filter((provider) => provider.id !== providerId),
      { shouldDirty: true, shouldValidate: true }
    );
    clearValidation(providerKey("llm", providerId), setValidationByProvider);
  };

  const validateProvider = async (kind: ProviderKind, index: number): Promise<void> => {
    const values = form.getValues();
    const provider = kind === "stt" ? values.transcriptionProviders[index] : values.llmProviders[index];
    if (!provider) return;

    const key = providerKey(kind, provider.id);
    const path = (kind === "stt" ? `transcriptionProviders.${index}` : `llmProviders.${index}`) as Path<ProvidersFormValues>;
    const isValid = await form.trigger(path);
    if (!isValid) {
      setValidationByProvider((current) => ({
        ...current,
        [key]: { status: "error", message: "Fix the highlighted fields before validating." }
      }));
      return;
    }

    const normalizedValues = normalizeProvidersFormValues(form.getValues());
    const normalizedProvider =
      kind === "stt" ? normalizedValues.transcriptionProviders[index] : normalizedValues.llmProviders[index];

    setValidationByProvider((current) => ({
      ...current,
      [key]: { status: "validating", message: "Validating provider..." }
    }));

    try {
      const validation =
        kind === "stt"
          ? await validateSttProvider(normalizedProvider as TranscriptionProviderConfig)
          : await validateLlmProvider(normalizedProvider as LlmProviderConfig);
      setValidationByProvider((current) => ({
        ...current,
        [key]: {
          status: validation.ok ? "success" : "error",
          message: validation.message || (validation.ok ? "Provider validated." : "Provider validation failed."),
          capabilities: validation.capabilities
        }
      }));
    } catch (error) {
      setValidationByProvider((current) => ({
        ...current,
        [key]: { status: "error", message: errorMessage(error) }
      }));
    }
  };

  const updateCloudCredential = (providerId: CloudCredentialProviderId, apiKey: string): void => {
    const nextValues = applyCloudCredentialApiKey(form.getValues(), providerId, apiKey);
    form.setValue("transcriptionProviders", nextValues.transcriptionProviders, { shouldDirty: true, shouldValidate: true });
    form.setValue("llmProviders", nextValues.llmProviders, { shouldDirty: true, shouldValidate: true });
    setCloudValidationByProvider((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  };

  const validateCloudCredential = async (providerId: CloudCredentialProviderId): Promise<void> => {
    const providerName = cloudCredentialProviders.find((provider) => provider.id === providerId)?.name ?? "Cloud";
    const normalizedValues = normalizeProvidersFormValues(form.getValues());
    const apiKey = cloudCredentialApiKey(providerId, normalizedValues);

    if (!apiKey.trim()) {
      setCloudValidationByProvider((current) => ({
        ...current,
        [providerId]: { status: "error", message: `Enter a ${providerName} API key before validating.` }
      }));
      return;
    }

    const targets = cloudCredentialValidationProviders(providerId, normalizedValues);
    setCloudValidationByProvider((current) => ({
      ...current,
      [providerId]: { status: "validating", message: `Validating ${providerName} credentials...` }
    }));

    try {
      const results: ProviderValidationResult[] = [];
      for (const provider of targets.transcriptionProviders) {
        results.push(await validateSttProvider(provider));
      }
      for (const provider of targets.llmProviders) {
        results.push(await validateLlmProvider(provider));
      }

      const failed = results.find((result) => !result.ok);
      const capabilities = results.find((result) => result.capabilities)?.capabilities;
      setCloudValidationByProvider((current) => ({
        ...current,
        [providerId]: {
          status: failed ? "error" : "success",
          message: failed?.message || `${providerName} credentials validated.`,
          capabilities
        }
      }));
    } catch (error) {
      setCloudValidationByProvider((current) => ({
        ...current,
        [providerId]: { status: "error", message: errorMessage(error) }
      }));
    }
  };

  const advancedTranscriptionProviders = transcriptionProviders
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => !isDefaultTranscriptionProvider(provider) && !isCloudCredentialTranscriptionProvider(provider));
  const advancedLlmProviders = llmProviders
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => !isDefaultLlmProvider(provider) && !isCloudCredentialLlmProvider(provider));
  const hasAdvancedProviders = advancedTranscriptionProviders.length > 0 || advancedLlmProviders.length > 0;

  const unsavedChangesPrompt = isPromptMounted
    ? createPortal(
        <div className="pointer-events-none fixed bottom-4 left-[17rem] right-4 z-40 max-[980px]:left-4">
          <div
            data-state={hasUnsavedChanges ? "open" : "closed"}
            role="region"
            aria-label="Unsaved provider changes"
            className="configuration-unsaved-prompt pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-3 shadow-[var(--console-popover-shadow)] max-[760px]:flex-col max-[760px]:items-stretch"
          >
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-foreground">You have unsaved changes</p>
              <p className="m-0 mt-1 text-xs text-muted-foreground">Save your provider edits, or restore the last saved configuration.</p>
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
      <View title="Providers">
        <CloudCredentialsSection
          values={currentValues}
          validationByProvider={cloudValidationByProvider}
          onApiKeyChange={updateCloudCredential}
          onValidate={(providerId) => void validateCloudCredential(providerId)}
          onDismissValidation={(providerId) => {
            setCloudValidationByProvider((current) => {
              const next = { ...current };
              delete next[providerId];
              return next;
            });
          }}
        />

        <section className="flex flex-col gap-4 border-t border-border pt-4">
          <header className="flex items-center justify-between gap-3 max-[760px]:items-start">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-semibold text-foreground">Custom providers</h2>
              <p className="m-0 mt-1 text-xs text-muted-foreground">Custom provider records.</p>
            </div>
          </header>

          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button onClick={addSttProvider}>
                <Plus size={16} /> Add custom STT
              </Button>
              <Button onClick={addLlmProvider}>
                <Plus size={16} /> Add custom LLM
              </Button>
            </div>

            {!hasAdvancedProviders && (
              <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                No custom providers.
              </div>
            )}

            {advancedTranscriptionProviders.length > 0 && (
              <ProviderGroup title="Custom speech-to-text" actionLabel="Add custom STT provider" onAdd={addSttProvider}>
                {advancedTranscriptionProviders.map(({ provider, index }) => (
                  <TranscriptionProviderCard
                    key={provider.id}
                    form={form}
                    index={index}
                    provider={provider}
                    validation={validationByProvider[providerKey("stt", provider.id)]}
                    onValidate={() => void validateProvider("stt", index)}
                    onDismissValidation={() => clearValidation(providerKey("stt", provider.id), setValidationByProvider)}
                    onDelete={() => deleteSttProvider(provider.id)}
                  />
                ))}
              </ProviderGroup>
            )}

            {advancedLlmProviders.length > 0 && (
              <ProviderGroup title="Custom language models" actionLabel="Add custom LLM provider" onAdd={addLlmProvider}>
                {advancedLlmProviders.map(({ provider, index }) => (
                  <LlmProviderCard
                    key={provider.id}
                    form={form}
                    index={index}
                    provider={provider}
                    validation={validationByProvider[providerKey("llm", provider.id)]}
                    onValidate={() => void validateProvider("llm", index)}
                    onDismissValidation={() => clearValidation(providerKey("llm", provider.id), setValidationByProvider)}
                    onDelete={() => deleteLlmProvider(provider.id)}
                  />
                ))}
              </ProviderGroup>
            )}
          </div>
        </section>
      </View>
      {unsavedChangesPrompt}
    </>
  );
}

function CloudCredentialsSection({
  values,
  validationByProvider,
  onApiKeyChange,
  onValidate,
  onDismissValidation
}: {
  values: ProvidersFormValues;
  validationByProvider: Partial<Record<CloudCredentialProviderId, ValidationState>>;
  onApiKeyChange: (providerId: CloudCredentialProviderId, apiKey: string) => void;
  onValidate: (providerId: CloudCredentialProviderId) => void;
  onDismissValidation: (providerId: CloudCredentialProviderId) => void;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">Cloud credentials</h2>
          <p className="m-0 mt-1 text-xs text-muted-foreground">Curated API providers.</p>
        </div>
        <Badge tone="cloud">API key only</Badge>
      </header>

      <div className="divide-y divide-border rounded-md border border-border bg-surface">
        {cloudCredentialProviders.map((provider) => (
          <CloudCredentialRow
            key={provider.id}
            provider={provider}
            values={values}
            validation={validationByProvider[provider.id]}
            onApiKeyChange={onApiKeyChange}
            onValidate={onValidate}
            onDismissValidation={onDismissValidation}
          />
        ))}
      </div>
    </section>
  );
}

function CloudCredentialRow({
  provider,
  values,
  validation,
  onApiKeyChange,
  onValidate,
  onDismissValidation
}: {
  provider: (typeof cloudCredentialProviders)[number];
  values: ProvidersFormValues;
  validation?: ValidationState;
  onApiKeyChange: (providerId: CloudCredentialProviderId, apiKey: string) => void;
  onValidate: (providerId: CloudCredentialProviderId) => void;
  onDismissValidation: (providerId: CloudCredentialProviderId) => void;
}): JSX.Element {
  const apiKey = cloudCredentialApiKey(provider.id, values);
  const configured = cloudCredentialConfigured(provider.id, values);

  return (
    <div className="grid grid-cols-[minmax(10rem,13rem)_minmax(12rem,1fr)_auto] items-end gap-3 px-3 py-3 max-[760px]:grid-cols-1 max-[760px]:items-stretch">
      <div className="flex min-w-0 items-center gap-3 self-center">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-foreground">
          <KeyRound size={18} />
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-medium text-foreground">{provider.name}</p>
          <p className="m-0 mt-1 truncate text-xs text-muted-foreground">{provider.usage}</p>
        </div>
      </div>

      <Field label="API key">
        <Input
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${provider.name} API key`}
          placeholder="Enter API key"
          onChange={(event) => onApiKeyChange(provider.id, event.currentTarget.value)}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 max-[760px]:justify-between">
        <Badge tone={configured ? "success" : "neutral"}>{configured ? "Configured" : "Missing key"}</Badge>
        <Button size="sm" onClick={() => onValidate(provider.id)} disabled={validation?.status === "validating"}>
          <CheckCircle2 size={15} /> {validation?.status === "validating" ? "Validating..." : "Validate"}
        </Button>
      </div>

      {validation && (
        <div className="col-span-full">
          <ValidationMessage state={validation} onDismiss={() => onDismissValidation(provider.id)} />
        </div>
      )}
    </div>
  );
}

function ProviderGroup({
  title,
  actionLabel,
  onAdd,
  children
}: {
  title: string;
  actionLabel: string;
  onAdd: () => void;
  children: JSX.Element[];
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold text-foreground">{title}</h2>
        <IconButton title={actionLabel} onClick={onAdd}>
          <Plus size={17} />
        </IconButton>
      </header>
      <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-2">{children}</div>
    </section>
  );
}

function TranscriptionProviderCard({
  form,
  index,
  provider,
  validation,
  onValidate,
  onDismissValidation,
  onDelete
}: {
  form: UseFormReturn<ProvidersFormValues>;
  index: number;
  provider: TranscriptionProviderConfig;
  validation?: ValidationState;
  onValidate: () => void;
  onDismissValidation: () => void;
  onDelete: () => void;
}): JSX.Element {
  const isDefault = isDefaultTranscriptionProvider(provider);
  const canDelete = !isDefault;
  const isRuntimeProvider = provider.baseUrl.startsWith("murmur://runtime/") || provider.type === "sherpa_onnx";
  const errors = form.formState.errors.transcriptionProviders?.[index];

  return (
    <Panel
      title={provider.name || "Untitled STT provider"}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onValidate} disabled={validation?.status === "validating"}>
            <CheckCircle2 size={15} /> {validation?.status === "validating" ? "Validating..." : "Validate"}
          </Button>
          {canDelete && (
            <IconButton title="Delete provider" tone="danger" onClick={onDelete}>
              <Trash2 size={16} />
            </IconButton>
          )}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>{isDefault ? "Built-in" : "Custom"}</Badge>
        <Badge>{transcriptionProviderTypeLabel(provider.type)}</Badge>
        <Badge tone={provider.isCloud ? "cloud" : "local"}>{provider.isCloud ? "Cloud" : "Local"}</Badge>
        <Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
        <Controller
          control={form.control}
          name={`transcriptionProviders.${index}.enabled`}
          render={({ field }) => (
            <Switch
              className="col-span-full rounded-md border border-border bg-muted/30 px-3 py-2"
              label="Enabled"
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          )}
        />

        <Field label="Name" error={errors?.name?.message}>
          <Input {...form.register(`transcriptionProviders.${index}.name`)} />
        </Field>

        <Field label="Type" error={errors?.type?.message}>
          {isDefault ? (
            <Input value={transcriptionProviderTypeLabel(provider.type)} disabled readOnly />
          ) : (
            <Controller
              control={form.control}
              name={`transcriptionProviders.${index}.type`}
              render={({ field }) => (
                <Select
                  items={sttTypeItems}
                  value={field.value as (typeof customTranscriptionProviderTypes)[number]}
                  onValueChange={(value) => {
                    form.setValue(`transcriptionProviders.${index}`, applyTranscriptionProviderType(provider, value), {
                      shouldDirty: true,
                      shouldValidate: true
                    });
                  }}
                />
              )}
            />
          )}
        </Field>

        <Field label="Base URL" error={errors?.baseUrl?.message}>
          <Input
            {...form.register(`transcriptionProviders.${index}.baseUrl`)}
            disabled={isRuntimeProvider}
            readOnly={isRuntimeProvider}
            spellCheck={false}
          />
        </Field>

        <Field label="Endpoint path" error={errors?.endpointPath?.message}>
          <Input {...form.register(`transcriptionProviders.${index}.endpointPath`)} disabled={provider.type === "sherpa_onnx"} spellCheck={false} />
        </Field>

        <Field label="API key" error={errors?.apiKey?.message}>
          <Input type="password" autoComplete="off" spellCheck={false} {...form.register(`transcriptionProviders.${index}.apiKey`)} />
        </Field>

        <Field label="Model ID" error={errors?.defaultModel?.message}>
          <Input {...form.register(`transcriptionProviders.${index}.defaultModel`)} spellCheck={false} />
        </Field>

        <Field label="Language" error={errors?.defaultLanguage?.message}>
          <Input placeholder="auto" {...form.register(`transcriptionProviders.${index}.defaultLanguage`)} spellCheck={false} />
        </Field>

        <Field label="Streaming mode" error={errors?.streamingMode?.message}>
          <Controller
            control={form.control}
            name={`transcriptionProviders.${index}.streamingMode`}
            render={({ field }) => (
              <Select
                items={streamingModeItems}
                value={(field.value as SttStreamingMode | undefined) ?? "none"}
                onValueChange={field.onChange}
                disabled={provider.type === "whisper_cpp" || provider.type === "sherpa_onnx"}
              />
            )}
          />
        </Field>
      </div>

      <ValidationMessage state={validation} onDismiss={onDismissValidation} />
    </Panel>
  );
}

function LlmProviderCard({
  form,
  index,
  provider,
  validation,
  onValidate,
  onDismissValidation,
  onDelete
}: {
  form: UseFormReturn<ProvidersFormValues>;
  index: number;
  provider: LlmProviderConfig;
  validation?: ValidationState;
  onValidate: () => void;
  onDismissValidation: () => void;
  onDelete: () => void;
}): JSX.Element {
  const isDefault = isDefaultLlmProvider(provider);
  const canDelete = !isDefault;
  const errors = form.formState.errors.llmProviders?.[index];

  return (
    <Panel
      title={provider.name || "Untitled LLM provider"}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onValidate} disabled={validation?.status === "validating"}>
            <CheckCircle2 size={15} /> {validation?.status === "validating" ? "Validating..." : "Validate"}
          </Button>
          {canDelete && (
            <IconButton title="Delete provider" tone="danger" onClick={onDelete}>
              <Trash2 size={16} />
            </IconButton>
          )}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>{isDefault ? "Built-in" : "Custom"}</Badge>
        <Badge>{llmProviderTypeLabel(provider.type)}</Badge>
        <Badge tone={provider.isCloud ? "cloud" : "local"}>{provider.isCloud ? "Cloud" : "Local"}</Badge>
        <Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
        <Controller
          control={form.control}
          name={`llmProviders.${index}.enabled`}
          render={({ field }) => (
            <Switch
              className="col-span-full rounded-md border border-border bg-muted/30 px-3 py-2"
              label="Enabled"
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          )}
        />

        <Field label="Name" error={errors?.name?.message}>
          <Input {...form.register(`llmProviders.${index}.name`)} />
        </Field>

        <Field label="Type" error={errors?.type?.message}>
          {isDefault ? (
            <Input value={llmProviderTypeLabel(provider.type)} disabled readOnly />
          ) : (
            <Controller
              control={form.control}
              name={`llmProviders.${index}.type`}
              render={({ field }) => (
                <Select
                  items={llmTypeItems}
                  value={field.value as (typeof customLlmProviderTypes)[number]}
                  onValueChange={(value) => {
                    form.setValue(`llmProviders.${index}`, applyLlmProviderType(provider, value), {
                      shouldDirty: true,
                      shouldValidate: true
                    });
                  }}
                />
              )}
            />
          )}
        </Field>

        <Field label="Base URL" error={errors?.baseUrl?.message}>
          <Input {...form.register(`llmProviders.${index}.baseUrl`)} spellCheck={false} />
        </Field>

        <Field label="API key" error={errors?.apiKey?.message}>
          <Input type="password" autoComplete="off" spellCheck={false} {...form.register(`llmProviders.${index}.apiKey`)} />
        </Field>

        <Field label="Model ID" error={errors?.defaultModel?.message} className="col-span-full max-[760px]:col-span-1">
          <Input {...form.register(`llmProviders.${index}.defaultModel`)} spellCheck={false} />
        </Field>
      </div>

      <ValidationMessage state={validation} onDismiss={onDismissValidation} />
    </Panel>
  );
}

function ValidationMessage({ state, onDismiss }: { state?: ValidationState; onDismiss?: () => void }): JSX.Element | null {
  if (!state) return null;

  const isSuccess = state.status === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertTriangle;
  const capabilityLabels = validationCapabilityLabels(state.capabilities);

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={isSuccess ? "m-0 flex items-center gap-2 text-foreground" : "m-0 flex items-center gap-2 text-danger"}>
            <Icon size={15} className="shrink-0" /> <span className="min-w-0">{state.message}</span>
          </p>
          {capabilityLabels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {capabilityLabels.map((label) => (
                <Badge key={label} tone="success">
                  {label}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
            aria-label="Dismiss message"
            title="Dismiss message"
            onClick={onDismiss}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function validationCapabilityLabels(capabilities: ProviderValidationResult["capabilities"]): string[] {
  if (!capabilities) return [];

  const labels: string[] = [];
  if (capabilities.fileTranscription) labels.push("File transcription");
  if (capabilities.completedAudioStreaming) labels.push("Completed audio SSE");
  if (capabilities.liveRealtimeStreaming) labels.push("Live realtime");
  if (capabilities.modelDiscovery) labels.push("Model discovery");
  return labels;
}

function clearValidation(key: string, setValidationByProvider: (updater: (current: Record<string, ValidationState>) => Record<string, ValidationState>) => void): void {
  setValidationByProvider((current) => {
    const next = { ...current };
    delete next[key];
    return next;
  });
}

function providerKey(kind: ProviderKind, providerId: string): string {
  return `${kind}:${providerId}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
