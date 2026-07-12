import type { JSX } from "react";
import { useDownloadProgressDetails } from "../lib/download-progress";
import { cn } from "../lib/cn";
import { ProgressBar } from "./ui/ProgressBar";

interface DownloadProgressStatusProps {
  progressKey: string;
  progressBytes: number;
  totalBytes?: number;
  label: string;
  active?: boolean;
  className?: string;
  textClassName?: string;
}

export function DownloadProgressStatus({
  progressKey,
  progressBytes,
  totalBytes,
  label,
  active = true,
  className,
  textClassName
}: DownloadProgressStatusProps): JSX.Element {
  const details = useDownloadProgressDetails(progressKey, { progressBytes, totalBytes }, active);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ProgressBar value={details.value} label={label} />
      <p className={cn("m-0 break-words text-xs leading-5 text-muted-foreground", textClassName)}>{details.detail}</p>
    </div>
  );
}
