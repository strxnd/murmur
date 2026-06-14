import { Keyboard } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { keyboardEventToAccelerator } from "../lib/keyboard-shortcuts";
import { cn } from "../lib/cn";

interface ShortcutRecorderProps {
  value: string;
  onChange: (value: string) => void;
  onCaptureStart?: () => Promise<void> | void;
  onCaptureEnd?: () => Promise<void> | void;
  disabled?: boolean;
}

export function ShortcutRecorder({
  value,
  onChange,
  onCaptureStart,
  onCaptureEnd,
  disabled
}: ShortcutRecorderProps): JSX.Element {
  const [isRecording, setIsRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const isCaptureActive = useRef(false);
  const onCaptureStartRef = useRef(onCaptureStart);
  const onCaptureEndRef = useRef(onCaptureEnd);

  useEffect(() => {
    onCaptureStartRef.current = onCaptureStart;
  }, [onCaptureStart]);

  useEffect(() => {
    onCaptureEndRef.current = onCaptureEnd;
  }, [onCaptureEnd]);

  const stopCapture = useCallback(() => {
    setIsRecording(false);
    setPreview("");
    if (!isCaptureActive.current) return;
    isCaptureActive.current = false;
    void onCaptureEndRef.current?.();
  }, []);

  const startCapture = useCallback(() => {
    if (disabled || isCaptureActive.current) return;
    isCaptureActive.current = true;
    setIsRecording(true);
    setPreview("");
    void onCaptureStartRef.current?.();
  }, [disabled]);

  useEffect(() => {
    return () => {
      if (!isCaptureActive.current) return;
      isCaptureActive.current = false;
      void onCaptureEndRef.current?.();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      stopCapture();
      event.currentTarget.blur();
      return;
    }

    const shortcut = keyboardEventToAccelerator(event.nativeEvent);
    setPreview(shortcut.preview);

    if (!shortcut.accelerator) return;

    onChange(shortcut.accelerator);
    stopCapture();
    event.currentTarget.blur();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!isRecording) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={isRecording}
      aria-label={`Record shortcut. Current shortcut: ${value}`}
      title={isRecording ? "Press a shortcut" : "Record shortcut"}
      onBlur={stopCapture}
      onClick={startCapture}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-sm text-foreground outline-none transition-colors focus:border-foreground/70 focus:ring-2 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
        isRecording ? "border-foreground/70 bg-muted/40 ring-2 ring-foreground/20" : "hover:bg-muted/40"
      )}
    >
      <Keyboard size={15} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] leading-none">
        {isRecording ? preview || "Press keys..." : value}
      </span>
    </button>
  );
}
