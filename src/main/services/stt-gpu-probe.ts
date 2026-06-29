import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GpuProbeAdapterReport, SttGpuProbeReport } from "../../shared/types";

const probeTimeoutMs = 1500;

export class SttGpuProbeService {
  getReport(): SttGpuProbeReport {
    if (process.platform !== "linux") {
      return {
        nvidia: emptyAdapter("NVIDIA probe is Linux-only."),
        amd: emptyAdapter("AMD ROCm probe is Linux-only."),
        diagnostics: ["STT GPU acceleration is currently probed only on Linux."]
      };
    }

    const nvidia = probeNvidia();
    const amd = probeAmd();
    return {
      nvidia,
      amd,
      diagnostics: [
        "GPU probe is advisory only; runtime launch and transcription success decide readiness.",
        ...nvidia.diagnostics,
        ...amd.diagnostics
      ]
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

function probeAmd(): GpuProbeAdapterReport {
  const devices: string[] = [];
  const diagnostics: string[] = [];

  const renderDevices = listRenderDevices();
  if (renderDevices.length > 0) {
    diagnostics.push(`Found DRM render devices: ${renderDevices.join(", ")}.`);
  }

  const rocm = run("rocminfo", []);
  if (rocm.ok) {
    devices.push(...extractRocmDeviceNames(rocm.stdout));
  } else if (rocm.reason) {
    diagnostics.push(`rocminfo unavailable: ${rocm.reason}`);
  }

  const smi = run("rocm-smi", ["--showproductname"]);
  if (smi.ok) {
    devices.push(...extractRocmSmiDeviceNames(smi.stdout));
  } else if (smi.reason) {
    diagnostics.push(`rocm-smi unavailable: ${smi.reason}`);
  }

  const uniqueDevices = Array.from(new Set(devices));
  const available = uniqueDevices.length > 0 || renderDevices.some((device) => device.includes("renderD"));
  if (!available) diagnostics.push("No AMD ROCm/HIP-capable device was detected.");
  return { available, devices: uniqueDevices, diagnostics };
}

function emptyAdapter(message: string): GpuProbeAdapterReport {
  return { available: false, devices: [], diagnostics: [message] };
}

function listRenderDevices(): string[] {
  try {
    return readdirSync("/dev/dri")
      .filter((entry) => entry.startsWith("renderD"))
      .map((entry) => join("/dev/dri", entry));
  } catch {
    return [];
  }
}

function extractRocmDeviceNames(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Name:"))
    .map((line) => line.slice("Name:".length).trim())
    .filter(Boolean);
}

function extractRocmSmiDeviceNames(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /GPU\[\d+\]/.test(line) && /Card series/i.test(line))
    .map((line) => line.replace(/^GPU\[\d+\]\s*:\s*/i, "").trim())
    .filter(Boolean);
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
