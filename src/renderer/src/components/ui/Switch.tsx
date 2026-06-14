import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface SwitchProps extends Omit<ComponentPropsWithoutRef<typeof BaseSwitch.Root>, "children"> {
  label?: ReactNode;
  description?: ReactNode;
  rootClassName?: string;
}

export const Switch = forwardRef<ElementRef<typeof BaseSwitch.Root>, SwitchProps>(
  ({ className, rootClassName, label, description, ...props }, ref) => (
    <label className={cn("inline-flex min-w-0 items-center justify-between gap-3 text-sm text-foreground", className)}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block truncate leading-5">{label}</span>}
          {description && <span className="block text-xs leading-5 text-muted-foreground">{description}</span>}
        </span>
      )}
      <BaseSwitch.Root
        ref={ref}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border border-border bg-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/30 data-[checked]:bg-foreground data-[disabled]:opacity-50",
          rootClassName
        )}
        {...props}
      >
        <BaseSwitch.Thumb className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted-foreground transition-transform data-[checked]:translate-x-4 data-[checked]:bg-background" />
      </BaseSwitch.Root>
    </label>
  )
);

Switch.displayName = "Switch";
