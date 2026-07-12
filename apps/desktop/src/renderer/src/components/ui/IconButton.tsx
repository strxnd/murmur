import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

interface IconButtonProps extends Omit<ComponentPropsWithoutRef<typeof Button>, "size" | "variant"> {
  title: string;
  tone?: "default" | "danger";
}

export const IconButton = forwardRef<ElementRef<typeof Button>, IconButtonProps>(
  ({ className, tone = "default", title, "aria-label": ariaLabel, ...props }, ref) => (
    <Button
      ref={ref}
      size="icon"
      variant={tone === "danger" ? "danger" : "secondary"}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cn("rounded-md", className)}
      {...props}
    />
  )
);

IconButton.displayName = "IconButton";
