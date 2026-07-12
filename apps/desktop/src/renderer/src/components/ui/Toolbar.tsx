import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import type { HTMLAttributes, JSX } from "react";
import { cn } from "../../lib/cn";

export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <BaseToolbar.Root className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}
