import type { JSX } from "react";

interface EmptyStateProps {
  title: string;
  detail?: string;
}

export function EmptyState({ title, detail }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {detail && <div className="mt-1 max-w-md text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
