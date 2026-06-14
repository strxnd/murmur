import type { AppSettings } from "../../shared/types";
import { commandExists, execFileText } from "./command";

interface SoundCapabilities {
  backend: "wpctl_pactl";
  wpctlAvailable: boolean;
  pactlAvailable: boolean;
  diagnostics: string[];
}

export class SoundService {
  private wpctlAvailable = false;
  private pactlAvailable = false;
  private diagnostics: string[] = [];

  async initialize(): Promise<void> {
    this.wpctlAvailable = await commandExists("wpctl");
    this.pactlAvailable = await commandExists("pactl");
    this.diagnostics = [
      `wpctl ${this.wpctlAvailable ? "available" : "unavailable"}.`,
      `pactl ${this.pactlAvailable ? "available" : "unavailable"}.`
    ];
  }

  async prepareForRecording(settings: AppSettings): Promise<void> {
    if (!settings.autoIncreaseMicVolume) return;

    if (this.wpctlAvailable && (await this.tryWpctl())) return;
    if (this.pactlAvailable && (await this.tryPactl())) return;

    this.addDiagnostic("Microphone volume adjustment skipped; no supported PulseAudio/PipeWire command succeeded.");
  }

  getCapabilities(): SoundCapabilities {
    return {
      backend: "wpctl_pactl",
      wpctlAvailable: this.wpctlAvailable,
      pactlAvailable: this.pactlAvailable,
      diagnostics: this.diagnostics.slice(-12)
    };
  }

  private async tryWpctl(): Promise<boolean> {
    try {
      const output = await execFileText("wpctl", ["get-volume", "@DEFAULT_AUDIO_SOURCE@"], 1200);
      const current = this.parseWpctlVolume(output);
      if (current === null) {
        this.addDiagnostic(`wpctl volume output was not recognized: ${output}`);
        return false;
      }
      if (current >= 1) {
        this.addDiagnostic("wpctl microphone volume already at 100% or higher.");
        return true;
      }
      await execFileText("wpctl", ["set-volume", "@DEFAULT_AUDIO_SOURCE@", "100%"], 1200);
      this.addDiagnostic("wpctl set default microphone volume to 100%.");
      return true;
    } catch (error) {
      this.addDiagnostic(`wpctl microphone volume adjustment failed: ${message(error)}`);
      return false;
    }
  }

  private async tryPactl(): Promise<boolean> {
    try {
      const source = await execFileText("pactl", ["get-default-source"], 1200);
      if (!source) {
        this.addDiagnostic("pactl did not return a default source.");
        return false;
      }
      await execFileText("pactl", ["set-source-volume", source, "100%"], 1200);
      this.addDiagnostic(`pactl set microphone volume to 100% for ${source}.`);
      return true;
    } catch (error) {
      this.addDiagnostic(`pactl microphone volume adjustment failed: ${message(error)}`);
      return false;
    }
  }

  private parseWpctlVolume(output: string): number | null {
    const match = output.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private addDiagnostic(diagnostic: string): void {
    this.diagnostics = [...this.diagnostics, diagnostic].slice(-24);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
