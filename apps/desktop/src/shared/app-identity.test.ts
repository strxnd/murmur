import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { murmurAppId, murmurLinuxDesktopName } from "./app-identity";

describe("Murmur desktop identity", () => {
  it("keeps builder, launcher, runtime, and portal identities aligned", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { desktopName?: string };
    const require = createRequire(import.meta.url);
    const buildConfig = require("../../electron-builder.base.cjs") as {
      appId?: string;
      linux?: { syncDesktopName?: boolean };
    };

    expect(buildConfig.appId).toBe(murmurAppId);
    expect(packageJson.desktopName).toBe(murmurAppId);
    expect(buildConfig.linux?.syncDesktopName).toBe(true);
    expect(murmurLinuxDesktopName).toBe(`${murmurAppId}.desktop`);
  });
});
