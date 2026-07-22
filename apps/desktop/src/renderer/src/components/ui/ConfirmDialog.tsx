import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { dialogContentClassName, dialogOverlayClassName } from "./Dialog";

type AlertDialogRootProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Root>;
type AlertDialogActionProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>;
type AlertDialogPortalProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Portal>;

export interface ConfirmDialogProps extends Omit<AlertDialogRootProps, "children"> {
  trigger?: ReactElement;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm: NonNullable<AlertDialogActionProps["onClick"]>;
  confirmVariant?: "primary" | "danger";
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  portalContainer?: AlertDialogPortalProps["container"];
  overlayClassName?: string;
  contentClassName?: string;
  cancelClassName?: string;
  confirmClassName?: string;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  confirmVariant = "danger",
  confirmDisabled,
  cancelDisabled,
  portalContainer,
  overlayClassName,
  contentClassName,
  cancelClassName,
  confirmClassName,
  ...rootProps
}: ConfirmDialogProps): ReactElement {
  return (
    <AlertDialogPrimitive.Root {...rootProps}>
      {trigger && <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal container={portalContainer}>
        <AlertDialogPrimitive.Overlay className={cn(dialogOverlayClassName, overlayClassName)} />
        <AlertDialogPrimitive.Content className={cn(dialogContentClassName, contentClassName)}>
          <AlertDialogPrimitive.Title className="m-0 text-base font-semibold text-foreground">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" disabled={cancelDisabled} className={cancelClassName}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild onClick={onConfirm}>
              <Button variant={confirmVariant} disabled={confirmDisabled} className={confirmClassName}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
