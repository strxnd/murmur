import { useEffect, useState } from "react";

export interface DownloadProgressSource {
  progressBytes: number;
  totalBytes?: number;
}

export interface DownloadProgressDetails {
  value: number | null;
  summary: string;
  detail: string;
  percent: string | null;
  remaining: string | null;
  eta: string | null;
}

interface DownloadObservation {
  startedAt: number;
  startedBytes: number;
  lastAt: number;
  lastBytes: number;
  bytesPerSecond?: number;
}

const observations = new Map<string, DownloadObservation>();

export function useDownloadProgressDetails(
  key: string,
  source: DownloadProgressSource | undefined,
  active: boolean
): DownloadProgressDetails {
  const [, setVersion] = useState(0);
  const progressBytes = source?.progressBytes ?? 0;
  const totalBytes = source?.totalBytes;

  useEffect(() => {
    if (!active || !source) {
      observations.delete(key);
      return;
    }

    recordObservation(key, progressBytes);
    setVersion((version) => version + 1);
  }, [active, key, progressBytes, totalBytes, source !== undefined]);

  return describeDownloadProgress(
    {
      progressBytes,
      totalBytes
    },
    observations.get(key)?.bytesPerSecond
  );
}

export function describeDownloadProgress(source: DownloadProgressSource, bytesPerSecond?: number): DownloadProgressDetails {
  const progressBytes = Math.max(0, source.progressBytes);
  const totalBytes = validTotalBytes(source.totalBytes);
  const value = downloadProgressValue(progressBytes, totalBytes);
  const summary = downloadProgressSummary({ progressBytes, totalBytes });

  if (!totalBytes) {
    return {
      value,
      summary,
      detail: `${formatBytes(progressBytes)} downloaded`,
      percent: null,
      remaining: null,
      eta: null
    };
  }

  const remainingBytes = Math.max(0, totalBytes - progressBytes);
  const percent = `${Math.floor(Math.min(100, (progressBytes / totalBytes) * 100))}% complete`;
  const remaining = `${formatBytes(remainingBytes)} left`;
  const eta = formatEta(remainingBytes, bytesPerSecond);
  const detailParts = [percent, `${formatBytes(progressBytes)} of ${formatBytes(totalBytes)}`, remaining];
  if (eta) detailParts.push(`${eta} remaining`);

  return {
    value,
    summary,
    detail: detailParts.join(" - "),
    percent,
    remaining,
    eta
  };
}

export function downloadProgressSummary(source: DownloadProgressSource | undefined): string {
  if (!source) return "Downloading";
  const progressBytes = Math.max(0, source.progressBytes);
  const totalBytes = validTotalBytes(source.totalBytes);
  if (!totalBytes) return `${formatBytes(progressBytes)} downloaded`;
  return `${formatBytes(progressBytes)} / ${formatBytes(totalBytes)}`;
}

export function downloadProgressValue(progressBytes: number, totalBytes: number | undefined): number | null {
  const validTotal = validTotalBytes(totalBytes);
  if (!validTotal) return null;
  return Math.max(4, Math.min(100, (Math.max(0, progressBytes) / validTotal) * 100));
}

export function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${Math.round(safeBytes)} B`;
  if (safeBytes < 1024 * 1024) return `${Math.round(safeBytes / 1024)} KB`;
  if (safeBytes < 1024 * 1024 * 1024) return `${Math.round(safeBytes / (1024 * 1024))} MB`;
  return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function recordObservation(key: string, progressBytes: number): void {
  const safeBytes = Math.max(0, progressBytes);
  const now = Date.now();
  const previous = observations.get(key);

  if (!previous || safeBytes < previous.lastBytes) {
    observations.set(key, {
      startedAt: now,
      startedBytes: safeBytes,
      lastAt: now,
      lastBytes: safeBytes
    });
    return;
  }

  if (safeBytes === previous.lastBytes) return;

  const elapsedSeconds = Math.max((now - previous.lastAt) / 1000, 0.001);
  const instantRate = (safeBytes - previous.lastBytes) / elapsedSeconds;
  const averageSeconds = Math.max((now - previous.startedAt) / 1000, 0.001);
  const averageRate = (safeBytes - previous.startedBytes) / averageSeconds;
  const bytesPerSecond = previous.bytesPerSecond
    ? previous.bytesPerSecond * 0.65 + instantRate * 0.35
    : averageRate || instantRate;

  observations.set(key, {
    ...previous,
    lastAt: now,
    lastBytes: safeBytes,
    bytesPerSecond
  });
}

function validTotalBytes(totalBytes: number | undefined): number | undefined {
  return totalBytes && Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined;
}

function formatEta(remainingBytes: number, bytesPerSecond: number | undefined): string | null {
  if (remainingBytes <= 0) return "0s";
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return formatDuration((remainingBytes / bytesPerSecond) * 1000);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return "1s";
  const seconds = Math.ceil(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
