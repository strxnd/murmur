import { describe, expect, it } from "vitest";
import { ipcTextPayloadSchema, maxIpcTextCharacters, settingsUpdatePayloadSchema } from "./schemas";

describe("IPC payload schemas", () => {
  it("rejects unknown settings patch keys", () => {
    const result = settingsUpdatePayloadSchema.safeParse({
      theme: "dark",
      unknownSetting: true
    });

    expect(result.success).toBe(false);
  });

  it("accepts the acceleration runtime prompt dismissal setting", () => {
    const result = settingsUpdatePayloadSchema.safeParse({
      accelerationRuntimeInstallPromptDismissedAt: "2026-06-29T00:00:00.000Z"
    });

    expect(result.success).toBe(true);
  });

  it("rejects oversized text payloads", () => {
    expect(ipcTextPayloadSchema.safeParse("a".repeat(maxIpcTextCharacters)).success).toBe(true);
    expect(ipcTextPayloadSchema.safeParse("a".repeat(maxIpcTextCharacters + 1)).success).toBe(false);
  });
});
