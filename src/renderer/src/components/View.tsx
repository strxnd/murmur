import type { JSX, ReactNode } from "react";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";

interface ViewProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function View({ title, description, actions, children }: ViewProps): JSX.Element {
  const contentParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div className="studio-view min-h-screen bg-background">
      <header className="studio-view-header sticky top-0 z-20 flex min-h-20 items-center justify-between gap-4 border-b border-border bg-background px-7 py-5 max-[640px]:flex-col max-[640px]:items-start max-[640px]:px-4">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-4xl font-medium leading-none text-foreground max-[640px]:text-3xl">{title}</h1>
          {description && <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      <div ref={contentParent} className="studio-view-content flex flex-col gap-4 px-7 py-5 max-[640px]:px-4">
        {children}
      </div>
    </div>
  );
}
