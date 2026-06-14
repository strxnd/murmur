import { Input as BaseInput } from "@base-ui/react/input";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<ElementRef<typeof BaseInput>, ComponentPropsWithoutRef<typeof BaseInput>>(({ className, ...props }, ref) => (
  <BaseInput
    ref={ref}
    className={cn(
      "min-h-9 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-subtle focus:border-foreground/70 focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
