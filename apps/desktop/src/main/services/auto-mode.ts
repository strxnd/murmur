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
