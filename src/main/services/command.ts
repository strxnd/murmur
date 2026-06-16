import { execFile } from "node:child_process";

export interface ExecFileTextOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export function execFileText(command: string, args: string[], timeoutMs = 2500, options: ExecFileTextOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env: options.env, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
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
