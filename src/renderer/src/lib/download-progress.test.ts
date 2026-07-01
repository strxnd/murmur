import { describe, expect, it } from "vitest";
import { describeDownloadProgress, downloadProgressSummary, downloadProgressValue, formatBytes } from "./download-progress";

describe("download progress formatting", () => {
  it("summarizes known-size downloads with percent, bytes left, and ETA", () => {
    const details = describeDownloadProgress(
      {
        progressBytes: 50 * 1024 * 1024,
        totalBytes: 200 * 1024 * 1024
      },
      25 * 1024 * 1024
    );

    expect(details.value).toBe(25);
    expect(details.summary).toBe("50 MB / 200 MB");
    expect(details.detail).toBe("25% complete - 50 MB of 200 MB - 150 MB left - 6s remaining");
  });

  it("falls back to downloaded bytes for unknown-size downloads", () => {
    const details = describeDownloadProgress({ progressBytes: 1536 });

    expect(details.value).toBeNull();
    expect(details.summary).toBe("2 KB downloaded");
    expect(details.detail).toBe("2 KB downloaded");
  });

  it("clamps progress bar values while preserving readable byte labels", () => {
    expect(downloadProgressValue(0, 100)).toBe(4);
    expect(downloadProgressValue(250, 100)).toBe(100);
    expect(downloadProgressSummary({ progressBytes: 1024, totalBytes: 4096 })).toBe("1 KB / 4 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});
