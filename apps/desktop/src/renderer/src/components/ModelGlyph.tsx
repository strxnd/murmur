import { BrainCircuit, Mic } from "lucide-react";
import type { CSSProperties, JSX } from "react";
import type { ModelCatalogItem, ModelProvider } from "../../../shared/types";

export function ModelGlyph({ item }: { item: ModelCatalogItem }): JSX.Element {
  const ProviderIcon = providerIcon(item.provider);
  const FallbackIcon = item.kind === "language" ? BrainCircuit : Mic;

  return (
    <span
      className="model-glyph relative grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-foreground"
      style={modelGlyphStyle(item.provider)}
    >
      {ProviderIcon ? <ProviderIcon className="h-5 w-5" /> : <FallbackIcon size={17} />}
    </span>
  );
}

function modelGlyphStyle(provider: ModelProvider): CSSProperties {
  const styles: Partial<Record<ModelProvider, CSSProperties>> = {
    whisper_cpp: { "--model-glyph-bg": "#ffffff", "--model-glyph-border": "#e0e0e0", "--model-glyph-icon": "#111111" } as CSSProperties,
    nvidia: { "--model-glyph-bg": "#76b900", "--model-glyph-border": "#8bd000", "--model-glyph-icon": "#ffffff" } as CSSProperties,
    ollama: { "--model-glyph-bg": "#f7f7f2", "--model-glyph-border": "#d8d8cf", "--model-glyph-icon": "#111111" } as CSSProperties,
    lmstudio: { "--model-glyph-bg": "#101828", "--model-glyph-border": "#26364f", "--model-glyph-icon": "#ffffff" } as CSSProperties,
    openai: { "--model-glyph-bg": "#ffffff", "--model-glyph-border": "#e0e0e0", "--model-glyph-icon": "#111111" } as CSSProperties,
    openai_compatible: { "--model-glyph-bg": "#ffffff", "--model-glyph-border": "#e0e0e0", "--model-glyph-icon": "#111111" } as CSSProperties,
    anthropic: { "--model-glyph-bg": "#d97757", "--model-glyph-border": "#d97757", "--model-glyph-icon": "#ffffff" } as CSSProperties,
    google: { "--model-glyph-bg": "#ffffff", "--model-glyph-border": "#e0e0e0", "--model-glyph-icon": "#1f1f1f" } as CSSProperties
  };

  return styles[provider] ?? {};
}

type ProviderIcon = ({ className }: { className?: string }) => JSX.Element;

function providerIcon(provider: ModelProvider): ProviderIcon | null {
  if (provider === "openai" || provider === "openai_compatible" || provider === "whisper_cpp") return OpenAiMark;
  if (provider === "nvidia") return NvidiaMark;
  if (provider === "anthropic") return AnthropicMark;
  if (provider === "google") return GoogleMark;
  return null;
}

function OpenAiMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .511 4.91 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.429a4.476 4.476 0 0 1-2.876-1.041l.142-.08 4.778-2.759a.795.795 0 0 0 .393-.681V11.13l2.02 1.169a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494ZM3.599 18.304a4.471 4.471 0 0 1-.535-3.014l.142.085 4.783 2.758a.771.771 0 0 0 .781 0l5.843-3.368v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.499 4.499 0 0 1-6.141-1.646ZM2.341 7.896a4.485 4.485 0 0 1 2.365-1.973V11.6a.766.766 0 0 0 .388.677l5.814 3.354-2.02 1.169a.076.076 0 0 1-.071 0l-4.83-2.787A4.504 4.504 0 0 1 2.34 7.872Zm16.596 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.677a.79.79 0 0 0-.407-.667Zm2.011-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.499 4.499 0 0 1 6.681 4.66ZM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.499 4.499 0 0 1 7.375-3.454l-.142.081-4.778 2.758a.795.795 0 0 0-.393.681Zm1.098-2.365 2.602-1.5 2.607 1.5v2.999l-2.598 1.5-2.607-1.5Z" />
    </svg>
  );
}

function NvidiaMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936Z" />
    </svg>
  );
}

function AnthropicMark({ className }: { className?: string }): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M14.63 4.5 21 19.5h-3.33l-1.3-3.22H9.7L8.39 19.5H5.2L11.58 4.5h3.05Zm.61 8.98-2.2-5.45-2.2 5.45h4.4ZM5.84 4.5 12.2 19.5H9.02L2.65 4.5h3.19Z" /></svg>;
}

function GoogleMark({ className }: { className?: string }): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={className}><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" /><path fill="#FBBC05" d="M5.84 14.1a6.61 6.61 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z" /></svg>;
}
