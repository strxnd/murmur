import type { JSX, ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PanelProps {
  title?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, actions, className, children }: PanelProps): JSX.Element {
  return (
    <section className={cn("rounded-md border border-border bg-surface p-4", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="m-0 text-sm font-medium text-foreground">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
