import { describe, expect, it, vi } from "vitest";
import { LinuxClipboardService } from "./linux-clipboard";

const clipboardHarness = vi.hoisted(() => ({
  writeText: vi.fn()
}));

vi.mock("../electron-api", () => ({ clipboard: clipboardHarness }));

interface ExecCall {
  args: string[];
  command: string;
  input?: string;
}

describe("LinuxClipboardService", () => {
  it("mirrors paste text to Wayland and X11 clipboards", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-1" },
      tools: ["wl-copy", "xclip"]
    });

    await service.writeTextForPaste("processed output");

    expect(clipboardHarness.writeText).toHaveBeenCalledWith("processed output");
    expect(calls).toEqual(
      expect.arrayContaining([
        { command: "wl-copy", args: [], input: "processed output" },
        { command: "wl-copy", args: ["--primary"], input: "processed output" },
        { command: "xclip", args: ["-selection", "clipboard"], input: "processed output" },
        { command: "xclip", args: ["-selection", "primary"], input: "processed output" }
      ])
    );
  });

  it("uses xsel for X11 clipboard writes when xclip is unavailable", async () => {
    const calls: ExecCall[] = [];
    const service = createService({
      calls,
      env: { DISPLAY: ":0" },
      tools: ["xsel"]
    });

    await service.writeTextForPaste("processed output");

    expect(calls).toEqual(
      expect.arrayContaining([
        { command: "xsel", args: ["--clipboard", "--input"], input: "processed output" },
        { command: "xsel", args: ["--primary", "--input"], input: "processed output" }
      ])
    );
  });

});

function createService(options: { calls: ExecCall[]; env: NodeJS.ProcessEnv; tools: string[] }): LinuxClipboardService {
  const tools = new Set(options.tools);
  return new LinuxClipboardService({
    commandExists: async (command) => tools.has(command),
    env: options.env,
    execFileText: vi.fn(async (command, args, _timeoutMs, execOptions) => {
      options.calls.push({ command, args, input: execOptions?.input });
      return "";
    }),
    platform: "linux"
  });
}
