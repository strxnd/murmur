import type { JSX, ReactNode } from "react";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";

interface ViewProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function View({ title, actions, children }: ViewProps): JSX.Element {
  const contentParent = useAutoAnimateRef<HTMLDivElement>();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-4 border-b border-border bg-background px-7 py-5 max-[640px]:flex-col max-[640px]:items-start max-[640px]:px-4">
        <h1 className="m-0 font-display text-4xl font-normal leading-none text-foreground max-[640px]:text-3xl">{title}</h1>
        {actions}
      </header>
      <div ref={contentParent} className="flex flex-col gap-4 px-7 py-5 max-[640px]:px-4">
        {children}
      </div>
    </div>
  );
}
