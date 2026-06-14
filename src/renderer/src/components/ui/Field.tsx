import { Field as BaseField } from "@base-ui/react/field";
import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

interface FieldProps {
  label?: string;
  description?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, description, error, className, children }: FieldProps): JSX.Element {
  return (
    <BaseField.Root invalid={Boolean(error)} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label && <BaseField.Label className="text-xs font-medium text-muted-foreground">{label}</BaseField.Label>}
      {children}
      {description && !error && <BaseField.Description className="text-[11px] text-subtle">{description}</BaseField.Description>}
      {error && (
        <BaseField.Error match className="text-[11px] text-danger">
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
