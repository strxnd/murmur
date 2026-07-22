import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { useFieldControlProps } from "./Field";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, id, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const fieldProps = useFieldControlProps({ id, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid });

    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-28 w-full resize-y rounded-[11px] border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-subtle focus:border-foreground/70 focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...fieldProps}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
