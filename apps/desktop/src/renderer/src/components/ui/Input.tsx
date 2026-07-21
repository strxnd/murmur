import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { useFieldControlProps } from "./Field";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, id, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const fieldProps = useFieldControlProps({ id, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid });

    return (
      <input
        ref={ref}
        className={cn(
          "min-h-[38px] w-full rounded-[11px] border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-subtle focus:border-foreground/70 focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...fieldProps}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
