import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { JSX } from "react";
import { cn } from "../../lib/cn";

interface ProgressBarProps {
  value: number | null;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps): JSX.Element {
  const boundedValue = value === null ? null : Math.max(0, Math.min(100, value));

  return (
    <ProgressPrimitive.Root value={boundedValue} aria-label={label} className={cn("w-full", className)}>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <ProgressPrimitive.Indicator
          className="h-full rounded-full bg-foreground transition-[width]"
          style={{ width: boundedValue === null ? "18%" : `${boundedValue}%` }}
        />
      </div>
    </ProgressPrimitive.Root>
  );
}
