import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface CheckboxProps extends Omit<ComponentPropsWithoutRef<typeof BaseCheckbox.Root>, "children"> {
  label?: ReactNode;
  description?: ReactNode;
  rootClassName?: string;
}

export const Checkbox = forwardRef<ElementRef<typeof BaseCheckbox.Root>, CheckboxProps>(
  ({ className, rootClassName, label, description, ...props }, ref) => (
    <label className={cn("inline-flex min-w-0 items-start gap-2 text-sm text-foreground", className)}>
      <BaseCheckbox.Root
      ref={ref}
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-border bg-surface outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/30 data-[checked]:border-foreground data-[checked]:bg-foreground data-[disabled]:opacity-50",
          rootClassName
        )}
      {...props}
      >
        <BaseCheckbox.Indicator className="text-background">
          <Check size={12} strokeWidth={3} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block truncate leading-5">{label}</span>}
          {description && <span className="block text-xs leading-5 text-muted-foreground">{description}</span>}
        </span>
      )}
    </label>
  )
);

Checkbox.displayName = "Checkbox";
