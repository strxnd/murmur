import { describe, expect, it } from "vitest";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform-support";

describe("platform support guard", () => {
  it("allows Linux and macOS", () => {
    expect(isSupportedPlatform("linux")).toBe(true);
    expect(isSupportedPlatform("darwin")).toBe(true);
  });

  it("rejects unsupported platforms with a clear diagnostic", () => {
    expect(isSupportedPlatform("win32")).toBe(false);
    expect(unsupportedPlatformMessage("win32")).toContain("Linux and macOS 13 or later");
  });
});
