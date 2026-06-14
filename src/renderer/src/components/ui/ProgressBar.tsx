import { Progress } from "@base-ui/react/progress";
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
    <Progress.Root value={boundedValue} aria-label={label} className={cn("w-full", className)}>
      <Progress.Track className="h-2 overflow-hidden rounded-full bg-muted">
        <Progress.Indicator
          className="h-full rounded-full bg-foreground transition-[width]"
          style={{ width: boundedValue === null ? "18%" : `${boundedValue}%` }}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
