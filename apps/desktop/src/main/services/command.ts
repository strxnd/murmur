import { execFile } from "node:child_process";

export interface ExecFileTextOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export type ExecFileFailurePhase = "spawn" | "stdin" | "exit";

export class ExecFileTextError extends Error {
  constructor(
    message: string,
    readonly phase: ExecFileFailurePhase,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ExecFileTextError";
  }
}

export function execFileText(command: string, args: string[], timeoutMs = 2500, options: ExecFileTextOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      operation();
    };
    const rejectFailure = (error: unknown, phase: ExecFileFailurePhase, fallbackMessage?: string): void => {
      const cause = error instanceof Error ? error : undefined;
      const message = fallbackMessage || cause?.message || String(error);
      settle(() => reject(new ExecFileTextError(message, phase, { cause })));
    };

    const child = execFile(command, args, { env: options.env, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        rejectFailure(error, isSpawnFailure(error) ? "spawn" : "exit", stderr || error.message);
        return;
      }
      settle(() => resolve(stdout.trim()));
    });
    child.once("error", (error) => rejectFailure(error, "spawn"));

    if (child.stdin) {
      child.stdin.once("error", (error) => {
        rejectFailure(error, "stdin");
        child.kill();
      });
      try {
        if (options.input !== undefined) {
          child.stdin.write(options.input);
        }
        child.stdin.end();
      } catch (error) {
        rejectFailure(error, "stdin");
        child.kill();
      }
    }
  });
}

function isSpawnFailure(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "ENOENT" || code === "ENOTDIR";
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileText("sh", ["-lc", `command -v ${command}`], 1000);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
