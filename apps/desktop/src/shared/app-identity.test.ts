import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { murmurAppId, murmurLinuxDesktopName } from "./app-identity";

describe("Murmur desktop identity", () => {
  it("keeps builder, launcher, runtime, and portal identities aligned", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as {
      desktopName?: string;
      build?: {
        appId?: string;
        linux?: { syncDesktopName?: boolean };
      };
    };

    expect(packageJson.build?.appId).toBe(murmurAppId);
    expect(packageJson.desktopName).toBe(murmurAppId);
    expect(packageJson.build?.linux?.syncDesktopName).toBe(true);
    expect(murmurLinuxDesktopName).toBe(`${murmurAppId}.desktop`);
  });
});
