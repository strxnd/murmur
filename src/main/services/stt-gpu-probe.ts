import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import type { AccelerationProbeReport, GpuProbeAdapterReport } from "../../shared/types";

const probeTimeoutMs = 1500;

export class SttAccelerationProbeService {
  getReport(): AccelerationProbeReport {
    if (process.platform === "linux") {
      const nvidia = probeNvidia();
      return {
        nvidia,
        apple: emptyAdapter("Apple Silicon acceleration requires macOS on Apple Silicon."),
        diagnostics: [
          "Acceleration probe is advisory only; runtime launch and transcription success decide readiness.",
          ...nvidia.diagnostics
        ]
      };
    }

    if (process.platform === "darwin") {
      const apple = probeApple();
      return {
        nvidia: emptyAdapter("NVIDIA CUDA acceleration is Linux-only."),
        apple,
        diagnostics: [
          "Acceleration probe is advisory only; runtime launch and transcription success decide readiness.",
          ...apple.diagnostics
        ]
      };
    }

    return {
      nvidia: emptyAdapter("NVIDIA CUDA acceleration is Linux-only."),
      apple: emptyAdapter("Apple Silicon acceleration requires macOS on Apple Silicon."),
      diagnostics: ["Acceleration probing is unavailable on this platform."]
    };
  }
}

function probeNvidia(): GpuProbeAdapterReport {
  const devices: string[] = [];
  const diagnostics: string[] = [];

  if (existsSync("/dev/nvidiactl")) {
    diagnostics.push("Found /dev/nvidiactl.");
  }

  const smi = run("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
  if (smi.ok) {
    devices.push(...smi.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } else if (smi.reason) {
    diagnostics.push(`nvidia-smi unavailable: ${smi.reason}`);
  }

  const available = devices.length > 0 || existsSync("/dev/nvidiactl");
  if (!available) diagnostics.push("No NVIDIA CUDA-capable device was detected.");
  return { available, devices, diagnostics };
}

function probeApple(): GpuProbeAdapterReport {
  if (process.arch !== "arm64") {
    return emptyAdapter("Apple Silicon acceleration requires Apple Silicon.");
  }
  const devices = [`Apple Silicon (${cpus()[0]?.model ?? "arm64"})`];
  return { available: true, devices, diagnostics: ["Apple Silicon detected."] };
}

function emptyAdapter(message: string): GpuProbeAdapterReport {
  return { available: false, devices: [], diagnostics: [message] };
}

function run(command: string, args: string[]): { ok: true; stdout: string } | { ok: false; reason: string } {
  const path = commandPath(command);
  if (!path) return { ok: false, reason: `${command} is not on PATH.` };
  const result = spawnSync(path, args, {
    encoding: "utf8",
    timeout: probeTimeoutMs,
    maxBuffer: 1024 * 1024
  });
  if (result.error) return { ok: false, reason: result.error.message };
  if (result.status !== 0) return { ok: false, reason: result.stderr.trim() || `exit code ${result.status}` };
  return { ok: true, stdout: result.stdout };
}

function commandPath(command: string): string | null {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":").filter(Boolean)) {
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
