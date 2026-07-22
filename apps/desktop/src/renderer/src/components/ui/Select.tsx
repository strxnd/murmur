import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useFieldControlProps } from "./Field";

export interface SelectItem<TValue extends string = string> {
  value: TValue;
  label: ReactNode;
  disabled?: boolean;
}

export const selectContentClassName =
  "z-[90] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[11px] border border-border bg-surface-raised text-sm text-foreground shadow-[var(--console-listbox-shadow)] outline-none";

interface SelectProps<TValue extends string = string> {
  items: Array<SelectItem<TValue>>;
  value: TValue;
  onValueChange: (value: TValue) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  name?: string;
  "aria-label"?: string;
  className?: string;
  portalContainer?: SelectPrimitive.SelectPortalProps["container"];
  positionerClassName?: string;
  popupClassName?: string;
}

export function Select<TValue extends string = string>({
  items,
  value,
  onValueChange,
  placeholder = "Select",
  disabled,
  name,
  "aria-label": ariaLabel,
  className,
  portalContainer,
  positionerClassName,
  popupClassName
}: SelectProps<TValue>): ReactNode {
  const renderedItems = items.map((item) => (item.value === value && item.disabled ? { ...item, disabled: false } : item));
  const selectedItem = renderedItems.find((item) => item.value === value);
  const fieldProps = useFieldControlProps({});

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex min-h-[38px] w-full items-center justify-between gap-2 rounded-[11px] border border-border bg-surface-raised px-3 py-2 text-left text-sm text-foreground outline-none transition-colors focus-visible:border-foreground/70 focus-visible:ring-2 focus-visible:ring-foreground/20 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[placeholder]:text-subtle",
          className
        )}
        {...fieldProps}
      >
        <SelectPrimitive.Value className="min-w-0 flex-1 truncate" placeholder={placeholder}>
          {selectedItem?.label}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer}>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          align="start"
          className={cn(selectContentClassName, positionerClassName, popupClassName)}
        >
          <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto p-1.5">
            {renderedItems.map((item) => (
              <SelectPrimitive.Item
                key={item.value}
                value={item.value}
                disabled={item.disabled}
                textValue={typeof item.label === "string" ? item.label : undefined}
                className="grid min-h-8 cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted"
              >
                <SelectPrimitive.ItemIndicator className="col-start-1 text-foreground">
                  <Check size={14} strokeWidth={2.5} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText className="col-start-2 min-w-0 truncate">{item.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

Select.displayName = "Select";
