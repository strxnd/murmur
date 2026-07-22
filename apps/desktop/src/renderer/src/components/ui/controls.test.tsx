import { Children, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog, dialogContentClassName, dialogOverlayClassName } from "./Dialog";
import { Field } from "./Field";
import { Input } from "./Input";
import { ProgressBar } from "./ProgressBar";
import { Select, selectContentClassName } from "./Select";
import { Toolbar } from "./Toolbar";

type InspectableElement = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

function elementChildren(element: InspectableElement): InspectableElement[] {
  return Children.toArray(element.props.children) as InspectableElement[];
}

describe("renderer controls", () => {
  it("defaults buttons to the non-submitting button type", () => {
    const markup = renderToStaticMarkup(<Button>Save</Button>);

    expect(markup).toContain('type="button"');
  });

  it("associates field labels and descriptions with native controls", () => {
    const markup = renderToStaticMarkup(
      <Field label="Name" description="Shown publicly">
        <Input name="name" />
      </Field>
    );
    const controlId = markup.match(/<label for="([^"]+)"/)?.[1];

    expect(controlId).toBeTruthy();
    expect(markup).toContain(`id="${controlId}"`);
    expect(markup).toContain(`aria-describedby="${controlId}-description"`);
    expect(markup).toContain(`id="${controlId}-description"`);
  });

  it("replaces field descriptions with linked validation errors", () => {
    const markup = renderToStaticMarkup(
      <Field label="Name" description="Shown publicly" error="Name is required">
        <Input name="name" />
      </Field>
    );
    const controlId = markup.match(/<label for="([^"]+)"/)?.[1];

    expect(controlId).toBeTruthy();
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(`aria-describedby="${controlId}-error"`);
    expect(markup).toContain("Name is required");
    expect(markup).not.toContain("Shown publicly");
  });

  it("renders select placeholders for empty values", () => {
    const markup = renderToStaticMarkup(
      <Select items={[{ value: "ready", label: "Ready" }]} value="" onValueChange={() => undefined} placeholder="Choose one" />
    );

    expect(markup).toContain("Choose one");
    expect(markup).toContain("data-placeholder");
  });

  it("renders selected disabled select values without losing the selection", () => {
    const markup = renderToStaticMarkup(
      <Select
        items={[{ value: "missing", label: "Unavailable microphone", disabled: true }]}
        value="missing"
        onValueChange={() => undefined}
      />
    );

    expect(markup).toContain("Unavailable microphone");
    expect(markup).not.toContain("data-placeholder");
  });

  it("stacks portaled select content above dialogs", () => {
    expect(dialogOverlayClassName).toContain("z-[70]");
    expect(dialogContentClassName).toContain("z-[80]");
    expect(selectContentClassName).toContain("z-[90]");
  });

  it("renders composed dialog triggers, content, and close controls", () => {
    const markup = renderToStaticMarkup(
      <Dialog.Root defaultOpen>
        <Dialog.Trigger asChild>
          <Button>Open settings</Button>
        </Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>Settings</Dialog.Title>
          <Dialog.Description>Update the current settings.</Dialog.Description>
          <Dialog.Close asChild>
            <Button>Close</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Root>
    );

    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Update the current settings.");
    expect(markup).toContain(">Close</button>");
  });

  it("forwards controlled state and confirmation behavior", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const root = ConfirmDialog({
      open: true,
      onOpenChange,
      trigger: <Button>Delete</Button>,
      title: "Delete item?",
      description: "This cannot be undone.",
      confirmDisabled: true,
      onConfirm
    }) as InspectableElement;
    const [trigger, portal] = elementChildren(root);
    const [, content] = elementChildren(portal);
    const actions = elementChildren(content).at(-1);
    const [, action] = actions ? elementChildren(actions) : [];
    const [confirmButton] = action ? elementChildren(action) : [];

    expect(root.props.open).toBe(true);
    expect(trigger?.props.asChild).toBe(true);
    expect(action?.props.onClick).toBe(onConfirm);
    expect(confirmButton?.props.disabled).toBe(true);

    (root.props.onOpenChange as (open: boolean) => void)(false);
    (action?.props.onClick as (() => void) | undefined)?.();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("clamps determinate progress values", () => {
    const markup = renderToStaticMarkup(<ProgressBar value={125} label="Download" />);

    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain("width:100%");
  });

  it("uses a native layout container for toolbars", () => {
    const markup = renderToStaticMarkup(<Toolbar>Actions</Toolbar>);

    expect(markup.startsWith("<div")).toBe(true);
    expect(markup).not.toContain('role="toolbar"');
  });
});
