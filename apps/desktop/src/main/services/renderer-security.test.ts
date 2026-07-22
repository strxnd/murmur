import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl, resolveRendererSource } from "./renderer-security";

describe("renderer security policy", () => {
  const rendererFilePath = join(process.cwd(), "out", "renderer", "index.html");

  it("ignores ELECTRON_RENDERER_URL for packaged builds", () => {
    const source = resolveRendererSource({
      isPackaged: true,
      envRendererUrl: "http://localhost:5173",
      rendererFilePath
    });

    expect(source.kind).toBe("file");
  });

  it("allows localhost dev renderer URLs only in development", () => {
    const source = resolveRendererSource({
      isPackaged: false,
      envRendererUrl: "http://127.0.0.1:5173",
      rendererFilePath
    });
    const remoteSource = resolveRendererSource({
      isPackaged: false,
      envRendererUrl: "https://example.test",
      rendererFilePath
    });

    expect(source.kind).toBe("dev");
    expect(remoteSource.kind).toBe("file");
  });

  it("trusts only the selected renderer origin or file", () => {
    const devSource = resolveRendererSource({
      isPackaged: false,
      envRendererUrl: "http://localhost:5173",
      rendererFilePath
    });
    const fileSource = resolveRendererSource({
      isPackaged: true,
      envRendererUrl: "http://localhost:5173",
      rendererFilePath
    });

    expect(isTrustedRendererUrl(devSource, "http://localhost:5173/?pill=1")).toBe(true);
    expect(isTrustedRendererUrl(devSource, "http://localhost:5173/#/history")).toBe(true);
    expect(isTrustedRendererUrl(devSource, "http://localhost.evil.test:5173")).toBe(false);
    expect(isTrustedRendererUrl(fileSource, `${pathToFileURL(rendererFilePath).toString()}?mode-selector=1`)).toBe(true);
    expect(isTrustedRendererUrl(fileSource, `${pathToFileURL(rendererFilePath).toString()}#/models`)).toBe(true);
    expect(isTrustedRendererUrl(fileSource, pathToFileURL(join(process.cwd(), "other.html")).toString())).toBe(false);
  });
});
