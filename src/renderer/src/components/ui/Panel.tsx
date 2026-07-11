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
    <section className={cn("studio-panel min-w-0 overflow-hidden rounded-[15px] border border-border bg-surface", className)}>
      {(title || actions) && (
        <header className="studio-panel-header flex min-h-[46px] items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title && <h2 className="m-0 text-sm font-medium text-foreground">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="studio-panel-body p-4">{children}</div>
    </section>
  );
}
