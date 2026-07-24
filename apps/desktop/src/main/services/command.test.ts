import { describe, expect, it } from "vitest";
import { execFileText } from "./command";

describe("execFileText", () => {
  it("rejects contained stdin EPIPE failures instead of emitting an unhandled stream error", async () => {
    const childScript = "process.stdin.destroy(); setTimeout(() => process.exit(0), 100);";

    await expect(
      execFileText(process.execPath, ["-e", childScript], 1000, {
        input: "x".repeat(8 * 1024 * 1024)
      })
    ).rejects.toMatchObject({
      name: "ExecFileTextError",
      phase: "stdin"
    });
  });
});
