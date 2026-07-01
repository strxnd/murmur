import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";

const helperTimeoutMs = 1500;
const helperName = "murmur-macos-helper";

export interface MacosHelperStatus {
  helperAvailable: boolean;
  trusted: boolean;
  diagnostics: string[];
}

export interface MacosHelperResult {
  ok: boolean;
  trusted?: boolean;
  error?: string;
  text?: string;
  appName?: string;
  appId?: string;
  windowTitle?: string;
}

export class MacosAutomationHelper {
  constructor(private readonly helperPath = resolveMacosHelperPath()) {}

  get path(): string | null {
    return this.helperPath;
  }

  status(): MacosHelperStatus {
    if (!this.helperPath) {
      return {
        helperAvailable: false,
        trusted: false,
        diagnostics: ["macOS automation helper was not found."]
      };
    }

    const result = this.runJsonSync(["status"]);
    if (!result.ok) {
      return {
        helperAvailable: false,
        trusted: false,
        diagnostics: [result.error ?? "macOS automation helper status check failed."]
      };
    }

    return {
      helperAvailable: true,
      trusted: result.trusted === true,
      diagnostics: result.trusted === true ? [] : ["macOS Accessibility permission is not trusted."]
    };
  }

  paste(): MacosHelperResult {
    return this.runJsonSync(["paste"]);
  }

  copy(): MacosHelperResult {
    return this.runJsonSync(["copy"]);
  }

  selectedText(): MacosHelperResult {
    return this.runJsonSync(["selected-text"]);
  }

  activeWindow(): MacosHelperResult {
    return this.runJsonSync(["active-window"]);
  }

  startReleaseWatcher(keyCode: number, modifierMask: bigint): ChildProcessByStdio<null, Readable, Readable> | null {
    if (!this.helperPath) return null;
    return spawn(this.helperPath, ["event-tap-release", String(keyCode), modifierMask.toString()], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  private runJsonSync(args: string[]): MacosHelperResult {
    if (!this.helperPath) return { ok: false, error: "macOS automation helper was not found." };
    const result = spawnSync(this.helperPath, args, {
      encoding: "utf8",
      timeout: helperTimeoutMs,
      maxBuffer: 1024 * 1024
    });
    if (result.error) return { ok: false, error: result.error.message };

    const output = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!output) {
      const stderr = result.stderr.trim();
      return { ok: false, error: stderr || `macOS automation helper exited with code ${result.status ?? "unknown"}.` };
    }

    try {
      const parsed = JSON.parse(output) as MacosHelperResult;
      if (result.status !== 0 && parsed.ok !== false) {
        return { ...parsed, ok: false, error: parsed.error ?? `macOS automation helper exited with code ${result.status}.` };
      }
      return parsed;
    } catch {
      return { ok: false, error: `macOS automation helper returned invalid JSON: ${output}` };
    }
  }
}

export function resolveMacosHelperPath(): string | null {
  const envPath = process.env.MURMUR_MACOS_HELPER;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    envPath,
    resourcesPath ? join(resourcesPath, "bin", helperName) : undefined,
    join(process.cwd(), "resources", "bin", helperName),
    join(__dirname, "../../resources/bin", helperName)
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
