import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SttRuntimeService } from "./stt-runtime";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("SttRuntimeService", () => {
  it("resolves env var paths first", () => {
    const root = tempRoot();
    const envBinary = touch(join(root, "env", "whisper-server"));
    touch(join(root, "vendor", "runtimes", "linux-x64", "whisper.cpp", "whisper-server"));

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      env: { MURMUR_WHISPER_CPP_SERVER: envBinary }
    });

    const availability = service.getAvailability("whisper.cpp");
    expect(availability.status).toBe("available");
    expect(availability.source).toBe("env");
    expect(availability.binaryPath).toBe(envBinary);
  });

  it("resolves packaged resources before vendor", () => {
    const root = tempRoot();
    const resourcesPath = join(root, "resources");
    const resourcesBinary = touch(join(resourcesPath, "runtimes", "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));
    touch(join(root, "vendor", "runtimes", "linux-x64", "sherpa-onnx", "bin", "sherpa-onnx-offline"));

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      resourcesPath,
      env: {}
    });

    const availability = service.getAvailability("sherpa-onnx");
    expect(availability.status).toBe("available");
    expect(availability.source).toBe("resources");
    expect(availability.binaryPath).toBe(resourcesBinary);
  });

  it("handles .exe candidates on Windows", () => {
    const root = tempRoot();
    const binary = touch(join(root, "vendor", "runtimes", "win32-x64", "whisper.cpp", "whisper-server.exe"));

    const service = new SttRuntimeService({
      platform: "win32",
      arch: "x64",
      projectRoot: root,
      env: {}
    });

    const availability = service.getAvailability("whisper.cpp");
    expect(availability.status).toBe("available");
    expect(availability.binaryPath).toBe(binary);
  });

  it("returns unsupported for unknown platform and arch", () => {
    const service = new SttRuntimeService({
      platform: "freebsd",
      arch: "x64",
      projectRoot: tempRoot(),
      env: {}
    });

    expect(service.getAvailability("whisper.cpp").status).toBe("unsupported");
    expect(() => service.requireRuntime("whisper.cpp")).toThrow(/not bundled/);
  });

  it("builds dynamic library environment variables", () => {
    const root = tempRoot();
    const runtimeRoot = join(root, "vendor", "runtimes", "linux-x64", "sherpa-onnx");
    touch(join(runtimeRoot, "bin", "sherpa-onnx-offline"));
    mkdirSync(join(runtimeRoot, "lib"), { recursive: true });

    const service = new SttRuntimeService({
      platform: "linux",
      arch: "x64",
      projectRoot: root,
      env: { LD_LIBRARY_PATH: "/system/lib" }
    });

    const runtime = service.requireRuntime("sherpa-onnx");
    const paths = runtime.env.LD_LIBRARY_PATH?.split(":") ?? [];
    expect(paths[0]).toBe(join(runtimeRoot, "lib"));
    expect(paths).toContain("/system/lib");
  });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
  tempDirs.push(dir);
  return dir;
}

function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return path;
}
