import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SelectItem<TValue extends string = string> {
  value: TValue;
  label: ReactNode;
  disabled?: boolean;
}

interface SelectProps<TValue extends string = string> {
  items: Array<SelectItem<TValue>>;
  value: TValue;
  onValueChange: (value: TValue) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  name?: string;
  "aria-label"?: string;
  className?: string;
  portalContainer?: ComponentProps<typeof BaseSelect.Portal>["container"];
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

  return (
    <BaseSelect.Root<TValue>
      items={renderedItems}
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      disabled={disabled}
      name={name}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-sm text-foreground outline-none transition-colors focus-visible:border-foreground/70 focus-visible:ring-2 focus-visible:ring-foreground/20 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          !selectedItem && "data-[placeholder]:text-subtle",
          className
        )}
      >
        <BaseSelect.Value className="min-w-0 flex-1 truncate" placeholder={placeholder}>
          {selectedItem ? () => selectedItem.label : undefined}
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown size={16} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={portalContainer}>
        <BaseSelect.Positioner sideOffset={6} className={cn("z-50 outline-none", positionerClassName)}>
          <BaseSelect.Popup
            className={cn(
              "max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-border bg-surface-raised p-1 text-sm text-foreground shadow-[var(--console-listbox-shadow)] outline-none",
              popupClassName
            )}
          >
            <BaseSelect.List>
              {renderedItems.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className="grid min-h-8 cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded px-2 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted"
                >
                  <BaseSelect.ItemIndicator className="col-start-1 text-foreground">
                    <Check size={14} strokeWidth={2.5} />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2 min-w-0 truncate">{item.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

Select.displayName = "Select";
