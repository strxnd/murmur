import type { HTMLAttributes, JSX } from "react";
import { cn } from "../../lib/cn";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "success" | "warning" | "danger" | "cloud" | "local";
}

const tones: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-border bg-muted text-foreground",
  warning: "border-border bg-muted text-muted-foreground",
  danger: "border-border bg-muted text-foreground",
  cloud: "border-border bg-muted text-muted-foreground",
  local: "border-border bg-muted text-foreground"
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn("inline-flex items-center rounded border px-1.5 py-1 text-[11px] font-medium leading-none", tones[tone], className)}
      {...props}
    />
  );
}
