import { Dialog } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Cable, CheckCircle2, ChevronRight, KeyRound, MessageSquare, Mic, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, useWatch, type Path, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { llmProviderConfigSchema, transcriptionProviderConfigSchema } from "../../../shared/schemas";
import type {
  AppStateSnapshot,
  CodexProviderRuntime,
  LlmProviderConfig,
  ProviderValidationResult,
  SttStreamingMode,
  TranscriptionProviderConfig
} from "../../../shared/types";
import { CodexMark } from "../components/CodexMark";
import { View } from "../components/View";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Select, type SelectItem } from "../components/ui/Select";
import { Switch } from "../components/ui/Switch";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { cn } from "../lib/cn";
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
  hasCloudCredentialChanges,
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
type ProviderDialogTarget = { kind: ProviderKind; id: string };
type CustomProviderEntry =
  | { kind: "stt"; provider: TranscriptionProviderConfig; index: number }
  | { kind: "llm"; provider: LlmProviderConfig; index: number };
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
  { value: "completed_audio_sse", label: "Stream completed audio" },
  { value: "live_realtime", label: "Live transcription" }
];

export function ProvidersView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const setSttProviders = useMurmurStore((store) => store.setSttProviders);
  const setLlmProviders = useMurmurStore((store) => store.setLlmProviders);
  const validateSttProvider = useMurmurStore((store) => store.validateSttProvider);
  const validateLlmProvider = useMurmurStore((store) => store.validateLlmProvider);
  const refreshCodex = useMurmurStore((store) => store.refreshCodex);
  const startCodexLogin = useMurmurStore((store) => store.startCodexLogin);
  const cancelCodexLogin = useMurmurStore((store) => store.cancelCodexLogin);
  const logoutCodex = useMurmurStore((store) => store.logoutCodex);
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
  const [openProvider, setOpenProvider] = useState<ProviderDialogTarget | null>(null);
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const advancedBodyId = useId();
  const customProviderListParent = useAutoAnimateRef<HTMLDivElement>();
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
    const next = createCustomTranscriptionProvider(makeClientId("stt_provider"));
    setIsAdvancedOpen(true);
    form.setValue(
      "transcriptionProviders",
      [...form.getValues("transcriptionProviders"), next],
      { shouldDirty: true, shouldValidate: true }
    );
    setOpenProvider({ kind: "stt", id: next.id });
    setIsProviderDialogOpen(true);
  };

  const addLlmProvider = (): void => {
    const next = createCustomLlmProvider(makeClientId("llm_provider"));
    setIsAdvancedOpen(true);
    form.setValue("llmProviders", [...form.getValues("llmProviders"), next], {
      shouldDirty: true,
      shouldValidate: true
    });
    setOpenProvider({ kind: "llm", id: next.id });
    setIsProviderDialogOpen(true);
  };

  const closeProviderPopup = (): void => {
    setIsProviderDialogOpen(false);
  };

  const deleteSttProvider = (providerId: string): void => {
    form.setValue(
      "transcriptionProviders",
      form.getValues("transcriptionProviders").filter((provider) => provider.id !== providerId),
      { shouldDirty: true, shouldValidate: true }
    );
    clearValidation(providerKey("stt", providerId), setValidationByProvider);
    if (openProvider?.kind === "stt" && openProvider.id === providerId) closeProviderPopup();
  };

  const deleteLlmProvider = (providerId: string): void => {
    form.setValue(
      "llmProviders",
      form.getValues("llmProviders").filter((provider) => provider.id !== providerId),
      { shouldDirty: true, shouldValidate: true }
    );
    clearValidation(providerKey("llm", providerId), setValidationByProvider);
    if (openProvider?.kind === "llm" && openProvider.id === providerId) closeProviderPopup();
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
        [key]: { status: "error", message: "Fix the highlighted fields before testing." }
      }));
      return;
    }

    const normalizedValues = normalizeProvidersFormValues(form.getValues());
    const normalizedProvider =
      kind === "stt" ? normalizedValues.transcriptionProviders[index] : normalizedValues.llmProviders[index];

    setValidationByProvider((current) => ({
      ...current,
      [key]: { status: "validating", message: "Testing provider..." }
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
          message: validation.message || (validation.ok ? "Provider tested." : "Provider test failed."),
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
        [providerId]: { status: "error", message: `Enter an API key for ${providerName} before testing.` }
      }));
      return;
    }

    const targets = cloudCredentialValidationProviders(providerId, normalizedValues);
    setCloudValidationByProvider((current) => ({
      ...current,
      [providerId]: { status: "validating", message: `Testing ${providerName} key...` }
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
          message: failed?.message || `${providerName} key tested.`,
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
  const customProviders: CustomProviderEntry[] = [
    ...advancedTranscriptionProviders.map(({ provider, index }) => ({ kind: "stt" as const, provider, index })),
    ...advancedLlmProviders.map(({ provider, index }) => ({ kind: "llm" as const, provider, index }))
  ];
  const openProviderEntry = openProvider
    ? customProviders.find((entry) => entry.kind === openProvider.kind && entry.provider.id === openProvider.id)
    : undefined;
  const providerDialogOpen = isProviderDialogOpen && Boolean(openProviderEntry);

  const unsavedChangesPrompt = isPromptMounted
    ? createPortal(
        <div className="pointer-events-none fixed bottom-24 left-4 right-4 z-40">
          <div
            data-state={hasUnsavedChanges ? "open" : "closed"}
            role="region"
            aria-label="Unsaved provider changes"
            className="configuration-unsaved-prompt pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-[15px] border border-border bg-surface-raised/95 px-4 py-3 shadow-[var(--studio-float-shadow)] backdrop-blur-xl max-[760px]:flex-col max-[760px]:items-stretch"
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
      <View title="Providers" description="Connect cloud services or custom endpoints for transcription and language models.">
        <CodexSubscriptionSection
          runtime={state.providerRuntime.codex}
          onRefresh={() => void refreshCodex().catch(() => undefined)}
          onConnect={() => void startCodexLogin().catch(() => undefined)}
          onCancel={() => void cancelCodexLogin().catch(() => undefined)}
          onDisconnect={() => void logoutCodex().catch(() => undefined)}
        />

        <CloudCredentialsSection
          values={currentValues}
          persistedValues={persistedValuesRef.current}
          validationByProvider={cloudValidationByProvider}
          canSaveKey={(providerId) => hasPendingCloudCredentialKey(providerId, currentValues, persistedValuesRef.current)}
          isSaving={isSaving}
          onApiKeyChange={updateCloudCredential}
          onValidate={(providerId) => void validateCloudCredential(providerId)}
          onSaveKey={() => void saveChanges()}
          onDismissValidation={(providerId) => {
            setCloudValidationByProvider((current) => {
              const next = { ...current };
              delete next[providerId];
              return next;
            });
          }}
        />

        <section className="provider-advanced-section" data-open={isAdvancedOpen || undefined}>
          <header className="provider-advanced-header">
            <button
              type="button"
              className="provider-advanced-toggle"
              aria-expanded={isAdvancedOpen}
              aria-controls={isAdvancedOpen ? advancedBodyId : undefined}
              onClick={() => setIsAdvancedOpen((open) => !open)}
            >
              <span className="provider-advanced-glyph" aria-hidden="true">
                <Cable size={18} />
              </span>
              <span className="provider-advanced-copy">
                <span>Custom providers</span>
                <small>Connect private, local, or OpenAI-compatible endpoints.</small>
              </span>
              {customProviders.length > 0 && <Badge>{customProviders.length}</Badge>}
              <ChevronRight
                size={16}
                className={cn("provider-row-chevron shrink-0 text-muted-foreground", isAdvancedOpen && "rotate-90 text-foreground")}
              />
            </button>
            {isAdvancedOpen && customProviders.length > 0 && (
              <div className="provider-advanced-actions">
                <Button size="sm" onClick={addSttProvider}>
                  <Plus size={15} /> Speech endpoint
                </Button>
                <Button size="sm" onClick={addLlmProvider}>
                  <Plus size={15} /> Language endpoint
                </Button>
              </div>
            )}
          </header>

          {isAdvancedOpen && (
            <div id={advancedBodyId} ref={customProviderListParent} className="provider-advanced-body">
              {customProviders.length === 0 ? (
                <div className="provider-advanced-empty">
                  <div className="provider-advanced-empty-copy">
                    <p>Bring your own endpoint</p>
                    <span>Add a speech service or language model server. You can test the connection before saving.</span>
                  </div>
                  <div className="provider-advanced-empty-actions">
                    <button type="button" onClick={addSttProvider}>
                      <ProviderGlyph kind="stt" />
                      <span><strong>Speech endpoint</strong><small>Transcribe recorded audio</small></span>
                      <Plus size={16} />
                    </button>
                    <button type="button" onClick={addLlmProvider}>
                      <ProviderGlyph kind="llm" />
                      <span><strong>Language endpoint</strong><small>Rewrite and refine text</small></span>
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="provider-advanced-list">
                  {customProviders.map((entry) => (
                    <CustomProviderRow
                      key={`${entry.kind}:${entry.provider.id}`}
                      entry={entry}
                      active={openProvider?.kind === entry.kind && openProvider.id === entry.provider.id}
                      onOpen={() => {
                        setOpenProvider({ kind: entry.kind, id: entry.provider.id });
                        setIsProviderDialogOpen(true);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </View>
      <Dialog.Root
        open={providerDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsProviderDialogOpen(true);
          } else {
            closeProviderPopup();
          }
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setOpenProvider(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="mode-dialog-backdrop fixed inset-0 z-40 bg-black/50" />
          <Dialog.Popup
            className="provider-editor-dialog mode-dialog-popup fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-3rem)] overflow-y-auto border border-border bg-surface-raised text-sm text-foreground shadow-[var(--console-dialog-shadow)] outline-none"
            style={{ width: "min(48rem, calc(100vw - 2rem))" }}
          >
            {openProviderEntry && (
              <CustomProviderEditor
                entry={openProviderEntry}
                form={form}
                validation={validationByProvider[providerKey(openProviderEntry.kind, openProviderEntry.provider.id)]}
                onValidate={() => void validateProvider(openProviderEntry.kind, openProviderEntry.index)}
                onDismissValidation={() => clearValidation(providerKey(openProviderEntry.kind, openProviderEntry.provider.id), setValidationByProvider)}
                onDelete={() =>
                  openProviderEntry.kind === "stt"
                    ? deleteSttProvider(openProviderEntry.provider.id)
                    : deleteLlmProvider(openProviderEntry.provider.id)
                }
                onClose={closeProviderPopup}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {unsavedChangesPrompt}
    </>
  );
}

function CodexSubscriptionSection({
  runtime,
  onRefresh,
  onConnect,
  onCancel,
  onDisconnect
}: {
  runtime: CodexProviderRuntime;
  onRefresh: () => void;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  const connected = runtime.status === "connected";
  const busy = runtime.status === "checking" || runtime.status === "signing_in";
  const statusLabel = codexStatusLabel(runtime);
  const statusTone = connected && runtime.modelAvailable ? "success" : runtime.status === "error" ? "danger" : busy ? "cloud" : "warning";
  const accountLabelIsEmail = runtime.accountLabel?.includes("@") ?? false;
  const [accountLabelVisible, setAccountLabelVisible] = useState(false);

  useEffect(() => {
    setAccountLabelVisible(false);
  }, [runtime.accountLabel]);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">Subscription connections</h2>
          <p className="m-0 mt-1 text-xs text-muted-foreground">Connect your ChatGPT subscription directly with Murmur-owned OAuth credentials.</p>
        </div>
        <Badge tone="cloud">ChatGPT OAuth</Badge>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-border bg-surface px-3 py-3 max-[760px]:grid-cols-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#e0e0e0] bg-white">
            <CodexMark className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-medium text-foreground">Codex</p>
              <Badge tone={statusTone}>{statusLabel}</Badge>
            </div>
            <p className="m-0 mt-1 text-xs text-muted-foreground">{runtime.message}</p>
            {runtime.accountLabel && (
              <p className="m-0 mt-1 text-xs text-muted-foreground">
                {runtime.accountLabel && accountLabelIsEmail ? (
                  <button
                    type="button"
                    aria-label={accountLabelVisible ? "Hide Codex account email" : "Reveal Codex account email"}
                    aria-pressed={accountLabelVisible}
                    className="rounded-sm border-0 bg-transparent p-0 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                    title={accountLabelVisible ? "Hide email" : "Reveal email"}
                    onClick={() => setAccountLabelVisible((visible) => !visible)}
                  >
                    <span aria-hidden="true" className={cn("inline-block transition-[filter]", !accountLabelVisible && "select-none blur-[5px]")}>
                      {runtime.accountLabel}
                    </span>
                  </button>
                ) : (
                  runtime.accountLabel
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 max-[760px]:justify-start">
          {runtime.status === "signing_in" ? (
            <Button size="sm" variant="secondary" onClick={onCancel}>
              <X size={15} /> Cancel
            </Button>
          ) : runtime.status === "signed_out" ? (
            <Button size="sm" variant="primary" onClick={onConnect}>
              <Cable size={15} /> Connect
            </Button>
          ) : connected ? (
            <Dialog.Root>
              <Dialog.Trigger render={<Button size="sm" variant="secondary" />}>
                <X size={15} /> Disconnect
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
                <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                  <Dialog.Title className="m-0 text-base font-semibold text-foreground">Disconnect Codex?</Dialog.Title>
                  <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                    This removes Murmur's Codex credentials. It does not sign you out of Codex CLI, VS Code, or other applications.
                  </Dialog.Description>
                  <div className="mt-5 flex justify-end gap-2">
                    <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
                    <Dialog.Close onClick={onDisconnect} render={<Button variant="danger" />}>Disconnect</Dialog.Close>
                  </div>
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
          ) : null}
          {runtime.status !== "signing_in" && (
            <Button size="sm" onClick={onRefresh} disabled={runtime.status === "checking"}>
              <RotateCcw size={15} /> {runtime.status === "checking" ? "Checking..." : "Refresh"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function codexStatusLabel(runtime: CodexProviderRuntime): string {
  if (runtime.status === "checking") return "Checking";
  if (runtime.status === "unavailable") return "Unavailable";
  if (runtime.status === "signed_out") return "Signed out";
  if (runtime.status === "signing_in") return "Signing in";
  if (runtime.status === "error") return "Error";
  return runtime.modelAvailable ? "Ready" : "Model unavailable";
}

function CloudCredentialsSection({
  values,
  persistedValues,
  validationByProvider,
  canSaveKey,
  isSaving,
  onApiKeyChange,
  onValidate,
  onSaveKey,
  onDismissValidation
}: {
  values: ProvidersFormValues;
  persistedValues: ProvidersFormValues;
  validationByProvider: Partial<Record<CloudCredentialProviderId, ValidationState>>;
  canSaveKey: (providerId: CloudCredentialProviderId) => boolean;
  isSaving: boolean;
  onApiKeyChange: (providerId: CloudCredentialProviderId, apiKey: string) => void;
  onValidate: (providerId: CloudCredentialProviderId) => void;
  onSaveKey: () => void;
  onDismissValidation: (providerId: CloudCredentialProviderId) => void;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">Cloud credentials</h2>
          <p className="m-0 mt-1 text-xs text-muted-foreground">Save one API key for each cloud service you want Murmur to use.</p>
        </div>
        <Badge tone="cloud">API key only</Badge>
      </header>

      <div className="divide-y divide-border rounded-md border border-border bg-surface">
        {cloudCredentialProviders.map((provider) => (
          <CloudCredentialRow
            key={provider.id}
            provider={provider}
            values={values}
            persistedValues={persistedValues}
            validation={validationByProvider[provider.id]}
            canSaveKey={canSaveKey(provider.id)}
            isSaving={isSaving}
            onApiKeyChange={onApiKeyChange}
            onValidate={onValidate}
            onSaveKey={onSaveKey}
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
  persistedValues,
  validation,
  canSaveKey,
  isSaving,
  onApiKeyChange,
  onValidate,
  onSaveKey,
  onDismissValidation
}: {
  provider: (typeof cloudCredentialProviders)[number];
  values: ProvidersFormValues;
  persistedValues: ProvidersFormValues;
  validation?: ValidationState;
  canSaveKey: boolean;
  isSaving: boolean;
  onApiKeyChange: (providerId: CloudCredentialProviderId, apiKey: string) => void;
  onValidate: (providerId: CloudCredentialProviderId) => void;
  onSaveKey: () => void;
  onDismissValidation: (providerId: CloudCredentialProviderId) => void;
}): JSX.Element {
  const apiKey = cloudCredentialApiKey(provider.id, values);
  const configured = cloudCredentialConfigured(provider.id, persistedValues);
  const currentConfigured = cloudCredentialConfigured(provider.id, values);
  const hasCredentialChanges = hasCloudCredentialChanges(provider.id, values, persistedValues);
  const badgeTone = hasCredentialChanges ? "warning" : configured ? "success" : "neutral";
  const badgeLabel = hasCredentialChanges ? (currentConfigured ? "Unsaved key" : "Unsaved removal") : configured ? "Configured" : "Missing key";
  const showSaveKeyAction = canSaveKey && validation?.status === "success";

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

      <Field label="API key" description="Keys are stored locally on this device.">
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
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
        <Button size="sm" onClick={() => onValidate(provider.id)} disabled={validation?.status === "validating"}>
          <CheckCircle2 size={15} /> {validation?.status === "validating" ? "Testing..." : "Test key"}
        </Button>
      </div>

      {validation && (
        <div className="col-span-full">
          <ValidationMessage
            state={validation}
            action={
              showSaveKeyAction
                ? {
                    label: isSaving ? "Saving..." : "Save key",
                    onClick: onSaveKey,
                    disabled: isSaving
                  }
                : undefined
            }
            onDismiss={() => onDismissValidation(provider.id)}
          />
        </div>
      )}
    </div>
  );
}

function CustomProviderRow({ entry, active, onOpen }: { entry: CustomProviderEntry; active: boolean; onOpen: () => void }): JSX.Element {
  const provider = entry.provider;

  return (
    <button
      type="button"
      className={cn(
        "provider-row grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left outline-none hover:bg-muted/70 focus-visible:bg-muted max-[760px]:grid-cols-[2.25rem_minmax(0,1fr)_1rem]",
        active && "bg-muted"
      )}
      aria-haspopup="dialog"
      aria-expanded={active}
      onClick={onOpen}
    >
      <ProviderGlyph kind={entry.kind} active={active} />
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{providerDisplayName(entry)}</span>
      </span>
      <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 max-[760px]:col-start-2 max-[760px]:col-end-4 max-[760px]:row-start-2 max-[760px]:justify-start">
        <Badge className="text-subtle">{providerKindLabel(entry.kind)}</Badge>
        <Badge className="text-subtle">{providerTypeLabel(entry)}</Badge>
        <Badge tone={provider.isCloud ? "cloud" : "local"}>{provider.isCloud ? "Cloud" : "Local"}</Badge>
        <Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "Enabled" : "Disabled"}</Badge>
      </span>
      <ChevronRight
        size={16}
        className={cn("provider-row-chevron text-muted-foreground max-[760px]:col-start-3 max-[760px]:row-start-1", active && "rotate-90 text-foreground")}
      />
    </button>
  );
}

function CustomProviderEditor({
  entry,
  form,
  validation,
  onValidate,
  onDismissValidation,
  onDelete,
  onClose
}: {
  entry: CustomProviderEntry;
  form: UseFormReturn<ProvidersFormValues>;
  validation?: ValidationState;
  onValidate: () => void;
  onDismissValidation: () => void;
  onDelete: () => void;
  onClose: () => void;
}): JSX.Element {
  const editorParent = useAutoAnimateRef<HTMLDivElement>();
  const validateButtonLabel = validation?.status === "validating" ? "Testing..." : providerValidationActionLabel(entry);

  return (
    <div ref={editorParent} className="provider-editor">
      <header className="provider-editor-header">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderGlyph kind={entry.kind} active />
          <div className="min-w-0">
            <Dialog.Title className="m-0 truncate text-base font-semibold text-foreground">{providerDisplayName(entry)}</Dialog.Title>
            <p className="m-0 truncate text-xs text-muted-foreground">{providerKindDetail(entry.kind)}</p>
          </div>
        </div>
        <div className="provider-editor-header-actions">
          <Button size="sm" onClick={onValidate} disabled={validation?.status === "validating"}>
            <CheckCircle2 size={15} /> {validateButtonLabel}
          </Button>
          <Dialog.Root>
            <Dialog.Trigger render={<IconButton title="Delete provider" tone="danger" />}>
              <Trash2 size={18} />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
              <Dialog.Popup className="fixed left-1/2 top-1/2 z-[80] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 shadow-[var(--console-dialog-shadow)] outline-none">
                <Dialog.Title className="m-0 text-base font-semibold text-foreground">Delete provider?</Dialog.Title>
                <Dialog.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                  This will remove {providerDisplayName(entry)} from custom providers. Save changes to persist the deletion.
                </Dialog.Description>
                <div className="mt-5 flex justify-end gap-2">
                  <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
                  <Dialog.Close onClick={onDelete} render={<Button variant="danger" />}>
                    Delete provider
                  </Dialog.Close>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </header>

      <div className="provider-editor-body">
        {entry.kind === "stt" ? (
          <TranscriptionProviderEditor
            form={form}
            index={entry.index}
            provider={entry.provider}
            validation={validation}
            onDismissValidation={onDismissValidation}
          />
        ) : (
          <LlmProviderEditor
            form={form}
            index={entry.index}
            provider={entry.provider}
            validation={validation}
            onDismissValidation={onDismissValidation}
          />
        )}
      </div>
    </div>
  );
}

function TranscriptionProviderEditor({
  form,
  index,
  provider,
  validation,
  onDismissValidation
}: {
  form: UseFormReturn<ProvidersFormValues>;
  index: number;
  provider: TranscriptionProviderConfig;
  validation?: ValidationState;
  onDismissValidation: () => void;
}): JSX.Element {
  const isDefault = isDefaultTranscriptionProvider(provider);
  const isRuntimeProvider = provider.baseUrl.startsWith("murmur://runtime/") || provider.type === "sherpa_onnx";
  const errors = form.formState.errors.transcriptionProviders?.[index];

  return (
    <>
      <div className="provider-editor-meta">
        <Badge>{isDefault ? "Built-in" : "Custom"}</Badge>
        <Badge>{transcriptionProviderTypeLabel(provider.type)}</Badge>
        <Badge tone={provider.isCloud ? "cloud" : "local"}>{provider.isCloud ? "Cloud" : "Local"}</Badge>
        <Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      <div className="provider-editor-form">
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

        <Field label="API key" description="Keys are stored locally on this device." error={errors?.apiKey?.message}>
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
    </>
  );
}

function LlmProviderEditor({
  form,
  index,
  provider,
  validation,
  onDismissValidation
}: {
  form: UseFormReturn<ProvidersFormValues>;
  index: number;
  provider: LlmProviderConfig;
  validation?: ValidationState;
  onDismissValidation: () => void;
}): JSX.Element {
  const isDefault = isDefaultLlmProvider(provider);
  const errors = form.formState.errors.llmProviders?.[index];
  const models = provider.models ?? [];
  const apiKeyField = llmProviderApiKeyField(provider);

  const addModel = (): void => {
    form.setValue(`llmProviders.${index}.models`, [...models, ""], { shouldDirty: true, shouldValidate: true });
  };

  const deleteModel = (modelIndex: number): void => {
    form.setValue(
      `llmProviders.${index}.models`,
      models.filter((_model, currentIndex) => currentIndex !== modelIndex),
      { shouldDirty: true, shouldValidate: true }
    );
  };

  return (
    <>
      <div className="provider-editor-meta">
        <Badge>{isDefault ? "Built-in" : "Custom"}</Badge>
        <Badge>{llmProviderTypeLabel(provider.type)}</Badge>
        <Badge tone={provider.isCloud ? "cloud" : "local"}>{provider.isCloud ? "Cloud" : "Local"}</Badge>
        <Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      <div className="provider-editor-form">
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

        {apiKeyField && (
          <Field label={apiKeyField.label} description={apiKeyField.description} error={errors?.apiKey?.message}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={apiKeyField.placeholder}
              {...form.register(`llmProviders.${index}.apiKey`)}
            />
          </Field>
        )}

        {provider.type === "custom_openai_compatible" && (
          <div className="provider-editor-models">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-sm font-medium text-foreground">Models</p>
              <Button size="sm" onClick={addModel}>
                <Plus size={15} /> Add model
              </Button>
            </div>
            {models.length === 0 ? (
              <div className="flex min-h-16 items-center justify-center rounded-md border border-dashed border-border bg-surface/60 p-3 text-sm text-muted-foreground">
                No models added.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {models.map((_model, modelIndex) => (
                  <div key={modelIndex} className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-end gap-2">
                    <Field label={`Model ${modelIndex + 1}`}>
                      <Input
                        {...form.register(`llmProviders.${index}.models.${modelIndex}`)}
                        placeholder="Model ID"
                        spellCheck={false}
                      />
                    </Field>
                    <IconButton title="Remove model" tone="danger" onClick={() => deleteModel(modelIndex)}>
                      <Trash2 size={18} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ValidationMessage state={validation} onDismiss={onDismissValidation} />
    </>
  );
}

function ProviderGlyph({ kind, active = false }: { kind: ProviderKind; active?: boolean }): JSX.Element {
  const Icon = kind === "stt" ? Mic : MessageSquare;

  return (
    <span
      className={cn(
        "provider-glyph grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-foreground",
        active && "scale-105 border-foreground/40"
      )}
    >
      <Icon size={17} />
    </span>
  );
}

function providerDisplayName(entry: CustomProviderEntry): string {
  const fallback = entry.kind === "stt" ? "Untitled STT provider" : "Untitled LLM provider";
  return entry.provider.name || fallback;
}

function providerKindLabel(kind: ProviderKind): string {
  return kind === "stt" ? "Speech-to-text" : "Language model";
}

function providerKindDetail(kind: ProviderKind): string {
  return kind === "stt" ? "Custom speech-to-text provider" : "Custom language model provider";
}

function providerTypeLabel(entry: CustomProviderEntry): string {
  return entry.kind === "stt" ? transcriptionProviderTypeLabel(entry.provider.type) : llmProviderTypeLabel(entry.provider.type);
}

function providerValidationActionLabel(entry: CustomProviderEntry): string {
  if (entry.kind === "llm" && isLocalConnectionLlmType(entry.provider.type)) return "Test connection";
  return "Test key";
}

function isLocalConnectionLlmType(type: LlmProviderConfig["type"]): boolean {
  return type === "ollama" || type === "lmstudio";
}

function llmProviderApiKeyField(
  provider: LlmProviderConfig
): { label: string; description: string; placeholder: string } | null {
  if (provider.type === "ollama") return null;
  if (provider.type === "lmstudio") {
    return {
      label: "API key (optional)",
      description: "Optional. Stored locally if set and sent as a bearer token to LM Studio.",
      placeholder: "Optional bearer token"
    };
  }
  return {
    label: "API key",
    description: "Keys are stored locally on this device.",
    placeholder: "Enter API key"
  };
}

function hasPendingCloudCredentialKey(
  providerId: CloudCredentialProviderId,
  values: ProvidersFormValues,
  persistedValues: ProvidersFormValues
): boolean {
  const apiKey = cloudCredentialApiKey(providerId, values).trim();
  if (!apiKey) return false;
  return apiKey !== cloudCredentialApiKey(providerId, persistedValues).trim();
}

function ValidationMessage({
  state,
  action,
  onDismiss
}: {
  state?: ValidationState;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onDismiss?: () => void;
}): JSX.Element | null {
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
        <div className="flex shrink-0 items-center gap-2">
          {action && (
            <Button size="sm" variant="primary" onClick={action.onClick} disabled={action.disabled}>
              <Save size={14} /> {action.label}
            </Button>
          )}
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
    </div>
  );
}

function validationCapabilityLabels(capabilities: ProviderValidationResult["capabilities"]): string[] {
  if (!capabilities) return [];

  const labels: string[] = [];
  if (capabilities.fileTranscription) labels.push("File transcription");
  if (capabilities.completedAudioStreaming) labels.push("Streaming transcription");
  if (capabilities.liveRealtimeStreaming) labels.push("Live transcription");
  if (capabilities.modelDiscovery) labels.push("Model list");
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
