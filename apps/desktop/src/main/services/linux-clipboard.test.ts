import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinuxClipboardService } from "./linux-clipboard";

const clipboardHarness = vi.hoisted(() => {
  let text = "";
  let primary = "";
  let selectionAvailable = true;
  return {
    readText: vi.fn((type?: string) => {
      if (type === "selection") {
        if (!selectionAvailable) throw new Error("selection unavailable");
        return primary;
      }
      return text;
    }),
    reset: () => {
      text = "";
      primary = "";
      selectionAvailable = true;
    },
    setSelectionAvailable: (available: boolean) => {
      selectionAvailable = available;
    },
    writeText: vi.fn((value: string, type?: string) => {
      if (type === "selection") {
        if (!selectionAvailable) throw new Error("selection unavailable");
        primary = value;
      } else text = value;
    })
  };
});

vi.mock("../electron-api", () => ({ clipboard: clipboardHarness }));

interface ExecCall {
  args: string[];
  command: string;
  input?: string;
}

describe("LinuxClipboardService", () => {
  beforeEach(() => {
    clipboardHarness.reset();
    clipboardHarness.readText.mockClear();
    clipboardHarness.writeText.mockClear();
  });

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

  it("restores clipboard selections when cancellation interrupts helper writes", async () => {
    clipboardHarness.writeText("previous clipboard");
    clipboardHarness.writeText("previous primary", "selection");
    const calls: ExecCall[] = [];
    let releaseHelpers!: () => void;
    const helpersBlocked = new Promise<void>((resolve) => {
      releaseHelpers = resolve;
    });
    const service = new LinuxClipboardService({
      commandExists: async () => true,
      env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-1" },
      execFileText: vi.fn(async (command, args, _timeoutMs, execOptions) => {
        calls.push({ command, args, input: execOptions?.input });
        await helpersBlocked;
        return "";
      }),
      platform: "linux"
    });
    const controller = new AbortController();

    const write = service.writeTextForPaste("cancelled output", controller.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    controller.abort();

    expect(clipboardHarness.readText()).toBe("previous clipboard");
    expect(clipboardHarness.readText("selection")).toBe("previous primary");
    releaseHelpers();
    await expect(write).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual(
      expect.arrayContaining([
        { command: "wl-copy", args: [], input: "previous clipboard" },
        { command: "wl-copy", args: ["--primary"], input: "previous primary" },
        { command: "xclip", args: ["-selection", "clipboard"], input: "previous clipboard" },
        { command: "xclip", args: ["-selection", "primary"], input: "previous primary" }
      ])
    );
  });

  it("restores an external primary selection when Electron cannot read it", async () => {
    clipboardHarness.writeText("previous clipboard");
    clipboardHarness.setSelectionAvailable(false);
    const calls: ExecCall[] = [];
    let externalPrimary = "previous external primary";
    let releaseWrites!: () => void;
    const writesBlocked = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    const service = new LinuxClipboardService({
      commandExists: async (command) => command === "wl-copy" || command === "wl-paste",
      env: { WAYLAND_DISPLAY: "wayland-1" },
      execFileText: vi.fn(async (command, args, _timeoutMs, execOptions) => {
        calls.push({ command, args, input: execOptions?.input });
        if (command === "wl-paste") return externalPrimary;
        if (execOptions?.input === "cancelled output") await writesBlocked;
        if (command === "wl-copy" && args.includes("--primary")) externalPrimary = execOptions?.input ?? "";
        return "";
      }),
      platform: "linux"
    });
    const controller = new AbortController();

    const write = service.writeTextForPaste("cancelled output", controller.signal);
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.command === "wl-copy" && call.input === "cancelled output")).toHaveLength(2)
    );
    controller.abort();
    releaseWrites();

    await expect(write).rejects.toMatchObject({ name: "AbortError" });
    expect(externalPrimary).toBe("previous external primary");
    expect(calls).toContainEqual({ command: "wl-copy", args: ["--primary"], input: "previous external primary" });
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
