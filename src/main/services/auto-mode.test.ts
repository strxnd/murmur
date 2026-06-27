import { describe, expect, it } from "vitest";
import { defaultModes } from "../../shared/defaults";
import type { AutoModeRule, ContextSnapshot } from "../../shared/types";
import { resolveModeByContext } from "./auto-mode";

describe("resolveModeByContext", () => {
  it("uses the highest-priority enabled matching rule", () => {
    const context = contextSnapshot({ browserDomain: "mail.google.com", appName: "Firefox" });
    const rules: AutoModeRule[] = [
      rule({ id: "disabled", modeId: "note", priority: 100, enabled: false, match: { appName: "Firefox" } }),
      rule({ id: "domain", modeId: "mail", priority: 10, match: { domainWildcard: "*.google.com" } }),
      rule({ id: "app", modeId: "message", priority: 5, match: { appName: "fire" } })
    ];

    expect(resolveModeByContext(context, defaultModes, rules, "default").id).toBe("mail");
  });

  it("falls back to the active mode when a matched mode no longer exists", () => {
    const context = contextSnapshot({ windowTitle: "Release notes" });
    const rules = [rule({ id: "missing", modeId: "missing-mode", priority: 1, match: { windowTitleIncludes: "release" } })];

    expect(resolveModeByContext(context, defaultModes, rules, "message").id).toBe("message");
  });
});

function contextSnapshot(overrides: Partial<ContextSnapshot>): ContextSnapshot {
  return {
    capturedAt: "2026-01-01T00:00:00.000Z",
    sourceQuality: "full",
    diagnostics: [],
    ...overrides
  };
}

function rule(overrides: Partial<AutoModeRule> & Pick<AutoModeRule, "id" | "modeId" | "match">): AutoModeRule {
  return {
    name: overrides.id,
    priority: 0,
    enabled: true,
    ...overrides
  };
}
