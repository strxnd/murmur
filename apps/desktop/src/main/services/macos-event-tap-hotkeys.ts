import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { MacosAutomationHelper } from "./macos-automation-helper";

const releaseReadyTimeoutMs = 1500;
const shiftFlag = 1n << 17n;
const controlFlag = 1n << 18n;
const optionFlag = 1n << 19n;
const commandFlag = 1n << 20n;

export interface MacosReleaseRegistration {
  registered: boolean;
  triggerDescription?: string;
  diagnostics: string[];
}

export class MacosEventTapReleaseService {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  constructor(private readonly helper = new MacosAutomationHelper()) {}

  unregister(): void {
    this.child?.kill();
    this.child = null;
  }

  async register(accelerator: string, onReleased: () => void): Promise<MacosReleaseRegistration> {
    this.unregister();

    if (process.platform !== "darwin") {
      return {
        registered: false,
        diagnostics: ["macOS event-tap release detection is only available on macOS."]
      };
    }

    const parsed = parseMacosAccelerator(accelerator);
    if (!parsed) {
      return {
        registered: false,
        diagnostics: [`macOS event-tap release detection does not support accelerator "${accelerator}".`]
      };
    }

    const child = this.helper.startReleaseWatcher(parsed.keyCode, parsed.modifierMask);
    if (!child) {
      return {
        registered: false,
        diagnostics: ["macOS automation helper was not found."]
      };
    }

    this.child = child;
    const diagnostics: string[] = [];
    let stdoutBuffer = "";
    let settled = false;

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) diagnostics.push(text);
    });

    const registration = await new Promise<MacosReleaseRegistration>((resolve) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.unregister();
        resolve({
          registered: false,
          diagnostics: diagnostics.length ? diagnostics : ["macOS event-tap helper did not become ready."]
        });
      }, releaseReadyTimeoutMs);
      timer.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseHelperEvent(line);
          if (event?.event === "released") {
            onReleased();
            continue;
          }
          if (event?.event === "ready" && event.ok) {
            if (settled) continue;
            settled = true;
            clearTimeout(timer);
            resolve({ registered: true, triggerDescription: accelerator, diagnostics });
            continue;
          }
          if (event?.ok === false) {
            diagnostics.push(event.error ?? "macOS event-tap helper failed.");
          }
        }
      });

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          registered: false,
          diagnostics: diagnostics.length ? diagnostics : [`macOS event-tap helper exited with code ${code ?? "unknown"}.`]
        });
      });
    });

    if (!registration.registered) this.unregister();
    return registration;
  }
}

function parseHelperEvent(line: string): { ok?: boolean; event?: string; error?: string } | null {
  try {
    return JSON.parse(line) as { ok?: boolean; event?: string; error?: string };
  } catch {
    return null;
  }
}

function parseMacosAccelerator(accelerator: string): { keyCode: number; modifierMask: bigint } | null {
  const parts = accelerator.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);
  if (!key) return null;

  let modifierMask = 0n;
  for (const modifier of parts.slice(0, -1)) {
    const normalized = modifier.toLowerCase();
    if (normalized === "shift") modifierMask |= shiftFlag;
    else if (normalized === "control" || normalized === "ctrl") modifierMask |= controlFlag;
    else if (normalized === "command" || normalized === "cmd" || normalized === "super" || normalized === "commandorcontrol") {
      modifierMask |= commandFlag;
    } else if (normalized === "alt" || normalized === "option") {
      modifierMask |= optionFlag;
    }
  }

  const keyCode = macosKeyCode(key);
  return keyCode === null ? null : { keyCode, modifierMask };
}

function macosKeyCode(key: string): number | null {
  const normalized = key.toLowerCase();
  if (normalized === "space") return 49;
  if (normalized === "return" || normalized === "enter") return 36;
  if (normalized === "escape" || normalized === "esc") return 53;
  if (normalized.length === 1 && normalized >= "a" && normalized <= "z") {
    return letterKeyCodes[normalized] ?? null;
  }
  if (/^\d$/.test(normalized)) return digitKeyCodes[normalized] ?? null;
  return null;
}

const letterKeyCodes: Record<string, number> = {
  a: 0,
  b: 11,
  c: 8,
  d: 2,
  e: 14,
  f: 3,
  g: 5,
  h: 4,
  i: 34,
  j: 38,
  k: 40,
  l: 37,
  m: 46,
  n: 45,
  o: 31,
  p: 35,
  q: 12,
  r: 15,
  s: 1,
  t: 17,
  u: 32,
  v: 9,
  w: 13,
  x: 7,
  y: 16,
  z: 6
};

const digitKeyCodes: Record<string, number> = {
  "0": 29,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "5": 23,
  "6": 22,
  "7": 26,
  "8": 28,
  "9": 25
};
