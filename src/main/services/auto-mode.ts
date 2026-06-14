import type { AutoModeRule, ContextSnapshot, ModeConfig } from "../../shared/types";

export function resolveModeByContext(
  context: ContextSnapshot,
  modes: ModeConfig[],
  rules: AutoModeRule[],
  fallbackModeId: string
): ModeConfig {
  const sorted = rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority);

  const matched = sorted.find((rule) => {
    const match = rule.match;
    if (match.domain && context.browserDomain === match.domain) return true;
    if (match.domainWildcard && context.browserDomain && wildcardDomainMatches(match.domainWildcard, context.browserDomain)) {
      return true;
    }
    if (match.appId && context.appId?.toLowerCase().includes(match.appId.toLowerCase())) return true;
    if (match.appName && context.appName?.toLowerCase().includes(match.appName.toLowerCase())) return true;
    if (
      match.windowTitleIncludes &&
      context.windowTitle?.toLowerCase().includes(match.windowTitleIncludes.toLowerCase())
    ) {
      return true;
    }
    return false;
  });

  return modes.find((mode) => mode.id === matched?.modeId) ?? modes.find((mode) => mode.id === fallbackModeId) ?? modes[0];
}

function wildcardDomainMatches(pattern: string, domain: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return domain.endsWith(suffix) || domain === pattern.slice(2);
  }
  return pattern === domain;
}
