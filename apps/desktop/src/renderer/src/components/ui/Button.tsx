import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  primary: "border-brand bg-brand text-background hover:border-brand-strong hover:bg-brand-strong",
  secondary: "border-border bg-surface-raised text-foreground hover:bg-muted",
  ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "border-danger/45 bg-danger/10 text-danger hover:border-danger/70 hover:bg-danger/15 focus-visible:ring-danger/30"
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-[34px] px-3 text-xs",
  md: "min-h-[38px] px-3.5 text-sm",
  icon: "h-[38px] w-[38px] p-0"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-[11px] border font-medium leading-none outline-none transition-[color,background-color,border-color,transform] active:translate-y-px focus-visible:ring-2 focus-visible:ring-foreground/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:translate-y-0 disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);

Button.displayName = "Button";
