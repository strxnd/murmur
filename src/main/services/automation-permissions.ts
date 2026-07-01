import type { AutomationPermissionReport } from "../../shared/types";
import { systemPreferences } from "../electron-api";
import { MacosAutomationHelper } from "./macos-automation-helper";

export class AutomationPermissionService {
  private report: AutomationPermissionReport = linuxReport();

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly helper = new MacosAutomationHelper()
  ) {}

  async initialize(): Promise<void> {
    await Promise.resolve();
    this.refresh(false);
  }

  getReport(): AutomationPermissionReport {
    return this.report;
  }

  status(): AutomationPermissionReport {
    this.refresh(false);
    return this.report;
  }

  request(): AutomationPermissionReport {
    this.refresh(true);
    return this.report;
  }

  private refresh(prompt: boolean): void {
    if (this.platform !== "darwin") {
      this.report = linuxReport();
      return;
    }

    const trusted = systemPreferences.isTrustedAccessibilityClient(prompt);
    if (!trusted) {
      this.report = {
        status: "not_determined_or_denied",
        permissionRequired: true,
        canPrompt: true,
        diagnostics: ["macOS Accessibility permission is required for paste automation, selected text, and push-to-talk release detection."]
      };
      return;
    }

    const helperStatus = this.helper.status();
    if (!helperStatus.helperAvailable || !helperStatus.trusted) {
      this.report = {
        status: "trusted_but_helper_failed",
        permissionRequired: true,
        canPrompt: false,
        diagnostics: helperStatus.diagnostics.length ? helperStatus.diagnostics : ["macOS automation helper status check failed."]
      };
      return;
    }

    this.report = {
      status: "trusted",
      permissionRequired: true,
      canPrompt: false,
      diagnostics: []
    };
  }
}

function linuxReport(): AutomationPermissionReport {
  return {
    status: "not_required",
    permissionRequired: false,
    canPrompt: false,
    diagnostics: []
  };
}
