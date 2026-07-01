import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationPermissionService } from "./automation-permissions";
import type { MacosAutomationHelper } from "./macos-automation-helper";

const mockState = vi.hoisted(() => ({
  trusted: false,
  promptCalls: [] as boolean[]
}));

vi.mock("../electron-api", () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: (prompt: boolean) => {
      mockState.promptCalls.push(prompt);
      return mockState.trusted;
    }
  }
}));

describe("AutomationPermissionService", () => {
  beforeEach(() => {
    mockState.trusted = false;
    mockState.promptCalls.length = 0;
  });

  it("reports not required on Linux", () => {
    const service = new AutomationPermissionService("linux");

    expect(service.status()).toEqual({
      status: "not_required",
      permissionRequired: false,
      canPrompt: false,
      diagnostics: []
    });
    expect(mockState.promptCalls).toEqual([]);
  });

  it("requests macOS Accessibility permission through Electron", () => {
    const service = new AutomationPermissionService("darwin", helperStatus({ helperAvailable: true, trusted: true, diagnostics: [] }));

    expect(service.request()).toMatchObject({
      status: "not_determined_or_denied",
      permissionRequired: true,
      canPrompt: true
    });
    expect(mockState.promptCalls).toEqual([true]);
  });

  it("distinguishes trusted helper failures", () => {
    mockState.trusted = true;
    const service = new AutomationPermissionService(
      "darwin",
      helperStatus({ helperAvailable: false, trusted: false, diagnostics: ["helper missing"] })
    );

    expect(service.status()).toEqual({
      status: "trusted_but_helper_failed",
      permissionRequired: true,
      canPrompt: false,
      diagnostics: ["helper missing"]
    });
    expect(mockState.promptCalls).toEqual([false]);
  });
});

function helperStatus(status: ReturnType<MacosAutomationHelper["status"]>): MacosAutomationHelper {
  return {
    status: () => status
  } as MacosAutomationHelper;
}
