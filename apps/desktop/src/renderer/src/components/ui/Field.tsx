import { createContext, useContext, useId, type AriaAttributes, type JSX, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface FieldProps {
  label?: string;
  description?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

interface FieldContextValue {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
}

interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldControlProps({
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid
}: FieldControlProps): FieldControlProps {
  const field = useContext(FieldContext);
  if (!field) return { id, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid };

  return {
    id: id ?? field.controlId,
    "aria-describedby": mergeIds(ariaDescribedBy, field.describedBy),
    "aria-invalid": field.invalid ? true : ariaInvalid
  };
}

export function Field({ label, description, error, className, children }: FieldProps): JSX.Element {
  const generatedId = useId();
  const controlId = `field-${generatedId}`;
  const descriptionId = description && !error ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  return (
    <FieldContext.Provider value={{ controlId, describedBy: errorId ?? descriptionId, invalid: Boolean(error) }}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        {label && (
          <label htmlFor={controlId} className="text-xs font-medium text-muted-foreground">
            {label}
          </label>
        )}
        {children}
        {descriptionId && (
          <span id={descriptionId} className="text-[11px] text-subtle">
            {description}
          </span>
        )}
        {errorId && (
          <span id={errorId} className="text-[11px] text-danger">
            {error}
          </span>
        )}
      </div>
    </FieldContext.Provider>
  );
}

function mergeIds(...ids: Array<string | undefined>): string | undefined {
  const mergedIds = ids.filter(Boolean).join(" ");
  return mergedIds || undefined;
}
